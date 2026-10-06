use serde::{Deserialize, Serialize};

use super::error::HostError;

pub const DEFAULT_RETENTION_DAYS: u32 = 7;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub history_retention_days: u32,
    pub pc_display_name: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            history_retention_days: DEFAULT_RETENTION_DAYS,
            pc_display_name: "My PC".to_string(),
        }
    }
}

pub fn settings_from_json(text: &str) -> Result<Settings, HostError> {
    serde_json::from_str(text).map_err(|error| HostError::Storage(error.to_string()))
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
    if trimmed.is_empty() || trimmed.len() > 64 {
        Err(HostError::InvalidName)
    } else {
        Ok(())
    }
}
