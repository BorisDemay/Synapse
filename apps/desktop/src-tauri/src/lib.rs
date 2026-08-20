#![forbid(unsafe_code)]

use tauri::{Manager, PhysicalPosition, Position};

pub mod commands;
pub mod http;

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            app.manage(commands::VaultCommands::new());
            if let Some(window) = app.get_webview_window("main") {
                window.set_position(Position::Physical(PhysicalPosition::new(100, 100)))?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::synapse_request,
            commands::set_instance_url,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Synapse desktop application");
}
