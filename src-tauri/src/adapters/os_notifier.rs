use tauri::{Emitter, Manager};

use crate::domain::HostError;
use crate::ports::Notifier;

pub struct OsNotifier {
    app: tauri::AppHandle,
}

impl OsNotifier {
    pub fn new(app: tauri::AppHandle) -> Self {
        Self { app }
    }
}

impl Notifier for OsNotifier {
    fn notify(&self, title: &str, body: &str) -> Result<(), HostError> {
        use tauri_plugin_notification::NotificationExt;
        self.app
            .notification()
            .builder()
            .title(title)
            .body(body)
            .show()
            .map_err(|error| HostError::Storage(error.to_string()))?;
        let _ = self.app.emit("history-focus", ());
        if let Some(window) = self.app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
        Ok(())
    }
}
