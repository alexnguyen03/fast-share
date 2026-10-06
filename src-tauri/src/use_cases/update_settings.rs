use chrono::{DateTime, Utc};
use serde::Deserialize;

use crate::domain::{validate_name, validate_retention, HostError, Settings};
use crate::ports::Store;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SettingsPatch {
    history_retention_days: Option<u32>,
    pc_display_name: Option<String>,
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
    store.save_settings(&settings)?;
    Ok(settings)
}
