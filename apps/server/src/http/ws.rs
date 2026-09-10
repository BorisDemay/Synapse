use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};

use axum::{
    extract::{
        Path, State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    http::{HeaderMap, StatusCode},
    response::Response,
};
use serde::Serialize;
use tokio::sync::broadcast;
use uuid::Uuid;

use crate::{AppState, auth::session, http::vaults, sync::pull};

const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(30);
const MAX_CONNECTIONS: usize = 128;
const MAX_CONNECTIONS_PER_USER: usize = 8;
const NOTIFICATION_BUFFER: usize = 64;

#[derive(Clone, Copy, Debug)]
pub(crate) struct RevisionNotice {
    vault_id: Uuid,
    revision: i64,
}

#[derive(Clone)]
pub(crate) struct NotificationHub {
    sender: broadcast::Sender<RevisionNotice>,
    revoked_sender: broadcast::Sender<Vec<u8>>,
    connections: Arc<AtomicUsize>,
    user_connections: Arc<Mutex<HashMap<Uuid, UserConnections>>>,
}

struct UserConnections {
    count: usize,
    tokens: HashMap<Vec<u8>, usize>,
}

impl NotificationHub {
    pub(crate) fn new() -> Self {
        let (sender, _) = broadcast::channel(NOTIFICATION_BUFFER);
        let (revoked_sender, _) = broadcast::channel(NOTIFICATION_BUFFER);
        Self {
            sender,
            revoked_sender,
            connections: Arc::new(AtomicUsize::new(0)),
            user_connections: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub(crate) fn subscribe(
        &self,
        user_id: Uuid,
        token_hash: Vec<u8>,
    ) -> Option<(
        broadcast::Receiver<RevisionNotice>,
        broadcast::Receiver<Vec<u8>>,
        ConnectionGuard,
    )> {
        let connection = self.connections.fetch_add(1, Ordering::AcqRel);
        if connection >= MAX_CONNECTIONS {
            self.connections.fetch_sub(1, Ordering::AcqRel);
            return None;
        }
        let user_count = match self.user_connections.lock() {
            Ok(mut users) => {
                let connections = users.entry(user_id).or_insert_with(|| UserConnections {
                    count: 0,
                    tokens: HashMap::new(),
                });
                if connections.count >= MAX_CONNECTIONS_PER_USER {
                    false
                } else {
                    connections.count += 1;
                    *connections.tokens.entry(token_hash.clone()).or_default() += 1;
                    true
                }
            }
            Err(_) => false,
        };
        if !user_count {
            self.connections.fetch_sub(1, Ordering::AcqRel);
            return None;
        }
        crate::metrics::ws_connected();
        Some((
            self.sender.subscribe(),
            self.revoked_sender.subscribe(),
            ConnectionGuard {
                connections: self.connections.clone(),
                user_connections: self.user_connections.clone(),
                user_id,
                token_hash,
            },
        ))
    }

    pub(crate) fn publish(&self, vault_id: Uuid, revision: i64) {
        let _ = self.sender.send(RevisionNotice { vault_id, revision });
    }

    pub(crate) fn revoke_session(&self, token: &session::SessionToken) {
        let _ = self.revoked_sender.send(token.hash());
    }

    pub(crate) fn revoke_token_hash(&self, token_hash: Vec<u8>) {
        let _ = self.revoked_sender.send(token_hash);
    }

    pub(crate) fn revoke_user_except(&self, user_id: Uuid, current: &session::SessionToken) {
        let current_hash = current.hash();
        if let Ok(users) = self.user_connections.lock()
            && let Some(connections) = users.get(&user_id)
        {
            for token_hash in connections.tokens.keys() {
                if token_hash != &current_hash {
                    let _ = self.revoked_sender.send(token_hash.clone());
                }
            }
        }
    }

    pub(crate) fn revoke_user(&self, user_id: Uuid) {
        if let Ok(users) = self.user_connections.lock()
            && let Some(connections) = users.get(&user_id)
        {
            for token_hash in connections.tokens.keys() {
                let _ = self.revoked_sender.send(token_hash.clone());
            }
        }
    }
}

pub(crate) struct ConnectionGuard {
    connections: Arc<AtomicUsize>,
    user_connections: Arc<Mutex<HashMap<Uuid, UserConnections>>>,
    user_id: Uuid,
    token_hash: Vec<u8>,
}

impl Drop for ConnectionGuard {
    fn drop(&mut self) {
        self.connections.fetch_sub(1, Ordering::AcqRel);
        if let Ok(mut users) = self.user_connections.lock()
            && let Some(connections) = users.get_mut(&self.user_id)
        {
            connections.count = connections.count.saturating_sub(1);
            if let Some(token_count) = connections.tokens.get_mut(&self.token_hash) {
                *token_count = token_count.saturating_sub(1);
                if *token_count == 0 {
                    connections.tokens.remove(&self.token_hash);
                }
            }
            if connections.count == 0 {
                users.remove(&self.user_id);
            }
        }
        crate::metrics::ws_disconnected();
    }
}

#[derive(Serialize)]
struct WakeSignal {
    vault_id: String,
    cursor: String,
}

pub async fn connect(
    State(state): State<AppState>,
    Path(vault_id): Path<String>,
    headers: HeaderMap,
    websocket: WebSocketUpgrade,
) -> Result<Response, StatusCode> {
    // This endpoint is used by browsers, which always send Origin during the
    // WebSocket handshake. Require it instead of treating an omitted value as
    // a native-client compatibility case; desktop synchronization uses HTTP.
    if !headers
        .get(axum::http::header::ORIGIN)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|origin| crate::http::security::origin_allowed(&state.allowed_origins, origin))
    {
        return Err(StatusCode::FORBIDDEN);
    }
    let vault_id = Uuid::parse_str(&vault_id).map_err(|_| StatusCode::BAD_REQUEST)?;
    let pool = state.pool.ok_or(StatusCode::SERVICE_UNAVAILABLE)?;
    let token = vaults::session_token(&headers).ok_or(StatusCode::UNAUTHORIZED)?;
    let user_id = session::user_for(&pool, &token, state.clock.now())
        .await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?
        .ok_or(StatusCode::UNAUTHORIZED)?;
    let is_member = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM vault_members WHERE vault_id = $1::uuid AND user_id = $2::uuid)",
    )
    .bind(vault_id.to_string())
    .bind(user_id.to_string())
    .fetch_one(&pool)
    .await
    .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    if !is_member {
        return Err(StatusCode::NOT_FOUND);
    }
    let (notifications, revocations, guard) = state
        .notifications
        .subscribe(user_id, token.hash())
        .ok_or(StatusCode::SERVICE_UNAVAILABLE)?;
    let token_for_socket = token.clone();
    let clock = state.clock.clone();
    Ok(websocket
        .max_message_size(4 * 1024)
        .max_frame_size(4 * 1024)
        .on_upgrade(move |socket| {
            serve(
                socket,
                pool,
                vault_id,
                user_id,
                token_for_socket,
                clock,
                notifications,
                revocations,
                guard,
            )
        }))
}

