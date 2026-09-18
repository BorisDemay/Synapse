use std::collections::HashMap;
use std::error::Error;
use std::fmt;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher, event};
use tokio::sync::mpsc;

use crate::VaultPath;

const INTERNAL_CHANGE_WINDOW: Duration = Duration::from_secs(1);
const DEBOUNCE_WINDOW: Duration = Duration::from_millis(50);

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum VaultChange {
    Created(VaultPath),
    Modified(VaultPath),
    Renamed { from: VaultPath, to: VaultPath },
    Removed(VaultPath),
    VaultRootRemoved,
}

#[derive(Debug)]
pub enum VaultWatchError {
    Closed,
    Notify(notify::Error),
}

impl fmt::Display for VaultWatchError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Closed => formatter.write_str("vault watcher stopped"),
            Self::Notify(error) => error.fmt(formatter),
        }
    }
}

impl Error for VaultWatchError {}

pub struct VaultWatcher {
    _watcher: RecommendedWatcher,
    changes: mpsc::Receiver<Result<VaultChange, VaultWatchError>>,
    suppressed_paths: Arc<Mutex<HashMap<VaultPath, Instant>>>,
}

impl VaultWatcher {
    pub fn watch(root: impl AsRef<Path>) -> Result<Self, notify::Error> {
        let root = root.as_ref().to_path_buf();
        let (sender, raw_changes) = mpsc::unbounded_channel();
        let suppressed_paths = Arc::new(Mutex::new(HashMap::new()));
        let pending_rename = Arc::new(Mutex::new(None));
        let callback_suppressions = Arc::clone(&suppressed_paths);
        let callback_rename = Arc::clone(&pending_rename);
        let callback_root = root.clone();
        let mut watcher = notify::recommended_watcher(move |event| {
            let changes = match event {
                Ok(event) => map_event(
                    &callback_root,
                    event,
                    &callback_suppressions,
                    &callback_rename,
                )
                .into_iter()
                .map(Ok)
                .collect(),
                Err(error) => vec![Err(VaultWatchError::Notify(error))],
            };
            for change in changes {
                let _ = sender.send(change);
            }
        })?;
        watcher.watch(&root, RecursiveMode::Recursive)?;

        let (change_sender, changes) = mpsc::channel(32);
        tokio::spawn(debounce_changes(raw_changes, change_sender));

        Ok(Self {
            _watcher: watcher,
            changes,
            suppressed_paths,
        })
    }

    pub fn suppress_internal_change(&self, path: &VaultPath) {
        if let Ok(mut suppressed_paths) = self.suppressed_paths.lock() {
            let now = Instant::now();
            suppressed_paths.retain(|_, expiry| *expiry > now);
            suppressed_paths.insert(path.clone(), now + INTERNAL_CHANGE_WINDOW);
        }
    }

    pub async fn next_change(&mut self) -> Result<VaultChange, VaultWatchError> {
        self.changes
            .recv()
            .await
            .unwrap_or(Err(VaultWatchError::Closed))
    }
}

async fn debounce_changes(
    mut raw_changes: mpsc::UnboundedReceiver<Result<VaultChange, VaultWatchError>>,
    change_sender: mpsc::Sender<Result<VaultChange, VaultWatchError>>,
) {
    while let Some(first) = raw_changes.recv().await {
        let deadline = tokio::time::Instant::now() + DEBOUNCE_WINDOW;
        let mut changes = vec![first];
        while let Ok(Some(change)) = tokio::time::timeout_at(deadline, raw_changes.recv()).await {
            if !changes
                .iter()
                .any(|existing| same_path_change(existing, &change))
            {
                changes.push(change);
            }
        }
        for change in changes {
            if change_sender.send(change).await.is_err() {
                return;
            }
        }
    }
}

fn same_path_change(
    existing: &Result<VaultChange, VaultWatchError>,
    candidate: &Result<VaultChange, VaultWatchError>,
) -> bool {
    match (existing, candidate) {
        (Ok(VaultChange::Created(left)), Ok(VaultChange::Modified(right)))
        | (Ok(VaultChange::Modified(left)), Ok(VaultChange::Modified(right))) => left == right,
        _ => false,
    }
}

fn map_event(
    root: &Path,
    event: Event,
    suppressed_paths: &Mutex<HashMap<VaultPath, Instant>>,
    pending_rename: &Mutex<Option<VaultPath>>,
) -> Vec<VaultChange> {
    if matches!(event.kind, EventKind::Modify(event::ModifyKind::Name(_))) && event.paths.len() == 2
    {
        let from = vault_path(root, &event.paths[0], suppressed_paths);
        let to = vault_path(root, &event.paths[1], suppressed_paths);
        return match (from, to) {
            (Some(from), Some(to)) => vec![VaultChange::Renamed { from, to }],
            _ => Vec::new(),
        };
    }

    if matches!(
        event.kind,
        EventKind::Modify(event::ModifyKind::Name(event::RenameMode::From))
    ) {
        if let Some(path) = event
            .paths
            .first()
            .and_then(|path| vault_path(root, path, suppressed_paths))
            && let Ok(mut pending_rename) = pending_rename.lock()
        {
            *pending_rename = Some(path);
        }
        return Vec::new();
    }

    if matches!(
        event.kind,
        EventKind::Modify(event::ModifyKind::Name(event::RenameMode::To))
    ) {
        let to = event
            .paths
            .first()
            .and_then(|path| vault_path(root, path, suppressed_paths));
        let from = pending_rename
            .lock()
            .ok()
            .and_then(|mut rename| rename.take());
        return match (from, to) {
            (Some(from), Some(to)) => vec![VaultChange::Renamed { from, to }],
            _ => Vec::new(),
        };
    }

    event
        .paths
        .iter()
        .filter_map(|path| match event.kind {
            EventKind::Create(_) => {
                vault_path(root, path, suppressed_paths).map(VaultChange::Created)
            }
            EventKind::Modify(_) => {
                vault_path(root, path, suppressed_paths).map(VaultChange::Modified)
            }
            EventKind::Remove(_) if path == root => Some(VaultChange::VaultRootRemoved),
            EventKind::Remove(_) => {
                vault_path(root, path, suppressed_paths).map(VaultChange::Removed)
            }
            _ => None,
        })
        .collect()
}

fn vault_path(
    root: &Path,
    path: &Path,
    suppressed_paths: &Mutex<HashMap<VaultPath, Instant>>,
) -> Option<VaultPath> {
    let relative_path = path.strip_prefix(root).ok()?.to_str()?;
    if relative_path
        .split('/')
        .any(|component| component == ".synapse-trash")
        || relative_path.ends_with(".synapse-tmp")
    {
        return None;
    }

    let path = VaultPath::parse(relative_path).ok()?;
    let now = Instant::now();
    let mut suppressed_paths = suppressed_paths.lock().ok()?;
    suppressed_paths.retain(|_, expiry| *expiry > now);
    (!suppressed_paths.contains_key(&path)).then_some(path)
}
