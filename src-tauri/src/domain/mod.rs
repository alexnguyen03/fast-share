mod device;
mod error;
mod ids;
mod image;
mod qr;
mod settings;

pub use device::{notification_body, DeviceTrust, PhoneRecord};
pub use error::HostError;
pub use ids::{BatchId, DeviceId, ImageId, PcId};
pub use image::{validate_image, MAX_IMAGE_BYTES};
pub use qr::{parse_qr, require_lan_host, QrPayload};
pub use settings::{
    settings_from_json, validate_name, validate_retention, Settings,
};
