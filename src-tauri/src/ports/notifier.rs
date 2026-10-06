use crate::domain::HostError;

#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(not(test), allow(dead_code))]
pub struct Notice {
    pub title: String,
    pub body: String,
}

pub trait Notifier: Send {
    fn notify(&self, title: &str, body: &str) -> Result<(), HostError>;
}

#[cfg_attr(not(test), allow(dead_code))]
pub struct RecordingNotifier {
    pub notices: std::sync::Mutex<Vec<Notice>>,
}

#[cfg_attr(not(test), allow(dead_code))]
impl RecordingNotifier {
    pub fn new() -> Self {
        Self {
            notices: std::sync::Mutex::new(Vec::new()),
        }
    }

    pub fn bodies(&self) -> Vec<String> {
        self.notices
            .lock()
            .map(|notices| notices.iter().map(|notice| notice.body.clone()).collect())
            .unwrap_or_default()
    }
}

impl Notifier for RecordingNotifier {
    fn notify(&self, title: &str, body: &str) -> Result<(), HostError> {
        self.notices
            .lock()
            .map_err(|error| HostError::Storage(error.to_string()))?
            .push(Notice {
                title: title.to_string(),
                body: body.to_string(),
            });
        Ok(())
    }
}
