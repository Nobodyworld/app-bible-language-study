use crate::error::NativeError;
use crate::state::AppPaths;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

pub const INTERNAL_SCHEMA_VERSION: u32 = 1;
pub const MAX_STORE_BYTES: u64 = 16 * 1024 * 1024;
pub const MAX_BACKUP_BYTES: u64 = 32 * 1024 * 1024;
static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProfileId {
    Stable,
    Lab,
}

impl ProfileId {
    pub fn parse(value: &str) -> Result<Self, NativeError> {
        match value {
            "stable" => Ok(Self::Stable),
            "lab" => Ok(Self::Lab),
            _ => Err(NativeError::new(
                "invalid_profile",
                "The requested desktop profile is not supported.",
            )),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Stable => "stable",
            Self::Lab => "lab",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StoreId {
    Tags,
    Workspace,
    Assertions,
    Polls,
    Packages,
    ImportBackups,
}

impl StoreId {
    pub fn parse(value: &str) -> Result<Self, NativeError> {
        match value {
            "tags" => Ok(Self::Tags),
            "workspace" => Ok(Self::Workspace),
            "assertions" => Ok(Self::Assertions),
            "polls" => Ok(Self::Polls),
            "packages" => Ok(Self::Packages),
            "importBackups" => Ok(Self::ImportBackups),
            _ => Err(NativeError::new(
                "invalid_store",
                "The requested logical user-data store is not supported.",
            )),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Tags => "tags",
            Self::Workspace => "workspace",
            Self::Assertions => "assertions",
            Self::Polls => "polls",
            Self::Packages => "packages",
            Self::ImportBackups => "importBackups",
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct StoreEnvelope {
    schema_version: u32,
    profile_id: String,
    store_id: String,
    updated_unix_ms: u64,
    value: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreReadResult {
    pub status: &'static str,
    pub value: Option<Value>,
    pub temporary_files: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreWriteResult {
    pub status: &'static str,
    pub recovered_corrupt: bool,
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().try_into().unwrap_or(u64::MAX))
        .unwrap_or_default()
}

pub fn store_path(paths: &AppPaths, profile: ProfileId, store: StoreId) -> PathBuf {
    paths
        .profile_data(profile)
        .join(format!("{}.json", store.as_str()))
}

fn temporary_prefix(store: StoreId) -> String {
    format!(".{}.tmp-", store.as_str())
}

fn interrupted_temporary_count(directory: &Path, store: StoreId) -> usize {
    let prefix = temporary_prefix(store);
    fs::read_dir(directory)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter(|entry| {
            entry
                .file_name()
                .to_str()
                .map(|name| name.starts_with(&prefix))
                .unwrap_or(false)
        })
        .count()
}

fn parse_envelope(bytes: &[u8], profile: ProfileId, store: StoreId) -> Option<Value> {
    let envelope: StoreEnvelope = serde_json::from_slice(bytes).ok()?;
    if envelope.schema_version != INTERNAL_SCHEMA_VERSION
        || envelope.profile_id != profile.as_str()
        || envelope.store_id != store.as_str()
    {
        return None;
    }
    Some(envelope.value)
}

fn read_bounded(path: &Path, maximum: u64) -> Result<Vec<u8>, NativeError> {
    let metadata = fs::metadata(path)
        .map_err(|_| NativeError::io("read_metadata_failed", "inspect the selected data file"))?;
    if !metadata.is_file() {
        return Err(NativeError::new(
            "not_a_file",
            "The selected item is not a regular file.",
        ));
    }
    if metadata.len() > maximum {
        return Err(NativeError::new(
            "file_too_large",
            "The selected data file exceeds the supported size limit.",
        ));
    }
    let file = File::open(path)
        .map_err(|_| NativeError::io("read_open_failed", "open the selected data file"))?;
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(maximum + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| NativeError::io("read_failed", "read the selected data file"))?;
    if bytes.len() as u64 > maximum {
        return Err(NativeError::new(
            "file_too_large",
            "The selected data file exceeds the supported size limit.",
        ));
    }
    Ok(bytes)
}

pub fn read_store(
    paths: &AppPaths,
    profile: ProfileId,
    store: StoreId,
) -> Result<StoreReadResult, NativeError> {
    let directory = paths.profile_data(profile);
    fs::create_dir_all(&directory).map_err(|_| {
        NativeError::io("store_directory_failed", "prepare its user-data directory")
    })?;
    let temporary_files = interrupted_temporary_count(&directory, store);
    let path = store_path(paths, profile, store);
    if !path.exists() {
        return Ok(StoreReadResult {
            status: "missing",
            value: None,
            temporary_files,
        });
    }
    let bytes = match read_bounded(&path, MAX_STORE_BYTES) {
        Ok(bytes) => bytes,
        Err(error) if error.code == "file_too_large" || error.code == "not_a_file" => {
            return Ok(StoreReadResult {
                status: "corrupt",
                value: None,
                temporary_files,
            })
        }
        Err(error) => return Err(error),
    };
    let Some(value) = parse_envelope(&bytes, profile, store) else {
        return Ok(StoreReadResult {
            status: "corrupt",
            value: None,
            temporary_files,
        });
    };
    Ok(StoreReadResult {
        status: "ok",
        value: Some(value),
        temporary_files,
    })
}

fn unique_temporary_path(target: &Path, prefix: &str) -> Result<PathBuf, NativeError> {
    let parent = target.parent().ok_or_else(|| {
        NativeError::new("invalid_target", "The native output location is invalid.")
    })?;
    for _ in 0..100 {
        let counter = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
        let candidate = parent.join(format!("{prefix}{}-{counter}", std::process::id()));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err(NativeError::new(
        "temporary_name_failed",
        "The native application could not allocate a temporary file.",
    ))
}

#[cfg(windows)]
fn atomic_replace(temp: &Path, target: &Path) -> Result<(), NativeError> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };
    let temp_wide: Vec<u16> = temp.as_os_str().encode_wide().chain(Some(0)).collect();
    let target_wide: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
    let result = unsafe {
        MoveFileExW(
            temp_wide.as_ptr(),
            target_wide.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        return Err(NativeError::io(
            "atomic_replace_failed",
            "replace the destination atomically",
        ));
    }
    Ok(())
}

#[cfg(not(windows))]
fn atomic_replace(temp: &Path, target: &Path) -> Result<(), NativeError> {
    fs::rename(temp, target).map_err(|_| {
        NativeError::io(
            "atomic_replace_failed",
            "replace the destination atomically",
        )
    })
}

pub fn atomic_write_bytes(
    target: &Path,
    bytes: &[u8],
    maximum: u64,
    temp_prefix: &str,
) -> Result<(), NativeError> {
    if bytes.len() as u64 > maximum {
        return Err(NativeError::new(
            "file_too_large",
            "The data exceeds the supported size limit.",
        ));
    }
    let parent = target.parent().ok_or_else(|| {
        NativeError::new("invalid_target", "The native output location is invalid.")
    })?;
    fs::create_dir_all(parent)
        .map_err(|_| NativeError::io("output_directory_failed", "prepare the output directory"))?;
    let temporary = unique_temporary_path(target, temp_prefix)?;
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary)
        .map_err(|_| {
            NativeError::io(
                "temporary_create_failed",
                "create its temporary output file",
            )
        })?;
    file.write_all(bytes)
        .and_then(|_| file.flush())
        .and_then(|_| file.sync_all())
        .map_err(|_| {
            NativeError::io("temporary_write_failed", "write its temporary output file")
        })?;
    drop(file);
    atomic_replace(&temporary, target)
}

pub fn write_store(
    paths: &AppPaths,
    profile: ProfileId,
    store: StoreId,
    value: Value,
    recover_corrupt: bool,
) -> Result<StoreWriteResult, NativeError> {
    let target = store_path(paths, profile, store);
    let mut recovered_corrupt = false;
    if target.exists() {
        let existing = read_bounded(&target, MAX_STORE_BYTES).ok();
        let valid = existing
            .as_deref()
            .and_then(|bytes| parse_envelope(bytes, profile, store))
            .is_some();
        if !valid && !recover_corrupt {
            return Err(NativeError::new(
                "corrupt_store_preserved",
                "Existing malformed native data was preserved. Import a valid backup to recover this store.",
            ));
        }
        if !valid {
            let backup =
                target.with_file_name(format!("{}.corrupt-{}.json", store.as_str(), now_millis()));
            fs::copy(&target, &backup).map_err(|_| {
                NativeError::io("corrupt_backup_failed", "preserve malformed user data")
            })?;
            OpenOptions::new()
                .read(true)
                .write(true)
                .open(&backup)
                .and_then(|file| file.sync_all())
                .map_err(|_| {
                    NativeError::io("corrupt_backup_sync_failed", "preserve malformed user data")
                })?;
            recovered_corrupt = true;
        }
    }
    let envelope = StoreEnvelope {
        schema_version: INTERNAL_SCHEMA_VERSION,
        profile_id: profile.as_str().to_string(),
        store_id: store.as_str().to_string(),
        updated_unix_ms: now_millis(),
        value,
    };
    let bytes = serde_json::to_vec_pretty(&envelope).map_err(|_| {
        NativeError::new(
            "serialize_failed",
            "The native user-data value could not be serialized.",
        )
    })?;
    atomic_write_bytes(&target, &bytes, MAX_STORE_BYTES, &temporary_prefix(store))?;
    Ok(StoreWriteResult {
        status: "saved",
        recovered_corrupt,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn test_root(label: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "bible-app-reader-{label}-{}-{}",
            std::process::id(),
            TEMP_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn accepts_only_known_profiles_and_stores() {
        assert_eq!(ProfileId::parse("stable").unwrap(), ProfileId::Stable);
        assert_eq!(ProfileId::parse("lab").unwrap(), ProfileId::Lab);
        assert!(ProfileId::parse("../stable").is_err());
        assert!(ProfileId::parse("stable/../../owner").is_err());
        for store in [
            "tags",
            "workspace",
            "assertions",
            "polls",
            "packages",
            "importBackups",
        ] {
            assert!(StoreId::parse(store).is_ok());
        }
        assert!(StoreId::parse("../tags").is_err());
        assert!(StoreId::parse("unknown").is_err());
    }

    #[test]
    fn store_paths_are_contained_by_profile_directories() {
        let root = test_root("containment");
        let paths = AppPaths::for_test(&root);
        let stable = paths.profile_data(ProfileId::Stable);
        let store = store_path(&paths, ProfileId::Stable, StoreId::Workspace);
        assert!(store.starts_with(&stable));
        assert_eq!(store.file_name().unwrap(), "workspace.json");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn atomic_writes_replace_complete_envelopes_and_profiles_are_isolated() {
        let root = test_root("atomic");
        let paths = AppPaths::for_test(&root);
        let first = serde_json::json!({"revision": 1});
        let second = serde_json::json!({"revision": 2});
        write_store(&paths, ProfileId::Stable, StoreId::Tags, first, false).unwrap();
        write_store(
            &paths,
            ProfileId::Stable,
            StoreId::Tags,
            second.clone(),
            false,
        )
        .unwrap();
        assert_eq!(
            read_store(&paths, ProfileId::Stable, StoreId::Tags)
                .unwrap()
                .value,
            Some(second)
        );
        assert_eq!(
            read_store(&paths, ProfileId::Lab, StoreId::Tags)
                .unwrap()
                .status,
            "missing"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn malformed_data_and_interrupted_temp_files_are_preserved() {
        let root = test_root("corrupt");
        let paths = AppPaths::for_test(&root);
        let directory = paths.profile_data(ProfileId::Stable);
        fs::create_dir_all(&directory).unwrap();
        let target = store_path(&paths, ProfileId::Stable, StoreId::Tags);
        fs::write(&target, b"{not-json").unwrap();
        fs::write(directory.join(".tags.tmp-interrupted"), b"partial").unwrap();
        let read = read_store(&paths, ProfileId::Stable, StoreId::Tags).unwrap();
        assert_eq!(read.status, "corrupt");
        assert_eq!(read.temporary_files, 1);
        assert!(write_store(
            &paths,
            ProfileId::Stable,
            StoreId::Tags,
            serde_json::json!({}),
            false
        )
        .is_err());
        let recovered = write_store(
            &paths,
            ProfileId::Stable,
            StoreId::Tags,
            serde_json::json!({"recovered": true}),
            true,
        )
        .unwrap();
        assert!(recovered.recovered_corrupt);
        assert!(fs::read_dir(&directory).unwrap().flatten().any(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with("tags.corrupt-")
        }));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn maximum_size_is_enforced_before_writing() {
        let root = test_root("maximum");
        let target = root.join("oversized.json");
        let bytes = vec![b'x'; 33 * 1024 * 1024];
        let error =
            atomic_write_bytes(&target, &bytes, MAX_BACKUP_BYTES, ".oversized.tmp-").unwrap_err();
        assert_eq!(error.code, "file_too_large");
        assert!(!target.exists());
        fs::remove_dir_all(root).unwrap();
    }
}
