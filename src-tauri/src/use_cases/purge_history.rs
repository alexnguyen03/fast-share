use chrono::{DateTime, Duration, Utc};

use crate::domain::{HostError, ImageId, TextId};
use crate::ports::Store;

pub fn purge_expired(
    store: &mut impl Store,
    now: DateTime<Utc>,
    retention_days: u32,
) -> Result<usize, HostError> {
    let cutoff = now - Duration::days(i64::from(retention_days));
    let batches = store.list_batches()?;
    let mut removed = 0;
    let mut kept = Vec::new();
    for mut batch in batches {
        if batch.received_at < cutoff {
            let mut pinned_images = Vec::new();
            for image in batch.images {
                if image.pinned {
                    pinned_images.push(image);
                } else {
                    store.remove_image_file(&image.file_name)?;
                    removed += 1;
                }
            }
            batch.texts.retain(|text| text.pinned);
            if !pinned_images.is_empty() || !batch.texts.is_empty() {
                batch.images = pinned_images;
                kept.push(batch);
            }
            continue;
        }
        kept.push(batch);
    }
    store.save_batches(kept)?;
    Ok(removed)
}

pub fn toggle_pin(store: &mut impl Store, image_id: &ImageId) -> Result<bool, HostError> {
    let mut batches = store.list_batches()?;
    let mut result = None;
    for batch in &mut batches {
        for image in &mut batch.images {
            if &image.id == image_id {
                image.pinned = !image.pinned;
                result = Some(image.pinned);
                break;
            }
        }
        if result.is_some() {
            break;
        }
    }
    let pinned = result.ok_or(HostError::NotFound)?;
    store.save_batches(batches)?;
    Ok(pinned)
}

pub fn delete_image(store: &mut impl Store, image_id: &ImageId) -> Result<(), HostError> {
    let batches = store.list_batches()?;
    let mut found = false;
    let mut kept = Vec::new();
    for mut batch in batches {
        let before = batch.images.len();
        let removed: Vec<_> = batch
            .images
            .iter()
            .filter(|image| &image.id == image_id)
            .map(|image| image.file_name.clone())
            .collect();
        for file_name in &removed {
            store.remove_image_file(file_name)?;
        }
        batch.images.retain(|image| &image.id != image_id);
        if batch.images.len() != before {
            found = true;
        }
        // A text-only batch has no images; only drop batches with nothing left.
        if !batch.images.is_empty() || !batch.texts.is_empty() {
            kept.push(batch);
        }
    }
    if !found {
        return Err(HostError::NotFound);
    }
    store.save_batches(kept)?;
    Ok(())
}

pub fn delete_text(store: &mut impl Store, text_id: &TextId) -> Result<(), HostError> {
    let mut batches = store.list_batches()?;
    let mut found = false;
    for batch in &mut batches {
        let count = batch.texts.len();
        batch.texts.retain(|text| &text.id != text_id);
        found |= batch.texts.len() != count;
    }
    if !found {
        return Err(HostError::NotFound);
    }
    batches.retain(|batch| !batch.images.is_empty() || !batch.texts.is_empty());
    store.save_batches(batches)?;
    Ok(())
}

pub fn delete_all(store: &mut impl Store) -> Result<(), HostError> {
    let batches = store.list_batches()?;
    let mut kept = Vec::new();
    for mut batch in batches {
        let mut pinned = Vec::new();
        for image in batch.images {
            if image.pinned {
                pinned.push(image);
            } else {
                store.remove_image_file(&image.file_name)?;
            }
        }
        batch.texts.retain(|text| text.pinned);
        if !pinned.is_empty() || !batch.texts.is_empty() {
            batch.images = pinned;
            kept.push(batch);
        }
    }
    store.save_batches(kept)?;
    Ok(())
}

pub fn toggle_pin_text(store: &mut impl Store, text_id: &TextId) -> Result<bool, HostError> {
    let mut batches = store.list_batches()?;
    let text = batches
        .iter_mut()
        .flat_map(|batch| batch.texts.iter_mut())
        .find(|text| &text.id == text_id)
        .ok_or(HostError::NotFound)?;
    text.pinned = !text.pinned;
    let pinned = text.pinned;
    store.save_batches(batches)?;
    Ok(pinned)
}
