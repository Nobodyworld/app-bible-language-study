mod commands;
mod error;
mod logging;
mod security;
mod state;
mod storage;

use commands::{
    desktop_environment, native_flush_status, open_backup, open_external_url, read_packaged_data,
    read_user_store, save_backup, write_user_store,
};
use security::navigation_policy_plugin;
use state::AppState;
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(navigation_policy_plugin())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let state = AppState::from_app(app)?;
            state.logger.event("application_started");
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            desktop_environment,
            read_user_store,
            write_user_store,
            native_flush_status,
            read_packaged_data,
            save_backup,
            open_backup,
            open_external_url,
        ])
        .run(tauri::generate_context!())
        .expect("Bible App Reader encountered a native runtime failure");
}
