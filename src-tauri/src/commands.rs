use crate::error::NativeError;
use crate::security::validate_external_url;
use crate::state::AppState;
use crate::storage::{
    atomic_write_bytes, read_store, write_store, ProfileId, StoreId, StoreReadResult,
    StoreWriteResult, MAX_BACKUP_BYTES,
};
use rfd::AsyncFileDialog;
use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::path::{Component, Path};
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

const MAX_PACKAGED_DATA_BYTES: u64 = 16 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopEnvironment {
    application_id: String,
    application_version: String,
    profile_id: String,
    persistent_data_path: String,
    logs_path: String,
    temporary_path: String,
    distribution_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FlushStatus {
    status: &'static str,
    profile_id: String,
    pending_writes: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextFileResult {
    status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackagedDataResult {
    status: &'static str,
    text: String,
    media_type: &'static str,
}

fn path_text(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn basename(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("bibleapp-user-data.json")
        .to_string()
}

fn sanitize_suggested_name(value: &str) -> String {
    let cleaned: String = value
        .chars()
        .map(|character| {
            if character.is_control() || "<>:\"/\\|?*".contains(character) {
                '-'
            } else {
                character
            }
        })
        .take(120)
        .collect();
    let trimmed = cleaned.trim().trim_matches('.').trim();
    let base = if trimmed.is_empty() {
        "bibleapp-user-data.json".to_string()
    } else {
        trimmed.to_string()
    };
    if base.to_ascii_lowercase().ends_with(".json") {
        base
    } else {
        format!("{base}.json")
    }
}

fn validate_portable_backup(value: &Value) -> Result<(), NativeError> {
    if value.get("kind").and_then(Value::as_str) != Some("bibleapp:user-data")
        || value.get("version").and_then(Value::as_u64) != Some(3)
    {
        return Err(NativeError::new(
            "backup_contract_invalid",
            "The selected JSON is not a Bible App version-3 user-data backup.",
        ));
    }
    Ok(())
}

fn packaged_data_path(
    distribution: &Path,
    relative_path: &str,
) -> Result<std::path::PathBuf, NativeError> {
    if relative_path.contains(['\\', '\0']) || relative_path.len() > 512 {
        return Err(NativeError::new(
            "packaged_path_invalid",
            "The packaged data path is invalid.",
        ));
    }
    let relative = Path::new(relative_path);
    let parts: Vec<_> = relative.components().collect();
    if parts.len() < 2
        || parts.first() != Some(&Component::Normal(std::ffi::OsStr::new("data")))
        || parts
            .iter()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err(NativeError::new(
            "packaged_path_rejected",
            "The packaged data path is outside the installed data directory.",
        ));
    }
    Ok(distribution.join(relative))
}

fn read_packaged_text(distribution: &Path, relative_path: &str) -> Result<String, NativeError> {
    let candidate = packaged_data_path(distribution, relative_path)?;
    let root = distribution.canonicalize().map_err(|_| {
        NativeError::new(
            "packaged_root_unavailable",
            "The installed data directory is unavailable.",
        )
    })?;
    let canonical = candidate.canonicalize().map_err(|_| {
        NativeError::new(
            "packaged_data_missing",
            "The requested installed data file is unavailable.",
        )
    })?;
    if !canonical.starts_with(&root) {
        return Err(NativeError::new(
            "packaged_path_escape",
            "The requested installed data file is outside the application distribution.",
        ));
    }
    let metadata = fs::metadata(&canonical).map_err(|_| {
        NativeError::new(
            "packaged_data_unavailable",
            "The requested installed data file is unavailable.",
        )
    })?;
    if !metadata.is_file() || metadata.len() > MAX_PACKAGED_DATA_BYTES {
        return Err(NativeError::new(
            "packaged_data_size_rejected",
            "The requested installed data file is not an approved regular file size.",
        ));
    }
    let bytes = fs::read(&canonical).map_err(|_| {
        NativeError::new(
            "packaged_data_read_failed",
            "The requested installed data file could not be read.",
        )
    })?;
    String::from_utf8(bytes).map_err(|_| {
        NativeError::new(
            "packaged_data_utf8_invalid",
            "The requested installed data file is not valid UTF-8.",
        )
    })
}

pub fn write_export_to_path(path: &Path, text: &str) -> Result<(), NativeError> {
    if text.len() as u64 > MAX_BACKUP_BYTES {
        return Err(NativeError::new(
            "file_too_large",
            "The backup exceeds the supported 32 MiB size limit.",
        ));
    }
    let value: Value = serde_json::from_str(text).map_err(|_| {
        NativeError::new(
            "backup_json_invalid",
            "The backup could not be serialized as valid JSON.",
        )
    })?;
    validate_portable_backup(&value)?;
    atomic_write_bytes(
        path,
        text.as_bytes(),
        MAX_BACKUP_BYTES,
        ".bibleapp-export.tmp-",
    )
}

pub fn read_import_from_path(path: &Path) -> Result<String, NativeError> {
    let metadata = fs::metadata(path)
        .map_err(|_| NativeError::io("backup_metadata_failed", "inspect the selected backup"))?;
    if !metadata.is_file() {
        return Err(NativeError::new(
            "backup_not_file",
            "The selected backup is not a regular file.",
        ));
    }
    if metadata.len() > MAX_BACKUP_BYTES {
        return Err(NativeError::new(
            "file_too_large",
            "The selected backup exceeds the supported 32 MiB size limit.",
        ));
    }
    let bytes = fs::read(path)
        .map_err(|_| NativeError::io("backup_read_failed", "read the selected backup"))?;
    if bytes.len() as u64 > MAX_BACKUP_BYTES {
        return Err(NativeError::new(
            "file_too_large",
            "The selected backup exceeds the supported 32 MiB size limit.",
        ));
    }
    let text = String::from_utf8(bytes).map_err(|_| {
        NativeError::new(
            "backup_utf8_invalid",
            "The selected backup is not valid UTF-8 text.",
        )
    })?;
    let value: Value = serde_json::from_str(&text).map_err(|_| {
        NativeError::new(
            "backup_json_invalid",
            "The selected backup is not valid JSON.",
        )
    })?;
    validate_portable_backup(&value)?;
    Ok(text)
}

fn environment_for(
    profile: ProfileId,
    state: &AppState,
) -> Result<DesktopEnvironment, NativeError> {
    let persistent = state.paths.profile_data(profile);
    let temporary = state.paths.profile_temporary(profile);
    fs::create_dir_all(&persistent).map_err(|_| {
        NativeError::io(
            "profile_directory_failed",
            "prepare the profile data directory",
        )
    })?;
    fs::create_dir_all(&temporary).map_err(|_| {
        NativeError::io(
            "temporary_directory_failed",
            "prepare the temporary directory",
        )
    })?;
    Ok(DesktopEnvironment {
        application_id: state.application_id.clone(),
        application_version: state.application_version.clone(),
        profile_id: profile.as_str().to_string(),
        persistent_data_path: path_text(&persistent),
        logs_path: path_text(state.paths.logs()),
        temporary_path: path_text(&temporary),
        distribution_path: path_text(state.paths.distribution()),
    })
}

#[tauri::command]
pub fn desktop_environment(
    profile_id: String,
    state: State<'_, AppState>,
) -> Result<DesktopEnvironment, NativeError> {
    environment_for(ProfileId::parse(&profile_id)?, &state)
}

#[tauri::command]
pub fn read_user_store(
    profile_id: String,
    store_id: String,
    state: State<'_, AppState>,
) -> Result<StoreReadResult, NativeError> {
    let profile = ProfileId::parse(&profile_id)?;
    let store = StoreId::parse(&store_id)?;
    let result = read_store(&state.paths, profile, store);
    match &result {
        Ok(value) if value.status == "corrupt" => {
            state.logger.event("user_store_corrupt_preserved")
        }
        Err(_) => state.logger.event("user_store_read_failed"),
        _ => {}
    }
    result
}

#[tauri::command]
pub fn write_user_store(
    profile_id: String,
    store_id: String,
    value: Value,
    recover_corrupt: bool,
    state: State<'_, AppState>,
) -> Result<StoreWriteResult, NativeError> {
    let profile = ProfileId::parse(&profile_id)?;
    let store = StoreId::parse(&store_id)?;
    let result = write_store(&state.paths, profile, store, value, recover_corrupt);
    match &result {
        Ok(value) if value.recovered_corrupt => {
            state.logger.event("user_store_recovered_from_backup")
        }
        Ok(_) => state.logger.event("user_store_saved"),
        Err(_) => state.logger.event("user_store_write_failed"),
    }
    result
}

#[tauri::command]
pub fn native_flush_status(
    profile_id: String,
    pending_writes: usize,
    _state: State<'_, AppState>,
) -> Result<FlushStatus, NativeError> {
    let profile = ProfileId::parse(&profile_id)?;
    if pending_writes != 0 {
        return Err(NativeError::new(
            "flush_pending_writes",
            "Native persistence still has pending writes.",
        ));
    }
    Ok(FlushStatus {
        status: "flushed",
        profile_id: profile.as_str().to_string(),
        pending_writes,
    })
}

#[tauri::command]
pub fn read_packaged_data(
    relative_path: String,
    state: State<'_, AppState>,
) -> Result<PackagedDataResult, NativeError> {
    let text = read_packaged_text(state.paths.distribution(), &relative_path)?;
    Ok(PackagedDataResult {
        status: "ok",
        text,
        media_type: "application/json; charset=utf-8",
    })
}

#[tauri::command]
pub async fn save_backup(
    text: String,
    suggested_name: String,
    state: State<'_, AppState>,
) -> Result<TextFileResult, NativeError> {
    let selected = AsyncFileDialog::new()
        .add_filter("Bible App JSON backup", &["json"])
        .set_file_name(sanitize_suggested_name(&suggested_name))
        .save_file()
        .await;
    let Some(selected) = selected else {
        return Ok(TextFileResult {
            status: "cancelled",
            name: None,
            text: None,
        });
    };
    let mut path = selected.path().to_path_buf();
    if path.extension().and_then(|value| value.to_str()) != Some("json") {
        path.set_extension("json");
    }
    if let Err(error) = write_export_to_path(&path, &text) {
        state.logger.event("backup_save_failed");
        return Err(error);
    }
    state.logger.event("backup_saved");
    Ok(TextFileResult {
        status: "saved",
        name: Some(basename(&path)),
        text: None,
    })
}

#[tauri::command]
pub async fn open_backup(state: State<'_, AppState>) -> Result<TextFileResult, NativeError> {
    let selected = AsyncFileDialog::new()
        .add_filter("Bible App JSON backup", &["json"])
        .pick_file()
        .await;
    let Some(selected) = selected else {
        return Ok(TextFileResult {
            status: "cancelled",
            name: None,
            text: None,
        });
    };
    let path = selected.path();
    if path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| !extension.eq_ignore_ascii_case("json"))
        .unwrap_or(true)
    {
        return Err(NativeError::new(
            "backup_extension_invalid",
            "The selected backup must be a JSON file.",
        ));
    }
    let text = match read_import_from_path(path) {
        Ok(text) => text,
        Err(error) => {
            state.logger.event("backup_open_failed");
            return Err(error);
        }
    };
    state.logger.event("backup_opened");
    Ok(TextFileResult {
        status: "opened",
        name: Some(basename(path)),
        text: Some(text),
    })
}

#[tauri::command]
pub fn open_external_url(
    url: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), NativeError> {
    let parsed = validate_external_url(&url)?;
    app.opener()
        .open_url(parsed.as_str(), None::<&str>)
        .map_err(|_| {
            NativeError::new(
                "external_open_failed",
                "The approved external reference could not be opened.",
            )
        })?;
    state.logger.event("external_reference_opened");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::logging::NativeLogger;
    use crate::state::AppPaths;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::Arc;

    static COUNTER: AtomicU64 = AtomicU64::new(0);

    fn test_root(label: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "bible-app-reader-command-{label}-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&root).unwrap();
        root
    }

    fn backup_text(extra: &str) -> String {
        format!(r#"{{"kind":"bibleapp:user-data","version":3,"stores":{{}},"note":"{extra}"}}"#)
    }

    #[test]
    fn native_export_and_import_round_trip_utf8() {
        let root = test_root("backup");
        let path = root.join("backup.json");
        let text = backup_text("שלום");
        write_export_to_path(&path, &text).unwrap();
        assert_eq!(read_import_from_path(&path).unwrap(), text);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn invalid_json_and_non_backup_json_are_rejected() {
        let root = test_root("invalid");
        let path = root.join("bad.json");
        fs::write(&path, b"{bad").unwrap();
        assert_eq!(
            read_import_from_path(&path).unwrap_err().code,
            "backup_json_invalid"
        );
        fs::write(&path, br#"{"kind":"other","version":3}"#).unwrap();
        assert_eq!(
            read_import_from_path(&path).unwrap_err().code,
            "backup_contract_invalid"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn suggested_names_are_bounded_and_sanitized() {
        let sanitized = sanitize_suggested_name("../../owner:<backup>");
        assert_eq!(sanitized, "-..-owner--backup-.json");
        assert!(sanitized.len() <= 125);
        assert_eq!(sanitize_suggested_name("backup.json"), "backup.json");
    }

    #[test]
    fn public_errors_do_not_include_selected_paths() {
        let path = PathBuf::from(r"C:\owner\private\missing.json");
        let error = read_import_from_path(&path).unwrap_err();
        assert!(!error.message.contains("owner"));
        assert!(!error.message.contains("C:"));
    }

    #[test]
    fn packaged_data_is_distribution_owned_and_bounded() {
        let root = test_root("packaged");
        let distribution = root.join("resources");
        fs::create_dir_all(distribution.join("data")).unwrap();
        fs::write(
            distribution.join("data").join("manifest.json"),
            "{\"ok\":true}",
        )
        .unwrap();
        assert_eq!(
            read_packaged_text(&distribution, "data/manifest.json").unwrap(),
            "{\"ok\":true}"
        );
        for rejected in [
            "../owner.json",
            "data/../owner.json",
            "data\\manifest.json",
            "C:/owner/private.json",
            "https://example.com/data.json",
        ] {
            assert!(
                read_packaged_text(&distribution, rejected).is_err(),
                "{rejected}"
            );
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn environment_reports_only_tauri_owned_profile_paths() {
        let root = test_root("environment");
        let paths = AppPaths::for_test(&root);
        let state = AppState {
            logger: Arc::new(NativeLogger::new(paths.logs()).unwrap()),
            paths,
            application_id: "com.nobodyworld.bibleappreader".to_string(),
            application_version: "1.0.0".to_string(),
        };
        let stable = environment_for(ProfileId::Stable, &state).unwrap();
        let lab = environment_for(ProfileId::Lab, &state).unwrap();
        assert_eq!(stable.profile_id, "stable");
        assert_eq!(lab.profile_id, "lab");
        assert_ne!(stable.persistent_data_path, lab.persistent_data_path);
        assert!(Path::new(&stable.persistent_data_path).starts_with(&root));
        assert!(Path::new(&lab.temporary_path).starts_with(&root));
        assert!(Path::new(&stable.logs_path).starts_with(&root));
        assert!(Path::new(&stable.distribution_path).starts_with(&root));
        fs::remove_dir_all(root).unwrap();
    }
}