#[allow(clippy::too_many_arguments)]
async fn serve(
    mut socket: WebSocket,
    pool: sqlx::PgPool,
    vault_id: Uuid,
    user_id: Uuid,
    token: session::SessionToken,
    clock: Arc<dyn session::Clock>,
    mut notifications: broadcast::Receiver<RevisionNotice>,
    mut revocations: broadcast::Receiver<Vec<u8>>,
    _guard: ConnectionGuard,
) {
    let token_hash = token.hash();
    let mut heartbeat = tokio::time::interval(HEARTBEAT_INTERVAL);
    heartbeat.tick().await;
    loop {
        tokio::select! {
            incoming = socket.recv() => match incoming {
                Some(Ok(Message::Close(_))) | Some(Err(_)) | None => return,
                Some(Ok(Message::Ping(payload))) => {
                    if socket.send(Message::Pong(payload)).await.is_err() {
                        return;
                    }
                }
                Some(Ok(_)) => {}
            },
            notice = notifications.recv() => match notice {
                Ok(notice) => {
                    if !session_and_membership_active(&pool, &token, &clock, user_id, vault_id).await {
                        return;
                    }
                    if notice.vault_id != vault_id {
                        continue;
                    }
                    let Ok(cursor) = pull::issue_cursor(&pool, vault_id, user_id, notice.revision).await else {
                        return;
                    };
                    let Ok(signal) = serde_json::to_string(&WakeSignal {
                        vault_id: vault_id.to_string(),
                        cursor: cursor.as_str().to_owned(),
                    }) else {
                        return;
                    };
                    if socket.send(Message::Text(signal.into())).await.is_err() {
                        return;
                    }
                }
                Err(broadcast::error::RecvError::Lagged(_)) | Err(broadcast::error::RecvError::Closed) => return,
            },
            revoked = revocations.recv() => match revoked {
                Ok(hash) if hash == token_hash => return,
                Ok(_) => {}
                Err(broadcast::error::RecvError::Lagged(_)) => {
                    if !session_and_membership_active(&pool, &token, &clock, user_id, vault_id).await {
                        return;
                    }
                }
                Err(broadcast::error::RecvError::Closed) => return,
            },
            _ = heartbeat.tick() => {
                if !session_and_membership_active(&pool, &token, &clock, user_id, vault_id).await {
                    return;
                }
                if socket.send(Message::Ping(Vec::new().into())).await.is_err() {
                    return;
                }
            },
        }
    }
}

async fn session_and_membership_active(
    pool: &sqlx::PgPool,
    token: &session::SessionToken,
    clock: &Arc<dyn session::Clock>,
    user_id: Uuid,
    vault_id: Uuid,
) -> bool {
    let Ok(Some(session_user)) = session::user_for(pool, token, clock.now()).await else {
        return false;
    };
    if session_user != user_id {
        return false;
    }
    sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM vault_members WHERE vault_id = $1::uuid AND user_id = $2::uuid)",
    )
    .bind(vault_id.to_string())
    .bind(user_id.to_string())
    .fetch_one(pool)
    .await
    .unwrap_or(false)
}
