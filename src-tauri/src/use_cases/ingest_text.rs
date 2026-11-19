use chrono::{DateTime, Utc};

use super::ingest_batch::{is_stored, trusted_phone};
use crate::domain::{
    text_notification_body, validate_text, BatchId, DeviceId, HostError, TextId,
};
use crate::ports::{Clipboard, HistoryBatch, Notifier, Store, TextRecord};

/// Stores one text from a trusted phone. A repeated `batch_id` is a no-op, like images.
pub fn ingest_text(
    store: &mut impl Store,
    clipboard: &impl Clipboard,
    notifier: &impl Notifier,
    device_id: &DeviceId,
    secret: &str,
    batch_id: BatchId,
    text: &str,
    now: DateTime<Utc>,
) -> Result<(), HostError> {
    let phone = trusted_phone(store, device_id, secret)?;
    validate_text(text)?;
    if is_stored(store, device_id, &batch_id)? {
        return Ok(());
    }
    store.insert_batch(HistoryBatch {
        id: batch_id.clone(),
        phone_id: device_id.clone(),
        phone_name: phone.name.clone(),
        received_at: now,
        images: Vec::new(),
        texts: vec![TextRecord {
            id: TextId::generate(),
            text: text.to_string(),
        }],
    })?;
    // Inserted first: a clipboard failure must never lose the text.
    let auto_copy = store
        .load_settings()
        .map(|s| s.auto_copy_to_clipboard)
        .unwrap_or(true);
    let copied = auto_copy && clipboard.write_text(text).is_ok();
    notifier.notify(
        &batch_id,
        "Fast Share",
        &text_notification_body(&phone.name, copied),
    )?;
    Ok(())
}
