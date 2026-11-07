use std::hash::{Hash, Hasher};

use tauri::{Emitter, Manager};

use crate::domain::{BatchId, HostError};
use crate::ports::Notifier;

pub struct OsNotifier {
    app: tauri::AppHandle,
}

impl OsNotifier {
    pub fn new(app: tauri::AppHandle) -> Self {
        Self { app }
    }

    pub fn emit_event(&self, event: &str, payload: &str) {
        let _ = self.app.emit(event, payload);
    }
}

fn notification_id(batch_id: &BatchId) -> i32 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    batch_id.as_str().hash(&mut hasher);
    (hasher.finish() as i32).abs()
}

impl Notifier for OsNotifier {
    fn notify(&self, batch_id: &BatchId, title: &str, body: &str) -> Result<(), HostError> {
        use tauri_plugin_notification::NotificationExt;
        self.app
            .notification()
            .builder()
            .id(notification_id(batch_id))
            .title(title)
            .body(body)
            .extra("batchId", batch_id.as_str())
            .show()
            .map_err(|error| HostError::Storage(error.to_string()))?;
        let _ = self.app.emit("history-updated", batch_id.as_str());
        Ok(())
    }
}

#[allow(dead_code)]
pub fn focus_batch(app: &tauri::AppHandle, batch_id: &str) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        #[cfg(not(any(target_os = "ios", target_os = "android")))]
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
    let _ = app.emit("history-focus", batch_id);
}
