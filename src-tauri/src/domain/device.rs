use serde::{Deserialize, Serialize};

use super::ids::DeviceId;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DeviceTrust {
    Unknown,
    PendingAcceptance,
    Trusted,
    Forgotten,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhoneRecord {
    pub id: DeviceId,
    pub name: String,
    pub trust: DeviceTrust,
    /// The phone's X25519 public key (standard base64). Trust belongs to this key.
    /// Absent in records written before the secure channel existed; those can never be trusted.
    #[serde(default)]
    pub public_key: Option<String>,
    /// The 6-digit code the user compares when the phone was not introduced by a QR code.
    #[serde(default)]
    pub sas: Option<String>,
    #[serde(default)]
    pub requested_at: Option<chrono::DateTime<chrono::Utc>>,
}

pub fn text_notification_body(phone_name: &str, copied: bool) -> String {
    if copied {
        format!("Text from {phone_name}. Copied, ready to paste.")
    } else {
        format!("Text from {phone_name}.")
    }
}

pub fn notification_body(phone_name: &str, count: usize) -> String {
    if count == 1 {
        format!("1 image from {phone_name}. Copied, ready to paste.")
    } else {
        format!("{count} images from {phone_name}.")
    }
}
