use serde::{Deserialize, Serialize};

use super::error::HostError;

pub const DEFAULT_RETENTION_DAYS: u32 = 7;

fn default_true() -> bool {
    true
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub history_retention_days: u32,
    pub pc_display_name: String,
    pub auto_start_with_os: bool,
    #[serde(default = "default_true")]
    pub close_to_tray: bool,
    #[serde(default = "default_true")]
    pub auto_copy_to_clipboard: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            history_retention_days: DEFAULT_RETENTION_DAYS,
            pc_display_name: "My PC".to_string(),
            auto_start_with_os: false,
            close_to_tray: true,
            auto_copy_to_clipboard: true,
        }
    }
}

pub fn settings_from_json(text: &str) -> Result<Settings, HostError> {
    let mut settings: Settings =
        serde_json::from_str(text).map_err(|error| HostError::Storage(error.to_string()))?;
    if validate_retention(settings.history_retention_days).is_err() {
        settings.history_retention_days = DEFAULT_RETENTION_DAYS;
    }
    if validate_name(&settings.pc_display_name).is_err() {
        settings.pc_display_name = "My PC".to_string();
    } else {
        settings.pc_display_name = settings.pc_display_name.trim().to_string();
    }
    Ok(settings)
}

pub fn validate_retention(days: u32) -> Result<(), HostError> {
    if (1..=90).contains(&days) {
        Ok(())
    } else {
        Err(HostError::InvalidRetention)
    }
}

pub fn validate_name(name: &str) -> Result<(), HostError> {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed.len() > 64 || name.chars().any(char::is_control) {
        Err(HostError::InvalidName)
    } else {
        Ok(())
    }
}
