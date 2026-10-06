use crate::domain::HostError;
use crate::ports::Clipboard;

pub struct OsClipboard;

impl Clipboard for OsClipboard {
    fn write_png(&self, png: &[u8]) -> Result<(), HostError> {
        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        {
            let image = image::load_from_memory(png).map_err(|_| HostError::ImageUndecodable)?;
            let rgba = image.to_rgba8();
            let width = rgba.width() as usize;
            let height = rgba.height() as usize;
            let clipboard_image = arboard::ImageData {
                width,
                height,
                bytes: std::borrow::Cow::Owned(rgba.into_raw()),
            };
            let mut clipboard = arboard::Clipboard::new()
                .map_err(|error| HostError::Storage(error.to_string()))?;
            clipboard
                .set_image(clipboard_image)
                .map_err(|error| HostError::Storage(error.to_string()))?;
            return Ok(());
        }
        #[cfg(any(target_os = "android", target_os = "ios"))]
        {
            let _ = png;
            Err(HostError::Storage(
                "image clipboard is written on the computer".into(),
            ))
        }
    }
}
