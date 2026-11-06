use chrono::{DateTime, Utc};

use crate::domain::{
    notification_body, validate_image, BatchId, DeviceId, DeviceTrust, HostError, ImageId,
    ValidImage, MAX_BATCH_IMAGES,
};
use crate::ports::{Clipboard, HistoryBatch, ImageRecord, Notifier, Store};

pub fn authorize_batch(
    store: &impl Store,
    device_id: &DeviceId,
    secret: &str,
    batch_id: &BatchId,
    image_count: usize,
) -> Result<bool, HostError> {
    let phone = store.get_phone(device_id)?.ok_or(HostError::UnknownPhone)?;
    if phone.trust != DeviceTrust::Trusted || phone.secret.as_deref() != Some(secret) {
        return Err(HostError::NotTrusted);
    }
    if image_count == 0 || image_count > MAX_BATCH_IMAGES {
        return Err(HostError::ImageUndecodable);
    }
    let already_stored = store
        .list_batches()?
        .iter()
        .any(|batch| &batch.phone_id == device_id && &batch.id == batch_id);
    Ok(already_stored)
}

pub fn decode_batch_images(encoded: &[String]) -> Result<Vec<ValidImage>, HostError> {
    use base64::Engine;

    if encoded.is_empty() || encoded.len() > MAX_BATCH_IMAGES {
        return Err(HostError::ImageUndecodable);
    }
    let mut validated = Vec::with_capacity(encoded.len());
    for item in encoded {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(item.trim())
            .map_err(|_| HostError::ImageUndecodable)?;
        validated.push(validate_image(&bytes)?);
    }
    Ok(validated)
}

pub fn commit_validated_batch(
    store: &mut impl Store,
    clipboard: &impl Clipboard,
    notifier: &impl Notifier,
    device_id: &DeviceId,
    secret: &str,
    batch_id: BatchId,
    images: &[ValidImage],
    now: DateTime<Utc>,
) -> Result<(), HostError> {
    if authorize_batch(store, device_id, secret, &batch_id, images.len())? {
        return Ok(());
    }
    let phone = store.get_phone(device_id)?.ok_or(HostError::UnknownPhone)?;
    let mut records = Vec::with_capacity(images.len());
    for image in images {
        let image_id = ImageId::generate();
        let file_name = format!("image-{}.png", image_id.as_str());
        store.put_image(&file_name, &image.png)?;
        records.push(ImageRecord {
            id: image_id,
            file_name,
        });
    }

    let count = records.len();
    let auto_copy = store
        .load_settings()
        .map(|s| s.auto_copy_to_clipboard)
        .unwrap_or(true);
    if count == 1 && auto_copy {
        let file_name = &records[0].file_name;
        let png = store.read_image(file_name)?;
        clipboard.write_png(&png)?;
    }

    store.insert_batch(HistoryBatch {
        id: batch_id.clone(),
        phone_id: device_id.clone(),
        phone_name: phone.name.clone(),
        received_at: now,
        images: records,
    })?;
    notifier.notify(
        &batch_id,
        "Fast Share",
        &notification_body(&phone.name, count),
    )?;
    Ok(())
}

#[cfg(test)]
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
    if authorize_batch(store, device_id, secret, &batch_id, images.len())? {
        return Ok(());
    }
    let mut validated = Vec::with_capacity(images.len());
    for bytes in images {
        validated.push(validate_image(bytes)?);
    }
    commit_validated_batch(
        store, clipboard, notifier, device_id, secret, batch_id, &validated, now,
    )
}
