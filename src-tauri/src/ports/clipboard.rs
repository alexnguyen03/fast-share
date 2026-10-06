use crate::domain::HostError;

pub trait Clipboard: Send {
    fn write_png(&self, png: &[u8]) -> Result<(), HostError>;
}

#[cfg_attr(not(test), allow(dead_code))]
pub struct RecordingClipboard {
    pub writes: std::sync::Mutex<Vec<Vec<u8>>>,
}

#[cfg_attr(not(test), allow(dead_code))]
impl RecordingClipboard {
    pub fn new() -> Self {
        Self {
            writes: std::sync::Mutex::new(Vec::new()),
        }
    }

    pub fn count(&self) -> usize {
        self.writes.lock().map(|writes| writes.len()).unwrap_or(0)
    }
}

impl Clipboard for RecordingClipboard {
    fn write_png(&self, png: &[u8]) -> Result<(), HostError> {
        self.writes
            .lock()
            .map_err(|error| HostError::Storage(error.to_string()))?
            .push(png.to_vec());
        Ok(())
    }
}
