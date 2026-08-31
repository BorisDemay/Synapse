use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, State, ipc::Channel};
use tauri_plugin_updater::{Update, UpdaterExt};
use url::Url;

use crate::commands::VaultCommands;

pub const UPDATER_PUBLIC_KEY: Option<&str> = option_env!("SYNAPSE_UPDATER_PUBLIC_KEY");

pub fn update_manifest_url(instance_origin: &str) -> Result<String, String> {
    let origin = Url::parse(instance_origin).map_err(|_| "invalid update instance")?;
    let allowed = origin.scheme() == "https"
        || (origin.scheme() == "http"
            && origin.host_str().is_some_and(|host| {
                host == "localhost"
                    || host
                        .parse::<std::net::IpAddr>()
                        .is_ok_and(|ip| ip.is_loopback())
            }));
    if !allowed
        || origin.cannot_be_a_base()
        || origin.path() != "/"
        || !origin.username().is_empty()
        || origin.password().is_some()
        || origin.query().is_some()
        || origin.fragment().is_some()
    {
        return Err("update instance must be HTTPS or loopback development".to_owned());
    }
    origin
        .join("updates/stable/latest.json")
        .map(|url| url.to_string())
        .map_err(|_| "invalid update endpoint".to_owned())
}

struct PreparedUpdate {
    update: Update,
    bytes: Option<Vec<u8>>,
}

#[derive(Default)]
pub struct DesktopUpdater {
    pending: Mutex<Option<PreparedUpdate>>,
}

impl DesktopUpdater {
    pub fn new() -> Self {
        Self::default()
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMetadata {
    version: String,
    commit_sha: String,
    published_at: String,
    release_notes: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    downloaded: usize,
    total: Option<u64>,
}

#[tauri::command]
pub async fn check_desktop_update(
    app: AppHandle,
    commands: State<'_, VaultCommands>,
    updater_state: State<'_, DesktopUpdater>,
) -> Result<Option<UpdateMetadata>, String> {
    if UPDATER_PUBLIC_KEY.is_none() {
        return Err("desktop updater is not configured".to_owned());
    }
    let endpoint = update_manifest_url(&commands.instance_origin()?)?;
    let endpoint = Url::parse(&endpoint).map_err(|_| "invalid update endpoint")?;
    let update = app
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|_| "desktop updater configuration failed")?
        .build()
        .map_err(|_| "desktop updater configuration failed")?
        .check()
        .await
        .map_err(|_| "desktop update check failed")?;
    let Some(update) = update else {
        *updater_state
            .pending
            .lock()
            .map_err(|_| "desktop updater is unavailable")? = None;
        return Ok(None);
    };
    let commit_sha = update
        .raw_json
        .get("commit_sha")
        .and_then(serde_json::Value::as_str)
        .filter(|sha| {
            (sha.len() == 40 || sha.len() == 64)
                && sha
                    .bytes()
                    .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
        })
        .ok_or("update manifest is missing commit_sha")?
        .to_owned();
    let metadata = UpdateMetadata {
        version: update.version.clone(),
        commit_sha,
        published_at: update
            .date
            .as_ref()
            .map(ToString::to_string)
            .ok_or("update manifest is missing pub_date")?,
        release_notes: update.body.clone().unwrap_or_default(),
    };
    *updater_state
        .pending
        .lock()
        .map_err(|_| "desktop updater is unavailable")? = Some(PreparedUpdate {
        update,
        bytes: None,
    });
    Ok(Some(metadata))
}

#[tauri::command]
pub async fn download_desktop_update(
    updater_state: State<'_, DesktopUpdater>,
    on_event: Channel<DownloadProgress>,
) -> Result<(), String> {
    let update = updater_state
        .pending
        .lock()
        .map_err(|_| "desktop updater is unavailable")?
        .as_ref()
        .map(|pending| pending.update.clone())
        .ok_or("there is no pending desktop update")?;
    let version = update.version.clone();
    let mut downloaded = 0usize;
    let bytes = update
        .download(
            |chunk_length, total| {
                downloaded = downloaded.saturating_add(chunk_length);
                let _ = on_event.send(DownloadProgress { downloaded, total });
            },
            || {},
        )
        .await
        .map_err(|_| "desktop update download or signature verification failed")?;
    let mut pending = updater_state
        .pending
        .lock()
        .map_err(|_| "desktop updater is unavailable")?;
    let prepared = pending
        .as_mut()
        .filter(|prepared| prepared.update.version == version)
        .ok_or("pending desktop update changed during download")?;
    prepared.bytes = Some(bytes);
    Ok(())
}

#[tauri::command]
pub fn install_desktop_update(
    app: AppHandle,
    updater_state: State<'_, DesktopUpdater>,
) -> Result<(), String> {
    let prepared = updater_state
        .pending
        .lock()
        .map_err(|_| "desktop updater is unavailable")?
        .take()
        .ok_or("there is no pending desktop update")?;
    let bytes = prepared
        .bytes
        .ok_or("desktop update has not been downloaded")?;
    prepared
        .update
        .install(bytes)
        .map_err(|_| "desktop update installation failed")?;
    app.restart();
}
