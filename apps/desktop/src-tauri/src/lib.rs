#![forbid(unsafe_code)]

use tauri::Manager;

pub mod commands;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            app.manage(commands::VaultCommands::new(commands::TauriDialog::new(
                app.handle().clone(),
            )));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::open_vault,
            commands::list_notes,
            commands::read_note,
            commands::write_note,
            commands::rename_note,
            commands::trash_note,
            commands::search_notes,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Synapse desktop application");
}
