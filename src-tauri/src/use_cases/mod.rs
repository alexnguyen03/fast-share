mod accept_device;
mod copy_image;
mod ingest_batch;
mod purge_history;
mod update_settings;

pub use accept_device::{
    accept_device, forget_device, issue_ticket, pair_status, reject_device, submit_pair,
    submit_pair_code, PairOutcome, PairingTicket,
};
pub use copy_image::copy_image;
#[cfg(test)]
pub use ingest_batch::ingest_batch;
pub use ingest_batch::{authorize_batch, commit_validated_batch, decode_batch_images};
pub use purge_history::{delete_all, delete_image, purge_expired, toggle_pin};
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
        let error =
            update_settings(&mut store, r#"{"historyRetentionDays":0}"#, now()).unwrap_err();
        assert_eq!(error, HostError::InvalidRetention);
        let error =
            update_settings(&mut store, r#"{"historyRetentionDays":91}"#, now()).unwrap_err();
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
        assert_eq!(notifier.bodies()[1], "2 images from Work iPhone.");
        let batch = &store.list_batches().unwrap()[1];
        assert!(batch.images.iter().all(
            |image| image.file_name.starts_with("image-") && image.file_name.ends_with(".png")
        ));
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
        assert!(matches!(outcome, PairOutcome::Trusted { secret: Some(_) }));
        let error = pair_status(&mut store, &device_id, &poll_token).unwrap_err();
        assert_eq!(error, HostError::UnknownPhone);
    }

    #[test]
    fn duplicate_batch_id_is_a_no_op_and_does_not_overwrite_clipboard() {
        let mut store = MemoryStore::new();
        let (device_id, secret) = trust_phone(&mut store);
        let clipboard = RecordingClipboard::new();
        let notifier = RecordingNotifier::new();
        let batch_id = crate::domain::BatchId::generate();
        ingest_batch(
            &mut store,
            &clipboard,
            &notifier,
            &device_id,
            &secret,
            batch_id.clone(),
            &[tiny_png()],
            now(),
        )
        .unwrap();
        assert_eq!(clipboard.count(), 1);
        assert_eq!(notifier.bodies().len(), 1);
        assert_eq!(store.list_batches().unwrap().len(), 1);

        ingest_batch(
            &mut store,
            &clipboard,
            &notifier,
            &device_id,
            &secret,
            batch_id,
            &[tiny_png()],
            now(),
        )
        .unwrap();
        assert_eq!(clipboard.count(), 1);
        assert_eq!(notifier.bodies().len(), 1);
        assert_eq!(store.list_batches().unwrap().len(), 1);
    }

    #[test]
    fn batch_over_twenty_images_is_rejected_before_decode() {
        let mut store = MemoryStore::new();
        let (device_id, secret) = trust_phone(&mut store);
        let batch_id = crate::domain::BatchId::generate();
        let error = authorize_batch(&store, &device_id, &secret, &batch_id, 21).unwrap_err();
        assert_eq!(error, HostError::ImageUndecodable);
    }

    #[test]
    fn trusted_device_re_pair_does_not_reissue_secret_or_consume_ticket() {
        let mut store = MemoryStore::new();
        let (device_id, _secret) = trust_phone(&mut store);
        let clock = FixedClock(now());
        let mut ticket = issue_ticket(&clock);
        let token = ticket.token.clone();
        let outcome = submit_pair(
            &mut store,
            &mut ticket,
            &token,
            device_id,
            "Work iPhone",
            now(),
        )
        .unwrap();
        assert_eq!(outcome, PairOutcome::Trusted { secret: None });
        assert!(!ticket.used);

        let second_device = DeviceId::generate();
        let second_outcome = submit_pair(
            &mut store,
            &mut ticket,
            &token,
            second_device,
            "Second iPhone",
            now(),
        )
        .unwrap();
        assert!(matches!(second_outcome, PairOutcome::Pending { .. }));
        assert!(ticket.used);
    }

    #[test]
    fn names_with_control_characters_are_rejected_and_bad_settings_clamp_to_default() {
        let mut store = MemoryStore::new();
        let error =
            update_settings(&mut store, "{\"pcDisplayName\":\"Bad\\nName\"}", now()).unwrap_err();
        assert_eq!(error, HostError::InvalidName);
        let error = crate::domain::validate_name("Phone\nInjected").unwrap_err();
        assert_eq!(error, HostError::InvalidName);

        let clamped =
            settings_from_json(r#"{"historyRetentionDays":0,"pcDisplayName":"Office"}"#).unwrap();
        assert_eq!(clamped.history_retention_days, 7);
        let clamped_high =
            settings_from_json(r#"{"historyRetentionDays":999,"pcDisplayName":"Office"}"#).unwrap();
        assert_eq!(clamped_high.history_retention_days, 7);
    }

    #[test]
    fn six_digit_code_pairs_pending_device_and_cannot_be_replayed() {
        let mut store = MemoryStore::new();
        let clock = FixedClock(now());
        let mut ticket = issue_ticket(&clock);
        assert_eq!(ticket.code.len(), 6);
        assert!(ticket.code.chars().all(|c| c.is_ascii_digit()));
        let code = ticket.code.clone();
        let device_id = DeviceId::generate();

        let wrong = submit_pair_code(
            &mut store,
            &mut ticket,
            "000000",
            device_id.clone(),
            "Android Phone",
            now(),
        )
        .unwrap_err();
        assert_eq!(wrong, HostError::PairingExpired);
        assert!(!ticket.used);

        let outcome = submit_pair_code(
            &mut store,
            &mut ticket,
            &code,
            device_id.clone(),
            "Android Phone",
            now(),
        )
        .unwrap();
        assert!(matches!(outcome, PairOutcome::Pending { .. }));
        assert!(ticket.used);

        let replay = submit_pair_code(
            &mut store,
            &mut ticket,
            &code,
            device_id,
            "Android Phone",
            now(),
        )
        .unwrap_err();
        assert_eq!(replay, HostError::PairingExpired);
    }

    #[test]
    fn disabling_auto_copy_to_clipboard_skips_clipboard_write() {
        let mut store = MemoryStore::new();
        let (device_id, secret) = trust_phone(&mut store);
        update_settings(
            &mut store,
            r#"{"autoCopyToClipboard":false,"closeToTray":false,"autoStartWithOs":true}"#,
            now(),
        )
        .unwrap();
        let loaded = store.load_settings().unwrap();
        assert!(!loaded.auto_copy_to_clipboard);
        assert!(!loaded.close_to_tray);
        assert!(loaded.auto_start_with_os);

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
        assert_eq!(clipboard.count(), 0);
        assert_eq!(store.list_batches().unwrap().len(), 1);
    }

    #[test]
    fn pinned_images_survive_retention_purge_and_delete_all() {
        let mut store = MemoryStore::new();
        let (device_id, secret) = trust_phone(&mut store);
        let clipboard = RecordingClipboard::new();
        let notifier = RecordingNotifier::new();
        let old = now() - chrono::Duration::days(10);
        ingest_batch(
            &mut store,
            &clipboard,
            &notifier,
            &device_id,
            &secret,
            crate::domain::BatchId::generate(),
            &[tiny_png(), tiny_png()],
            old,
        )
        .unwrap();
        let first_id = store.list_batches().unwrap()[0].images[0].id.clone();
        assert!(toggle_pin(&mut store, &first_id).unwrap());

        purge_expired(&mut store, now(), 7).unwrap();
        let batches = store.list_batches().unwrap();
        assert_eq!(batches.len(), 1);
        assert_eq!(batches[0].images.len(), 1);
        assert_eq!(batches[0].images[0].id, first_id);

        delete_all(&mut store).unwrap();
        let after_delete_all = store.list_batches().unwrap();
        assert_eq!(after_delete_all.len(), 1);
        assert_eq!(after_delete_all[0].images[0].id, first_id);

        assert!(!toggle_pin(&mut store, &first_id).unwrap());
        delete_all(&mut store).unwrap();
        assert!(store.list_batches().unwrap().is_empty());
    }
}
