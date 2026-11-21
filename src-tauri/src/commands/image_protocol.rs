//! `fsimg://` serves history images straight to `<img>` tags, off the main thread:
//! `thumb-<id>` is a small cached JPEG for the list, `full-<id>` the original file for the preview.
//! Before this, every tile pulled the whole file through a synchronous command as base64,
//! which froze the window for seconds with large photos.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::http::{Response, StatusCode};
use tauri::Manager;

use crate::domain::ImageId;
use crate::ports::Store;
use crate::runtime::SharedHost;

pub const SCHEME: &str = "fsimg";
const THUMB_PX: u32 = 480;
const THUMB_QUALITY: u8 = 78;

// Decoding a 40 MB photo takes a lot of memory; make thumbnails one at a time.
static THUMB_WORK: Mutex<()> = Mutex::new(());

pub fn respond(app: &tauri::AppHandle, path: &str) -> Response<Vec<u8>> {
    match serve(app, path.trim_start_matches('/')) {
        Ok((bytes, mime)) => Response::builder()
            .header("Content-Type", mime)
            // an id always names the same picture
            .header("Cache-Control", "private, max-age=31536000, immutable")
            .body(bytes),
        Err(status) => Response::builder().status(status).body(Vec::new()),
    }
    .unwrap_or_else(|_| Response::new(Vec::new()))
}

fn serve(app: &tauri::AppHandle, path: &str) -> Result<(Vec<u8>, &'static str), StatusCode> {
    let (kind, raw_id) = path.split_once('-').ok_or(StatusCode::BAD_REQUEST)?;
    let id = ImageId::parse(raw_id).map_err(|_| StatusCode::BAD_REQUEST)?;
    let file = image_path(app, &id).ok_or(StatusCode::NOT_FOUND)?;
    match kind {
        "full" => {
            let bytes = std::fs::read(&file).map_err(|_| StatusCode::NOT_FOUND)?;
            let mime = mime_of(&bytes);
            Ok((bytes, mime))
        }
        "thumb" => {
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            crate::adapters::warm_drag_thumbnail_async(file.clone());
            let cache = app
                .path()
                .app_cache_dir()
                .map(|dir| dir.join("thumbs"))
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            thumbnail(&file, &cache, id.as_str())
                .map(|bytes| (bytes, "image/jpeg"))
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
        }
        _ => Err(StatusCode::BAD_REQUEST),
    }
}

/// Holds the host lock only long enough to find the file.
fn image_path(app: &tauri::AppHandle, id: &ImageId) -> Option<PathBuf> {
    let state = app.try_state::<SharedHost>()?;
    let host = state.lock().ok()?;
    let file_name = host
        .store
        .list_batches()
        .ok()?
        .into_iter()
        .flat_map(|batch| batch.images.into_iter())
        .find(|image| &image.id == id)?
        .file_name;
    host.store.image_file(&file_name).ok()
}

fn mime_of(bytes: &[u8]) -> &'static str {
    match image::guess_format(bytes) {
        Ok(image::ImageFormat::Jpeg) => "image/jpeg",
        Ok(image::ImageFormat::WebP) => "image/webp",
        Ok(image::ImageFormat::Gif) => "image/gif",
        _ => "image/png",
    }
}

fn thumbnail(source: &Path, cache_dir: &Path, id: &str) -> Result<Vec<u8>, String> {
    let cached = cache_dir.join(format!("{id}.jpg"));
    if let Ok(bytes) = std::fs::read(&cached) {
        return Ok(bytes);
    }
    let _turn = THUMB_WORK.lock().map_err(|error| error.to_string())?;
    // another request may have made it while this one waited
    if let Ok(bytes) = std::fs::read(&cached) {
        return Ok(bytes);
    }
    let bytes = make_thumbnail(&std::fs::read(source).map_err(|error| error.to_string())?)?;
    // shortcut: a failed cache write only means the thumbnail is made again next time
    let _ = std::fs::create_dir_all(cache_dir).and_then(|()| std::fs::write(&cached, &bytes));
    Ok(bytes)
}

fn make_thumbnail(original: &[u8]) -> Result<Vec<u8>, String> {
    let picture = image::load_from_memory(original).map_err(|error| error.to_string())?;
    let small = picture.thumbnail(THUMB_PX, THUMB_PX).to_rgb8();
    let mut out = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, THUMB_QUALITY)
        .encode_image(&small)
        .map_err(|error| error.to_string())?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn thumbnail_is_a_small_jpeg_that_keeps_the_aspect_ratio() {
        let big = image::RgbImage::from_pixel(1600, 800, image::Rgb([10, 200, 30]));
        let mut png = Vec::new();
        image::DynamicImage::ImageRgb8(big)
            .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .unwrap();
        let thumb = make_thumbnail(&png).unwrap();
        assert_eq!(image::guess_format(&thumb).unwrap(), image::ImageFormat::Jpeg);
        let decoded = image::load_from_memory(&thumb).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (THUMB_PX, THUMB_PX / 2));
        assert_eq!(mime_of(&png), "image/png");
    }
}
