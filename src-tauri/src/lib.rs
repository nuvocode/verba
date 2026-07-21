mod speech;
mod vault;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        // Loaded speech models live here for the life of the app: Kokoro takes
        // ~0.6s to load and we would otherwise pay it on every single turn.
        .manage(speech::SpeechState::default())
        .invoke_handler(tauri::generate_handler![
            speech::models_installed,
            speech::model_download,
            speech::model_delete,
            speech::bundled_tts,
            speech::bundled_stt,
            vault::vault_meta,
            vault::vault_data,
            vault::vault_save,
            vault::vault_conflict,
            vault::vault_check,
            vault::file_read,
            vault::file_write,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
