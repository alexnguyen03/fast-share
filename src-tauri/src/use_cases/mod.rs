mod accept_device;
mod copy_image;
mod ingest_batch;
mod purge_history;
mod update_settings;

pub use accept_device::{
    accept_device, forget_device, issue_ticket, pair_status, reject_device, submit_pair, PairOutcome,
    PairingTicket,
};
pub use copy_image::copy_image;
pub use ingest_batch::ingest_batch;
pub use purge_history::{delete_all, delete_image, purge_expired};
pub use update_settings::update_settings;

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use chrono::TimeZone;

    use crate::domain::{settings_from_json, DeviceId, DeviceTrust, HostError};
    use crate::ports::{FixedClock, MemoryStore, RecordingClipboard, RecordingNotifier, Store};
    use crate::use_cases::*;

    fn now() -> chrono::DateTime<chrono::Utc> {
        chrono::Utc.with_ymd_and_hms(2026, 10, 6, 12, 0, 0).unwrap()
    }

    fn tiny_png() -> Vec<u8> {
        let image = image::RgbaImage::from_pixel(1, 1, image::Rgba([10, 20, 30, 255]));
        let mut bytes = Vec::new();
        image
            .write_to(&mut Cursor::new(&mut bytes), image::ImageFormat::Png)
            .unwrap();
        bytes
    }

    fn trust_phone(store: &mut MemoryStore) -> (DeviceId, String) {
        let clock = FixedClock(now());
        let mut ticket = issue_ticket(&clock);
        let device_id = DeviceId::generate();
        let token = ticket.token.clone();
        let pending = submit_pair(
            store,
            &mut ticket,
            token.as_str(),
            device_id.clone(),
            "Work iPhone",
            now(),
        )
        .unwrap();
        let PairOutcome::Pending { poll_token } = pending else {
            panic!("expected pending");
        };
        assert!(matches!(
            pair_status(store, &device_id, &poll_token).unwrap(),
            PairOutcome::Pending { .. }
        ));
        let secret = accept_device(store, &device_id).unwrap();
        (device_id, secret)
    }

    #[test]
    fn missing_settings_fields_use_defaults() {
        let settings = settings_from_json("{}").unwrap();
        assert_eq!(settings.history_retention_days, 7);
        assert_eq!(settings.pc_display_name, "My PC");
    }

    #[test]
    fn settings_file_ignores_unknown_keys() {
        let settings = settings_from_json(r#"{"historyRetentionDays":3,"later":true}"#).unwrap();
        assert_eq!(settings.history_retention_days, 3);
    }

    #[test]
    fn settings_patch_rejects_unknown_keys_and_bad_range() {
        let mut store = MemoryStore::new();
        let error = update_settings(&mut store, r#"{"nope":1}"#, now()).unwrap_err();
        assert_eq!(error, HostError::UnknownSettingsField);
        let error = update_settings(&mut store, r#"{"historyRetentionDays":0}"#, now()).unwrap_err();
        assert_eq!(error, HostError::InvalidRetention);
        let error = update_settings(&mut store, r#"{"historyRetentionDays":91}"#, now()).unwrap_err();
        assert_eq!(error, HostError::InvalidRetention);
    }

    #[test]
    fn lowering_retention_purges_older_images_immediately() {
        let mut store = MemoryStore::new();
        let (device_id, secret) = trust_phone(&mut store);
        let clipboard = RecordingClipboard::new();
        let notifier = RecordingNotifier::new();
        let old = now() - chrono::Duration::days(5);
        ingest_batch(
            &mut store,
            &clipboard,
            &notifier,
            &device_id,
            &secret,
            crate::domain::BatchId::generate(),
            &[tiny_png()],
            old,
        )
        .unwrap();
        update_settings(&mut store, r#"{"historyRetentionDays":3}"#, now()).unwrap();
        assert!(store.list_batches().unwrap().is_empty());
        assert!(store.files.is_empty());
    }

    #[test]
    fn raising_retention_keeps_images() {
        let mut store = MemoryStore::new();
        let (device_id, secret) = trust_phone(&mut store);
        ingest_batch(
            &mut store,
            &RecordingClipboard::new(),
            &RecordingNotifier::new(),
            &device_id,
            &secret,
            crate::domain::BatchId::generate(),
            &[tiny_png()],
            now() - chrono::Duration::days(5),
        )
        .unwrap();
        update_settings(&mut store, r#"{"historyRetentionDays":30}"#, now()).unwrap();
        assert_eq!(store.list_batches().unwrap().len(), 1);
    }

    #[test]
    fn unknown_and_pending_phones_cannot_store_images() {
        let mut store = MemoryStore::new();
        let clipboard = RecordingClipboard::new();
        let notifier = RecordingNotifier::new();
        let stranger = DeviceId::generate();
        let error = ingest_batch(
            &mut store,
            &clipboard,
            &notifier,
            &stranger,
            "nope",
            crate::domain::BatchId::generate(),
            &[tiny_png()],
            now(),
        )
        .unwrap_err();
        assert_eq!(error, HostError::UnknownPhone);

        let clock = FixedClock(now());
        let mut ticket = issue_ticket(&clock);
        let device_id = DeviceId::generate();
        let token = ticket.token.clone();
        submit_pair(
            &mut store,
            &mut ticket,
            token.as_str(),
            device_id.clone(),
            "Work iPhone",
            now(),
        )
        .unwrap();
        let error = ingest_batch(
            &mut store,
            &clipboard,
            &notifier,
            &device_id,
            "nope",
            crate::domain::BatchId::generate(),
            &[tiny_png()],
            now(),
        )
        .unwrap_err();
        assert_eq!(error, HostError::NotTrusted);
    }

    #[test]
    fn expired_ticket_cannot_be_reused_after_forget() {
        let mut store = MemoryStore::new();
        let clock = FixedClock(now());
        let mut ticket = issue_ticket(&clock);
        let token = ticket.token.clone();
        let device_id = DeviceId::generate();
        submit_pair(
            &mut store,
            &mut ticket,
            &token,
            device_id.clone(),
            "Work iPhone",
            now(),
        )
        .unwrap();
        let error = submit_pair(
            &mut store,
            &mut ticket,
            &token,
            device_id.clone(),
            "Work iPhone",
            now(),
        )
        .unwrap_err();
        assert_eq!(error, HostError::PairingExpired);

        let secret = accept_device(&mut store, &device_id).unwrap();
        forget_device(&mut store, &device_id).unwrap();
        let error = ingest_batch(
            &mut store,
            &RecordingClipboard::new(),
            &RecordingNotifier::new(),
            &device_id,
            &secret,
            crate::domain::BatchId::generate(),
            &[tiny_png()],
            now(),
        )
        .unwrap_err();
        assert_eq!(error, HostError::NotTrusted);
        assert_eq!(
            store.get_phone(&device_id).unwrap().unwrap().trust,
            DeviceTrust::Forgotten
        );
    }

    #[test]
    fn one_image_is_copied_and_many_are_not() {
        let mut store = MemoryStore::new();
        let (device_id, secret) = trust_phone(&mut store);
        let clipboard = RecordingClipboard::new();
        let notifier = RecordingNotifier::new();
        ingest_batch(
            &mut store,
            &clipboard,
            &notifier,
            &device_id,
            &secret,
            crate::domain::BatchId::generate(),
            &[tiny_png()],
            now(),
        )
        .unwrap();
        assert_eq!(clipboard.count(), 1);
        assert_eq!(
            notifier.bodies(),
            vec!["1 image from Work iPhone. Copied, ready to paste.".to_string()]
        );

        ingest_batch(
            &mut store,
            &clipboard,
            &notifier,
            &device_id,
            &secret,
            crate::domain::BatchId::generate(),
            &[tiny_png(), tiny_png()],
            now(),
        )
        .unwrap();
        assert_eq!(clipboard.count(), 1);
        assert_eq!(
            notifier.bodies()[1],
            "2 images from Work iPhone."
        );
        let batch = &store.list_batches().unwrap()[1];
        assert!(batch.images.iter().all(|image| image.file_name.starts_with("image-")
            && image.file_name.ends_with(".png")));
    }

    #[test]
    fn oversize_and_garbage_bytes_are_rejected() {
        let mut store = MemoryStore::new();
        let (device_id, secret) = trust_phone(&mut store);
        let error = ingest_batch(
            &mut store,
            &RecordingClipboard::new(),
            &RecordingNotifier::new(),
            &device_id,
            &secret,
            crate::domain::BatchId::generate(),
            &[vec![1, 2, 3, 4]],
            now(),
        )
        .unwrap_err();
        assert_eq!(error, HostError::ImageUndecodable);

        let huge = vec![0_u8; crate::domain::MAX_IMAGE_BYTES + 1];
        let error = ingest_batch(
            &mut store,
            &RecordingClipboard::new(),
            &RecordingNotifier::new(),
            &device_id,
            &secret,
            crate::domain::BatchId::generate(),
            &[huge],
            now(),
        )
        .unwrap_err();
        assert_eq!(error, HostError::ImageTooLarge);
        assert!(store.list_batches().unwrap().is_empty());
    }

    #[test]
    fn trusted_secret_is_returned_once_for_the_poll_token() {
        let mut store = MemoryStore::new();
        let clock = FixedClock(now());
        let mut ticket = issue_ticket(&clock);
        let device_id = DeviceId::generate();
        let token = ticket.token.clone();
        let PairOutcome::Pending { poll_token } = submit_pair(
            &mut store,
            &mut ticket,
            token.as_str(),
            device_id.clone(),
            "Work iPhone",
            now(),
        )
        .unwrap() else {
            panic!("expected pending");
        };
        accept_device(&mut store, &device_id).unwrap();
        let outcome = pair_status(&mut store, &device_id, &poll_token).unwrap();
        assert!(matches!(outcome, PairOutcome::Trusted { .. }));
        let error = pair_status(&mut store, &device_id, &poll_token).unwrap_err();
        assert_eq!(error, HostError::UnknownPhone);
    }
}
