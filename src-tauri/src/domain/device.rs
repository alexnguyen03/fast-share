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
    pub secret: Option<String>,
    pub poll_token: Option<String>,
}

pub fn notification_body(phone_name: &str, count: usize) -> String {
    if count == 1 {
        format!("1 image from {phone_name}. Copied, ready to paste.")
    } else {
        format!("{count} images from {phone_name}.")
    }
}
