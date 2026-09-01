use crate::error::NativeError;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_LOG_BYTES: u64 = 1_048_576;

#[derive(Debug)]
pub struct NativeLogger {
    path: PathBuf,
    lock: Mutex<()>,
}

impl NativeLogger {
    pub fn new(log_dir: &Path) -> Result<Self, NativeError> {
        fs::create_dir_all(log_dir)
            .map_err(|_| NativeError::io("log_directory_failed", "prepare its log directory"))?;
        Ok(Self {
            path: log_dir.join("bible-app-reader.log"),
            lock: Mutex::new(()),
        })
    }

    pub fn event(&self, code: &str) {
        let safe_code: String = code
            .chars()
            .filter(|character| character.is_ascii_alphanumeric() || matches!(character, '_' | '-'))
            .take(80)
            .collect();
        if safe_code.is_empty() {
            return;
        }
        let Ok(_guard) = self.lock.lock() else {
            return;
        };
        if fs::metadata(&self.path)
            .map(|metadata| metadata.len() >= MAX_LOG_BYTES)
            .unwrap_or(false)
        {
            let rotated = self.path.with_extension("log.1");
            let _ = fs::remove_file(&rotated);
            let _ = fs::rename(&self.path, rotated);
        }
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_secs())
            .unwrap_or_default();
        if let Ok(mut file) = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)
        {
            let _ = writeln!(file, "{timestamp} {safe_code}");
        }
    }
}
