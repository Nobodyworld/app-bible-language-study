use crate::error::NativeError;
use crate::logging::NativeLogger;
use crate::storage::ProfileId;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{App, Manager};

#[derive(Debug, Clone)]
pub struct AppPaths {
    user_data_root: PathBuf,
    logs: PathBuf,
    temporary_root: PathBuf,
    distribution: PathBuf,
}

impl AppPaths {
    pub fn from_app(app: &App) -> Result<Self, NativeError> {
        let resolver = app.path();
        let distribution = resolver.resource_dir().map_err(|_| {
            NativeError::new(
                "resources_unavailable",
                "The installed resource directory is unavailable.",
            )
        })?;
        #[cfg(debug_assertions)]
        if let Some(root) = std::env::var_os("BIBLEAPP_E2E_ROOT") {
            let root = PathBuf::from(root);
            let allowed_name = root
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("bibleapp-e2e-"));
            if !root.is_absolute() || !allowed_name {
                return Err(NativeError::new(
                    "test_root_invalid",
                    "The debug-only test data root is invalid.",
                ));
            }
            return Self::from_roots(
                root.join("user-data"),
                root.join("logs"),
                root.join("temporary"),
                distribution,
            );
        }
        let app_data = resolver.app_data_dir().map_err(|_| {
            NativeError::new(
                "app_data_unavailable",
                "The application data directory is unavailable.",
            )
        })?;
        let logs = resolver.app_log_dir().map_err(|_| {
            NativeError::new(
                "logs_unavailable",
                "The application log directory is unavailable.",
            )
        })?;
        let cache = resolver.app_cache_dir().map_err(|_| {
            NativeError::new(
                "cache_unavailable",
                "The application cache directory is unavailable.",
            )
        })?;
        Self::from_roots(
            app_data.join("user-data"),
            logs,
            cache.join("temporary"),
            distribution,
        )
    }

    fn from_roots(
        user_data_root: PathBuf,
        logs: PathBuf,
        temporary_root: PathBuf,
        distribution: PathBuf,
    ) -> Result<Self, NativeError> {
        let paths = Self {
            user_data_root,
            logs,
            temporary_root,
            distribution,
        };
        for directory in [&paths.user_data_root, &paths.logs, &paths.temporary_root] {
            fs::create_dir_all(directory).map_err(|_| {
                NativeError::io(
                    "app_directory_failed",
                    "prepare an application-owned directory",
                )
            })?;
        }
        Ok(paths)
    }

    #[cfg(test)]
    pub fn for_test(root: &Path) -> Self {
        Self {
            user_data_root: root.join("user-data"),
            logs: root.join("logs"),
            temporary_root: root.join("temporary"),
            distribution: root.join("resources"),
        }
    }

    pub fn profile_data(&self, profile: ProfileId) -> PathBuf {
        self.user_data_root.join(profile.as_str())
    }

    pub fn profile_temporary(&self, profile: ProfileId) -> PathBuf {
        self.temporary_root.join(profile.as_str())
    }

    pub fn logs(&self) -> &Path {
        &self.logs
    }

    pub fn distribution(&self) -> &Path {
        &self.distribution
    }
}

#[derive(Debug, Clone)]
pub struct AppState {
    pub paths: AppPaths,
    pub logger: Arc<NativeLogger>,
    pub application_id: String,
    pub application_version: String,
    pub startup_profile: ProfileId,
}

impl AppState {
    pub fn from_app(app: &App) -> Result<Self, NativeError> {
        let paths = AppPaths::from_app(app)?;
        let logger = Arc::new(NativeLogger::new(paths.logs())?);
        Ok(Self {
            application_id: app.config().identifier.clone(),
            application_version: app.package_info().version.to_string(),
            startup_profile: ProfileId::for_build(),
            paths,
            logger,
        })
    }
}
