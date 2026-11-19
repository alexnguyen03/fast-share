use crate::domain::HostError;

pub trait Clipboard: Send {
    fn write_png(&self, png: &[u8]) -> Result<(), HostError>;

    fn write_rgba(
        &self,
        width: u32,
        height: u32,
        rgba: &[u8],
        fallback_png: &[u8],
    ) -> Result<(), HostError> {
        let _ = (width, height, rgba);
        self.write_png(fallback_png)
    }

    fn write_text(&self, text: &str) -> Result<(), HostError>;
}

#[cfg_attr(not(test), allow(dead_code))]
pub struct RecordingClipboard {
    pub writes: std::sync::Mutex<Vec<Vec<u8>>>,
    pub texts: std::sync::Mutex<Vec<String>>,
}

#[cfg_attr(not(test), allow(dead_code))]
impl RecordingClipboard {
    pub fn new() -> Self {
        Self {
            writes: std::sync::Mutex::new(Vec::new()),
            texts: std::sync::Mutex::new(Vec::new()),
        }
    }

    pub fn count(&self) -> usize {
        self.writes.lock().map(|writes| writes.len()).unwrap_or(0)
    }

    pub fn text_count(&self) -> usize {
        self.texts.lock().map(|texts| texts.len()).unwrap_or(0)
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

    fn write_text(&self, text: &str) -> Result<(), HostError> {
        self.texts
            .lock()
            .map_err(|error| HostError::Storage(error.to_string()))?
            .push(text.to_string());
        Ok(())
    }
}
