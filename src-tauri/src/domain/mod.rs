mod device;
mod error;
mod ids;
mod image;
mod qr;
mod relay;
mod settings;
mod text;
mod wire;

pub use device::{notification_body, text_notification_body, DeviceTrust, PhoneRecord};
pub use error::HostError;
pub use ids::{BatchId, DeviceId, ImageId, PcId, TextId};
pub use text::{validate_text, MAX_TEXT_BYTES};
pub use wire::{Hello, Msg, CHUNK_BYTES};
pub use image::{validate_image, ValidImage, MAX_BATCH_IMAGES, MAX_IMAGE_BYTES};
pub use qr::{parse_qr, require_lan_host, QrPayload};
pub use relay::{mailbox_for, RelayInfo};
pub use settings::{
    settings_from_json, validate_name, validate_retention, Settings, ALLOWED_THEMES,
};
