use chrono::{DateTime, Utc};
use serde::Deserialize;

use crate::domain::{validate_name, validate_retention, HostError, Settings};
use crate::ports::Store;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SettingsPatch {
    history_retention_days: Option<u32>,
    pc_display_name: Option<String>,
    auto_start_with_os: Option<bool>,
    close_to_tray: Option<bool>,
    auto_copy_to_clipboard: Option<bool>,
}

pub fn update_settings(
    store: &mut impl Store,
    patch_json: &str,
    now: DateTime<Utc>,
) -> Result<Settings, HostError> {
    let patch: SettingsPatch =
        serde_json::from_str(patch_json).map_err(|_| HostError::UnknownSettingsField)?;
    let mut settings = store.load_settings()?;
    if let Some(days) = patch.history_retention_days {
        validate_retention(days)?;
        if days < settings.history_retention_days {
            crate::use_cases::purge_expired(store, now, days)?;
        }
        settings.history_retention_days = days;
    }
    if let Some(name) = patch.pc_display_name {
        validate_name(&name)?;
        settings.pc_display_name = name.trim().to_string();
    }
    if let Some(auto_start) = patch.auto_start_with_os {
        settings.auto_start_with_os = auto_start;
    }
    if let Some(close_to_tray) = patch.close_to_tray {
        settings.close_to_tray = close_to_tray;
    }
    if let Some(auto_copy) = patch.auto_copy_to_clipboard {
        settings.auto_copy_to_clipboard = auto_copy;
    }
    store.save_settings(&settings)?;
    Ok(settings)
}
