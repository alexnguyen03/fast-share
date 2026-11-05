use std::io::Cursor;

use image::{ImageReader, Limits};

use super::error::HostError;

pub const MAX_IMAGE_BYTES: usize = 20 * 1024 * 1024;
pub const MAX_BATCH_IMAGES: usize = 20;
const MAX_DIMENSION: u32 = 8_192;

#[derive(Clone, Debug)]
pub struct ValidImage {
    pub png: Vec<u8>,
}

pub fn validate_image(bytes: &[u8]) -> Result<ValidImage, HostError> {
    if bytes.is_empty() {
        return Err(HostError::ImageUndecodable);
    }
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err(HostError::ImageTooLarge);
    }

    let mut reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|_| HostError::ImageUndecodable)?;
    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_DIMENSION);
    limits.max_image_height = Some(MAX_DIMENSION);
    limits.max_alloc = Some(64 * 1024 * 1024);
    reader.limits(limits);
    let image = reader.decode().map_err(|_| HostError::ImageUndecodable)?;
    let mut png = Vec::new();
    image
        .write_to(&mut Cursor::new(&mut png), image::ImageFormat::Png)
        .map_err(|_| HostError::ImageUndecodable)?;
    Ok(ValidImage { png })
}
