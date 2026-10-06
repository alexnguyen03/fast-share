use chrono::{DateTime, Utc};

use crate::domain::{
    notification_body, validate_image, BatchId, DeviceId, DeviceTrust, HostError, ImageId,
};
use crate::ports::{Clipboard, HistoryBatch, ImageRecord, Notifier, Store};

pub fn ingest_batch(
    store: &mut impl Store,
    clipboard: &impl Clipboard,
    notifier: &impl Notifier,
    device_id: &DeviceId,
    secret: &str,
    batch_id: BatchId,
    images: &[Vec<u8>],
    now: DateTime<Utc>,
) -> Result<(), HostError> {
    let phone = store
        .get_phone(device_id)?
        .ok_or(HostError::UnknownPhone)?;
    if phone.trust != DeviceTrust::Trusted || phone.secret.as_deref() != Some(secret) {
        return Err(HostError::NotTrusted);
    }
    if images.is_empty() {
        return Err(HostError::ImageUndecodable);
    }

    let mut encoded = Vec::with_capacity(images.len());
    for bytes in images {
        encoded.push(validate_image(bytes)?.png);
    }

    let mut records = Vec::with_capacity(encoded.len());
    for png in encoded {
        let image_id = ImageId::generate();
        let file_name = format!("image-{}.png", image_id.as_str());
        store.put_image(&file_name, &png)?;
        records.push(ImageRecord {
            id: image_id,
            file_name,
        });
    }

    let count = records.len();
    if count == 1 {
        let file_name = &records[0].file_name;
        let png = store.read_image(file_name)?;
        clipboard.write_png(&png)?;
    }

    store.insert_batch(HistoryBatch {
        id: batch_id,
        phone_id: device_id.clone(),
        phone_name: phone.name.clone(),
        received_at: now,
        images: records,
    })?;
    notifier.notify("Fast Share", &notification_body(&phone.name, count))?;
    Ok(())
}
