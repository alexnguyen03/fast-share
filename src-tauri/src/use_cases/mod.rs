mod accept_device;
mod copy_image;
mod ingest_batch;
mod ingest_text;
mod purge_history;
mod update_settings;

pub use accept_device::{
    accept_device, base64_key, forget_device, issue_ticket, reject_device, request_pairing,
    PairingTicket,
};
pub use copy_image::copy_image;
#[cfg(test)]
pub use ingest_batch::ingest_batch;
pub use ingest_batch::{authorize_batch, commit_validated_batch, decode_batch_images};
pub use ingest_text::ingest_text;
pub use purge_history::{
    delete_all, delete_image, delete_text, purge_expired, set_text_sensitive, toggle_pin,
    toggle_pin_text,
};
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

    fn pair_request(
        store: &mut MemoryStore,
        ticket: &mut PairingTicket,
        token: Option<&str>,
        at: chrono::DateTime<chrono::Utc>,
    ) -> Result<DeviceId, HostError> {
        let key = crate::adapters::keys::KeyPair::generate().unwrap();
        request_pairing(store, ticket, token, &key.public, "Work iPhone", "123456", at)
    }

    fn trust_phone(store: &mut MemoryStore) -> DeviceId {
        let mut ticket = issue_ticket(&FixedClock(now()));
        let token = ticket.token.clone();
        let id = pair_request(store, &mut ticket, Some(&token), now()).unwrap();
        accept_device(store, &id).unwrap();
        id
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
        let device_id = trust_phone(&mut store);
        let clipboard = RecordingClipboard::new();
        let notifier = RecordingNotifier::new();
        let old = now() - chrono::Duration::days(5);
        ingest_batch(
            &mut store,
            &clipboard,
            &notifier,
            &device_id,
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
        let device_id = trust_phone(&mut store);
        ingest_batch(
            &mut store,
            &RecordingClipboard::new(),
            &RecordingNotifier::new(),
            &device_id,
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
            crate::domain::BatchId::generate(),
            &[tiny_png()],
            now(),
        )
        .unwrap_err();
        assert_eq!(error, HostError::UnknownPhone);

        let mut ticket = issue_ticket(&FixedClock(now()));
        let token = ticket.token.clone();
        let device_id = pair_request(&mut store, &mut ticket, Some(&token), now()).unwrap();
        let error = ingest_batch(
            &mut store,
            &clipboard,
            &notifier,
            &device_id,
            crate::domain::BatchId::generate(),
            &[tiny_png()],
            now(),
        )
        .unwrap_err();
        assert_eq!(error, HostError::NotTrusted);
    }

    #[test]
    fn a_used_ticket_cannot_be_reused_and_a_forgotten_phone_is_no_longer_trusted() {
        let mut store = MemoryStore::new();
        let mut ticket = issue_ticket(&FixedClock(now()));
        let token = ticket.token.clone();
        let device_id = pair_request(&mut store, &mut ticket, Some(&token), now()).unwrap();
        let error = pair_request(&mut store, &mut ticket, Some(&token), now()).unwrap_err();
        assert_eq!(error, HostError::PairingExpired);

        accept_device(&mut store, &device_id).unwrap();
        forget_device(&mut store, &device_id).unwrap();
        let error = ingest_batch(
            &mut store,
            &RecordingClipboard::new(),
            &RecordingNotifier::new(),
            &device_id,
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
        let device_id = trust_phone(&mut store);
        let clipboard = RecordingClipboard::new();
        let notifier = RecordingNotifier::new();
        ingest_batch(
            &mut store,
            &clipboard,
            &notifier,
            &device_id,
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
        let device_id = trust_phone(&mut store);
        let error = ingest_batch(
            &mut store,
            &RecordingClipboard::new(),
            &RecordingNotifier::new(),
            &device_id,
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
            crate::domain::BatchId::generate(),
            &[huge],
            now(),
        )
        .unwrap_err();
        assert_eq!(error, HostError::ImageTooLarge);
        assert!(store.list_batches().unwrap().is_empty());
    }

    #[test]
    fn only_a_phone_without_a_qr_token_needs_its_code_compared() {
        let mut store = MemoryStore::new();
        let mut ticket = issue_ticket(&FixedClock(now()));
        let token = ticket.token.clone();
        let by_qr = pair_request(&mut store, &mut ticket, Some(&token), now()).unwrap();
        let nearby = pair_request(&mut store, &mut ticket, None, now()).unwrap();
        assert_eq!(store.get_phone(&by_qr).unwrap().unwrap().sas, None);
        assert_eq!(
            store.get_phone(&nearby).unwrap().unwrap().sas.as_deref(),
            Some("123456")
        );
        accept_device(&mut store, &nearby).unwrap();
        assert_eq!(store.get_phone(&nearby).unwrap().unwrap().sas, None);
    }

    #[test]
    fn duplicate_batch_id_is_a_no_op_and_does_not_overwrite_clipboard() {
        let mut store = MemoryStore::new();
        let device_id = trust_phone(&mut store);
        let clipboard = RecordingClipboard::new();
        let notifier = RecordingNotifier::new();
        let batch_id = crate::domain::BatchId::generate();
        ingest_batch(
            &mut store,
            &clipboard,
            &notifier,
            &device_id,
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
        let device_id = trust_phone(&mut store);
        let batch_id = crate::domain::BatchId::generate();
        let error = authorize_batch(&store, &device_id, &batch_id, 21).unwrap_err();
        assert_eq!(error, HostError::ImageUndecodable);
    }

    #[test]
    fn a_trusted_key_asking_again_does_not_consume_the_ticket() {
        let mut store = MemoryStore::new();
        let mut ticket = issue_ticket(&FixedClock(now()));
        let token = ticket.token.clone();
        let key = crate::adapters::keys::KeyPair::generate().unwrap();
        let id = request_pairing(&mut store, &mut ticket, Some(&token), &key.public, "Phone", "1", now()).unwrap();
        accept_device(&mut store, &id).unwrap();

        let mut fresh = issue_ticket(&FixedClock(now()));
        let fresh_token = fresh.token.clone();
        let again = request_pairing(&mut store, &mut fresh, Some(&fresh_token), &key.public, "Phone", "1", now()).unwrap();
        assert_eq!(again, id);
        assert!(!fresh.used);
        assert_eq!(store.get_phone(&id).unwrap().unwrap().trust, DeviceTrust::Trusted);
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
    fn a_wrong_or_expired_qr_token_is_refused_and_pending_requests_are_capped_and_expire() {
        let mut store = MemoryStore::new();
        let mut ticket = issue_ticket(&FixedClock(now()));
        let wrong = pair_request(&mut store, &mut ticket, Some("not-the-token"), now()).unwrap_err();
        assert_eq!(wrong, HostError::PairingExpired);
        assert!(!ticket.used);
        let late = now() + chrono::Duration::minutes(11);
        let token = ticket.token.clone();
        let error = pair_request(&mut store, &mut ticket, Some(&token), late).unwrap_err();
        assert_eq!(error, HostError::PairingExpired);

        for _ in 0..5 {
            pair_request(&mut store, &mut ticket, None, now()).unwrap();
        }
        let error = pair_request(&mut store, &mut ticket, None, now()).unwrap_err();
        assert_eq!(error, HostError::Busy);
        // Two minutes later the unanswered requests have expired and free their slots.
        let later = now() + chrono::Duration::minutes(3);
        pair_request(&mut store, &mut ticket, None, later).unwrap();
    }

    #[test]
    fn a_phone_record_from_before_the_secure_channel_loads_but_is_never_trusted() {
        let old: crate::domain::PhoneRecord = serde_json::from_str(
            r#"{"id":"abcdefgh12345678","name":"Old","trust":"trusted","secret":"s","pollToken":null}"#,
        )
        .unwrap();
        assert_eq!(old.public_key, None);
        let mut store = MemoryStore::new();
        store.upsert_phone(old.clone()).unwrap();
        let error = ingest_batch(
            &mut store,
            &RecordingClipboard::new(),
            &RecordingNotifier::new(),
            &old.id,
            crate::domain::BatchId::generate(),
            &[tiny_png()],
            now(),
        )
        .unwrap_err();
        assert_eq!(error, HostError::NotTrusted);
    }

    #[test]
    fn disabling_auto_copy_to_clipboard_skips_clipboard_write() {
        let mut store = MemoryStore::new();
        let device_id = trust_phone(&mut store);
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
        let device_id = trust_phone(&mut store);
        let clipboard = RecordingClipboard::new();
        let notifier = RecordingNotifier::new();
        let old = now() - chrono::Duration::days(10);
        ingest_batch(
            &mut store,
            &clipboard,
            &notifier,
            &device_id,
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

    #[test]
    fn pinned_texts_survive_retention_purge_and_delete_all() {
        let mut store = MemoryStore::new();
        let device_id = trust_phone(&mut store);
        let clipboard = RecordingClipboard::new();
        let notifier = RecordingNotifier::new();
        let old = now() - chrono::Duration::days(10);
        for text in ["keep", "drop"] {
            let id = crate::domain::BatchId::generate();
            ingest_text(&mut store, &clipboard, &notifier, &device_id, id, text, old).unwrap();
        }
        let keep_id = store
            .list_batches()
            .unwrap()
            .iter()
            .flat_map(|batch| batch.texts.iter())
            .find(|text| text.text == "keep")
            .unwrap()
            .id
            .clone();
        assert!(toggle_pin_text(&mut store, &keep_id).unwrap());

        purge_expired(&mut store, now(), 7).unwrap();
        let texts: Vec<String> = store
            .list_batches()
            .unwrap()
            .iter()
            .flat_map(|batch| batch.texts.iter().map(|text| text.text.clone()))
            .collect();
        assert_eq!(texts, vec!["keep".to_string()]);

        delete_all(&mut store).unwrap();
        assert_eq!(store.list_batches().unwrap().len(), 1);

        assert!(!toggle_pin_text(&mut store, &keep_id).unwrap());
        delete_all(&mut store).unwrap();
        assert!(store.list_batches().unwrap().is_empty());
    }

    fn send_text(
        store: &mut MemoryStore,
        clipboard: &RecordingClipboard,
        notifier: &RecordingNotifier,
        device_id: &DeviceId,
        batch_id: crate::domain::BatchId,
        text: &str,
    ) -> Result<(), HostError> {
        ingest_text(store, clipboard, notifier, device_id, batch_id, text, now())
    }

    #[test]
    fn text_is_stored_copied_and_notified() {
        let mut store = MemoryStore::new();
        let device_id = trust_phone(&mut store);
        let clipboard = RecordingClipboard::new();
        let notifier = RecordingNotifier::new();
        let batch_id = crate::domain::BatchId::generate();
        send_text(&mut store, &clipboard, &notifier, &device_id, batch_id.clone(), "hello")
            .unwrap();
        // Same batch id again: no second copy, no second notice.
        send_text(&mut store, &clipboard, &notifier, &device_id, batch_id, "hello")
            .unwrap();
        let batches = store.list_batches().unwrap();
        assert_eq!(batches.len(), 1);
        assert_eq!(batches[0].texts[0].text, "hello");
        assert_eq!(clipboard.text_count(), 1);
        assert_eq!(notifier.bodies().len(), 1);
    }

    #[test]
    fn text_rejects_bad_input_and_untrusted_senders() {
        let mut store = MemoryStore::new();
        let device_id = trust_phone(&mut store);
        let clipboard = RecordingClipboard::new();
        let notifier = RecordingNotifier::new();
        let id = || crate::domain::BatchId::generate();
        assert_eq!(
            send_text(&mut store, &clipboard, &notifier, &DeviceId::generate(), id(), "hi"),
            Err(HostError::UnknownPhone)
        );
        assert_eq!(
            send_text(&mut store, &clipboard, &notifier, &device_id, id(), "   "),
            Err(HostError::InvalidText)
        );
        assert!(store.list_batches().unwrap().is_empty());
        assert_eq!(clipboard.text_count(), 0);
    }

    #[test]
    fn auto_copy_off_still_stores_text() {
        let mut store = MemoryStore::new();
        store.settings.auto_copy_to_clipboard = false;
        let device_id = trust_phone(&mut store);
        let clipboard = RecordingClipboard::new();
        let notifier = RecordingNotifier::new();
        send_text(
            &mut store,
            &clipboard,
            &notifier,
            &device_id,
            crate::domain::BatchId::generate(),
            "hello",
        )
        .unwrap();
        assert_eq!(clipboard.text_count(), 0);
        assert_eq!(store.list_batches().unwrap().len(), 1);
    }

    #[test]
    fn text_only_batches_survive_image_deletes_and_expire_with_retention() {
        let mut store = MemoryStore::new();
        let device_id = trust_phone(&mut store);
        let clipboard = RecordingClipboard::new();
        let notifier = RecordingNotifier::new();
        send_text(
            &mut store,
            &clipboard,
            &notifier,
            &device_id,
            crate::domain::BatchId::generate(),
            "keep me",
        )
        .unwrap();
        ingest_batch(
            &mut store,
            &clipboard,
            &notifier,
            &device_id,
            crate::domain::BatchId::generate(),
            &[tiny_png()],
            now(),
        )
        .unwrap();
        let image_id = store
            .list_batches()
            .unwrap()
            .iter()
            .find_map(|batch| batch.images.first().map(|image| image.id.clone()))
            .unwrap();
        delete_image(&mut store, &image_id).unwrap();
        let batches = store.list_batches().unwrap();
        assert_eq!(batches.len(), 1);
        assert_eq!(batches[0].texts[0].text, "keep me");

        let text_id = batches[0].texts[0].id.clone();
        purge_expired(&mut store, now() + chrono::Duration::days(8), 7).unwrap();
        assert!(store.list_batches().unwrap().is_empty());
        assert_eq!(delete_text(&mut store, &text_id), Err(HostError::NotFound));
    }

    #[test]
    fn delete_text_removes_only_that_text() {
        let mut store = MemoryStore::new();
        let device_id = trust_phone(&mut store);
        let clipboard = RecordingClipboard::new();
        let notifier = RecordingNotifier::new();
        for text in ["one", "two"] {
            send_text(
                &mut store,
                &clipboard,
                &notifier,
                &device_id,
                crate::domain::BatchId::generate(),
                text,
            )
            .unwrap();
        }
        let first = store.list_batches().unwrap()[0].texts[0].id.clone();
        delete_text(&mut store, &first).unwrap();
        let rest = store.list_batches().unwrap();
        assert_eq!(rest.len(), 1);
        assert_eq!(rest[0].texts[0].text, "two");
    }

    #[test]
    fn history_written_before_text_sharing_still_loads() {
        let old = r#"[{"id":"batch-12345678","phoneId":"phone-12345678","phoneName":"P","receivedAt":"2026-10-06T12:00:00Z","images":[]}]"#;
        let batches: Vec<crate::ports::HistoryBatch> = serde_json::from_str(old).unwrap();
        assert!(batches[0].texts.is_empty());
    }
}
