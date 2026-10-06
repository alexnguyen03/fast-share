use chrono::{DateTime, Duration, Utc};

use crate::domain::{HostError, ImageId};
use crate::ports::Store;

pub fn purge_expired(store: &mut impl Store, now: DateTime<Utc>, retention_days: u32) -> Result<usize, HostError> {
    let cutoff = now - Duration::days(i64::from(retention_days));
    let batches = store.list_batches()?;
    let mut removed = 0;
    let mut kept = Vec::new();
    for batch in batches {
        if batch.received_at < cutoff {
            for image in &batch.images {
                store.remove_image_file(&image.file_name)?;
                removed += 1;
            }
            continue;
        }
        kept.push(batch);
    }
    store.save_batches(kept)?;
    Ok(removed)
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
        if !batch.images.is_empty() {
            kept.push(batch);
        }
    }
    if !found {
        return Err(HostError::NotFound);
    }
    store.save_batches(kept)?;
    Ok(())
}

pub fn delete_all(store: &mut impl Store) -> Result<(), HostError> {
    let batches = store.list_batches()?;
    for batch in batches {
        for image in batch.images {
            store.remove_image_file(&image.file_name)?;
        }
    }
    store.save_batches(Vec::new())?;
    Ok(())
}
