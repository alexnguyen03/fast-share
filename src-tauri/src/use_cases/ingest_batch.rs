use chrono::{DateTime, Utc};

use crate::domain::{
    notification_body, validate_image, BatchId, DeviceId, DeviceTrust, HostError, ImageId,
    PhoneRecord, ValidImage, MAX_BATCH_IMAGES,
};
use crate::ports::{Clipboard, HistoryBatch, ImageRecord, Notifier, Store};

pub(super) fn trusted_phone(
    store: &impl Store,
    device_id: &DeviceId,
) -> Result<PhoneRecord, HostError> {
    let phone = store.get_phone(device_id)?.ok_or(HostError::UnknownPhone)?;
    if phone.trust != DeviceTrust::Trusted || phone.public_key.is_none() {
        return Err(HostError::NotTrusted);
    }
    Ok(phone)
}

pub(super) fn is_stored(
    store: &impl Store,
    device_id: &DeviceId,
    batch_id: &BatchId,
) -> Result<bool, HostError> {
    Ok(store
        .list_batches()?
        .iter()
        .any(|batch| &batch.phone_id == device_id && &batch.id == batch_id))
}

pub fn authorize_batch(
    store: &impl Store,
    device_id: &DeviceId,
    batch_id: &BatchId,
    image_count: usize,
) -> Result<bool, HostError> {
    trusted_phone(store, device_id)?;
    if image_count == 0 || image_count > MAX_BATCH_IMAGES {
        return Err(HostError::ImageUndecodable);
    }
    is_stored(store, device_id, batch_id)
}

pub fn decode_batch_images(images: &[Vec<u8>]) -> Result<Vec<ValidImage>, HostError> {
    if images.is_empty() || images.len() > MAX_BATCH_IMAGES {
        return Err(HostError::ImageUndecodable);
    }
    if images.len() == 1 {
        return Ok(vec![validate_image(&images[0])?]);
    }
    std::thread::scope(|scope| {
        let handles: Vec<_> = images
            .iter()
            .map(|bytes| scope.spawn(move || validate_image(bytes)))
            .collect();
        let mut validated = Vec::with_capacity(handles.len());
        for handle in handles {
            validated.push(handle.join().map_err(|_| HostError::ImageUndecodable)??);
        }
        Ok(validated)
    })
}

pub fn commit_validated_batch(
    store: &mut impl Store,
    clipboard: &impl Clipboard,
    notifier: &impl Notifier,
    device_id: &DeviceId,
    batch_id: BatchId,
    images: &[ValidImage],
    now: DateTime<Utc>,
) -> Result<(), HostError> {
    if authorize_batch(store, device_id, &batch_id, images.len())? {
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
            pinned: false,
        });
    }

    let count = records.len();
    let auto_copy = store
        .load_settings()
        .map(|s| s.auto_copy_to_clipboard)
        .unwrap_or(true);
    if count == 1 && auto_copy {
        let first = &images[0];
        clipboard.write_rgba(first.width, first.height, &first.rgba, &first.png)?;
    }

    store.insert_batch(HistoryBatch {
        id: batch_id.clone(),
        phone_id: device_id.clone(),
        phone_name: phone.name.clone(),
        received_at: now,
        images: records,
        texts: Vec::new(),
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
    batch_id: BatchId,
    images: &[Vec<u8>],
    now: DateTime<Utc>,
) -> Result<(), HostError> {
    if authorize_batch(store, device_id, &batch_id, images.len())? {
        return Ok(());
    }
    let mut validated = Vec::with_capacity(images.len());
    for bytes in images {
        validated.push(validate_image(bytes)?);
    }
    commit_validated_batch(
        store, clipboard, notifier, device_id, batch_id, &validated, now,
    )
}
