use std::{
    sync::{
        Arc,
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
const NOTIFICATION_BUFFER: usize = 64;

#[derive(Clone, Copy, Debug)]
pub(crate) struct RevisionNotice {
    vault_id: Uuid,
    revision: i64,
}

#[derive(Clone)]
pub(crate) struct NotificationHub {
    sender: broadcast::Sender<RevisionNotice>,
    connections: Arc<AtomicUsize>,
}

impl NotificationHub {
    pub(crate) fn new() -> Self {
        let (sender, _) = broadcast::channel(NOTIFICATION_BUFFER);
        Self {
            sender,
            connections: Arc::new(AtomicUsize::new(0)),
        }
    }

    pub(crate) fn subscribe(
        &self,
    ) -> Option<(broadcast::Receiver<RevisionNotice>, ConnectionGuard)> {
        let connection = self.connections.fetch_add(1, Ordering::AcqRel);
        if connection >= MAX_CONNECTIONS {
            self.connections.fetch_sub(1, Ordering::AcqRel);
            return None;
        }
        crate::metrics::ws_connected();
        Some((
            self.sender.subscribe(),
            ConnectionGuard(self.connections.clone()),
        ))
    }

    pub(crate) fn publish(&self, vault_id: Uuid, revision: i64) {
        let _ = self.sender.send(RevisionNotice { vault_id, revision });
    }
}

pub(crate) struct ConnectionGuard(Arc<AtomicUsize>);

impl Drop for ConnectionGuard {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
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
    let (notifications, guard) = state
        .notifications
        .subscribe()
        .ok_or(StatusCode::SERVICE_UNAVAILABLE)?;
    Ok(websocket
        .on_upgrade(move |socket| serve(socket, pool, vault_id, user_id, notifications, guard)))
}

async fn serve(
    mut socket: WebSocket,
    pool: sqlx::PgPool,
    vault_id: Uuid,
    user_id: Uuid,
    mut notifications: broadcast::Receiver<RevisionNotice>,
    _guard: ConnectionGuard,
) {
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
                Ok(notice) if notice.vault_id == vault_id => {
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
                Ok(_) => {}
                Err(broadcast::error::RecvError::Lagged(_)) | Err(broadcast::error::RecvError::Closed) => return,
            },
            _ = heartbeat.tick() => {
                if socket.send(Message::Ping(Vec::new().into())).await.is_err() {
                    return;
                }
            },
        }
    }
}
