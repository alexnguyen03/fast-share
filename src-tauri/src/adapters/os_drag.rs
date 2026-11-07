use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
};

use crate::domain::HostError;

pub const MAX_DRAG_PREVIEW_PX: u32 = 96;
const CORNER_RADIUS_PX: f32 = 8.0;

#[derive(Clone)]
pub struct DragThumbnail {
    pub width: u32,
    pub height: u32,
    pub center_x: i32,
    pub center_y: i32,
    pub bgra: Vec<u8>,
}

fn thumbnail_cache() -> &'static Mutex<HashMap<PathBuf, Arc<DragThumbnail>>> {
    static CACHE: OnceLock<Mutex<HashMap<PathBuf, Arc<DragThumbnail>>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn normalize_win32_path(path: &Path) -> PathBuf {
    let canonical = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let raw = canonical.to_string_lossy();
    if let Some(stripped) = raw.strip_prefix(r"\\?\UNC\") {
        PathBuf::from(format!(r"\\{stripped}"))
    } else if let Some(stripped) = raw.strip_prefix(r"\\?\") {
        PathBuf::from(stripped)
    } else {
        canonical
    }
}

pub fn warm_drag_thumbnail_async(path: PathBuf) {
    let clean_path = normalize_win32_path(&path);
    if let Ok(cache) = thumbnail_cache().lock() {
        if cache.contains_key(&clean_path) {
            return;
        }
    }
    std::thread::spawn(move || {
        let _ = build_drag_thumbnail(&clean_path);
    });
}

pub fn build_drag_thumbnail(path: &Path) -> Result<Arc<DragThumbnail>, HostError> {
    let clean_path = normalize_win32_path(path);
    if let Ok(cache) = thumbnail_cache().lock() {
        if let Some(cached) = cache.get(&clean_path) {
            return Ok(Arc::clone(cached));
        }
    }

    #[cfg(target_os = "windows")]
    let thumb = win::decode_and_scale_wic(&clean_path).or_else(|_| {
        let img = image::open(&clean_path).map_err(|err| HostError::Storage(err.to_string()))?;
        Ok::<DragThumbnail, HostError>(thumbnail_from_image(&img, MAX_DRAG_PREVIEW_PX))
    })?;

    #[cfg(not(target_os = "windows"))]
    let thumb = {
        let img = image::open(&clean_path).map_err(|err| HostError::Storage(err.to_string()))?;
        thumbnail_from_image(&img, MAX_DRAG_PREVIEW_PX)
    };

    let arc = Arc::new(thumb);
    if let Ok(mut cache) = thumbnail_cache().lock() {
        cache.insert(clean_path, Arc::clone(&arc));
    }
    Ok(arc)
}

pub fn thumbnail_from_image(img: &image::DynamicImage, max_dim: u32) -> DragThumbnail {
    let resized = img
        .resize(max_dim, max_dim, image::imageops::FilterType::Nearest)
        .to_rgba8();
    let width = resized.width().max(1);
    let height = resized.height().max(1);
    let mut bgra = Vec::with_capacity((width * height * 4) as usize);

    for (x, y, pixel) in resized.enumerate_pixels() {
        if is_outside_rounded_corner(x, y, width, height, CORNER_RADIUS_PX) {
            bgra.extend_from_slice(&[0, 0, 0, 0]);
        } else {
            let [r, g, b, a] = pixel.0;
            let alpha = a as u16;
            let pb = ((b as u16 * alpha) / 255) as u8;
            let pg = ((g as u16 * alpha) / 255) as u8;
            let pr = ((r as u16 * alpha) / 255) as u8;
            bgra.extend_from_slice(&[pb, pg, pr, a]);
        }
    }

    DragThumbnail {
        width,
        height,
        center_x: (width as i32) / 2,
        center_y: (height as i32) / 2,
        bgra,
    }
}

fn is_outside_rounded_corner(x: u32, y: u32, width: u32, height: u32, radius: f32) -> bool {
    let r = radius.min((width as f32) / 2.0).min((height as f32) / 2.0);
    if r <= 0.0 {
        return false;
    }
    let xf = x as f32 + 0.5;
    let yf = y as f32 + 0.5;
    let wf = width as f32;
    let hf = height as f32;

    let dx = if xf < r {
        r - xf
    } else if xf > wf - r {
        xf - (wf - r)
    } else {
        0.0
    };

    let dy = if yf < r {
        r - yf
    } else if yf > hf - r {
        yf - (hf - r)
    } else {
        0.0
    };

    dx > 0.0 && dy > 0.0 && (dx * dx + dy * dy) > (r * r)
}

#[cfg(target_os = "windows")]
pub(crate) mod win {
    use std::{ffi::c_void, iter::once, os::windows::ffi::OsStrExt, path::Path};
    use windows::{
        core::*,
        Win32::{
            Foundation::{
                BOOL, COLORREF, DRAGDROP_S_CANCEL, DRAGDROP_S_DROP, DRAGDROP_S_USEDEFAULTCURSORS,
                GENERIC_READ, POINT, SIZE, S_OK,
            },
            Graphics::{
                Gdi::{CreateBitmap, DeleteObject},
                Imaging::{
                    CLSID_WICImagingFactory, GUID_WICPixelFormat32bppPBGRA, IWICImagingFactory,
                    WICBitmapInterpolationModeFant, WICConvertBitmapSource,
                    WICDecodeMetadataCacheOnDemand,
                },
            },
            System::{
                Com::{CoCreateInstance, IDataObject, CLSCTX_ALL, CLSCTX_INPROC_SERVER},
                Ole::{
                    DoDragDrop, IDropSource, IDropSource_Impl, OleInitialize, DROPEFFECT,
                    DROPEFFECT_COPY,
                },
                SystemServices::{MK_LBUTTON, MODIFIERKEYS_FLAGS},
            },
            UI::{
                Shell::{
                    BHID_DataObject, CLSID_DragDropHelper, IDragSourceHelper, ILCreateFromPathW,
                    ILFree, IShellItemArray, SHCreateShellItemArrayFromIDLists, SHDRAGIMAGE,
                },
                WindowsAndMessaging::{
                    FindWindowW, SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
                },
            },
        },
    };

    use super::{
        build_drag_thumbnail, is_outside_rounded_corner, normalize_win32_path, DragThumbnail,
        CORNER_RADIUS_PX, MAX_DRAG_PREVIEW_PX,
    };
    use crate::domain::HostError;

    pub fn decode_and_scale_wic(path: &Path) -> std::result::Result<DragThumbnail, HostError> {
        let wide_path: Vec<u16> = path.as_os_str().encode_wide().chain(once(0)).collect();
        // SAFETY: WIC factory and scaler use standard Win32 COM calls; pixel buffer matches width * height * 4.
        unsafe {
            let _ = OleInitialize(Some(std::ptr::null_mut()));
            let factory: IWICImagingFactory =
                CoCreateInstance(&CLSID_WICImagingFactory, None, CLSCTX_INPROC_SERVER)
                    .map_err(|err| HostError::Storage(err.to_string()))?;
            let decoder = factory
                .CreateDecoderFromFilename(
                    PCWSTR::from_raw(wide_path.as_ptr()),
                    None,
                    GENERIC_READ,
                    WICDecodeMetadataCacheOnDemand,
                )
                .map_err(|err| HostError::Storage(err.to_string()))?;
            let frame = decoder
                .GetFrame(0)
                .map_err(|err| HostError::Storage(err.to_string()))?;

            let mut orig_w: u32 = 0;
            let mut orig_h: u32 = 0;
            frame
                .GetSize(&mut orig_w, &mut orig_h)
                .map_err(|err| HostError::Storage(err.to_string()))?;
            let orig_w = orig_w.max(1);
            let orig_h = orig_h.max(1);

            let (width, height) = if orig_w <= MAX_DRAG_PREVIEW_PX && orig_h <= MAX_DRAG_PREVIEW_PX
            {
                (orig_w, orig_h)
            } else if orig_w >= orig_h {
                let w = MAX_DRAG_PREVIEW_PX;
                let h = ((orig_h as u64 * w as u64) / orig_w as u64).max(1) as u32;
                (w, h)
            } else {
                let h = MAX_DRAG_PREVIEW_PX;
                let w = ((orig_w as u64 * h as u64) / orig_h as u64).max(1) as u32;
                (w, h)
            };

            let scaler = factory
                .CreateBitmapScaler()
                .map_err(|err| HostError::Storage(err.to_string()))?;
            scaler
                .Initialize(&frame, width, height, WICBitmapInterpolationModeFant)
                .map_err(|err| HostError::Storage(err.to_string()))?;

            let converted = WICConvertBitmapSource(&GUID_WICPixelFormat32bppPBGRA, &scaler)
                .map_err(|err| HostError::Storage(err.to_string()))?;

            let mut bgra = vec![0u8; (width * height * 4) as usize];
            converted
                .CopyPixels(std::ptr::null(), width * 4, &mut bgra)
                .map_err(|err| HostError::Storage(err.to_string()))?;

            for y in 0..height {
                for x in 0..width {
                    if is_outside_rounded_corner(x, y, width, height, CORNER_RADIUS_PX) {
                        let idx = ((y * width + x) * 4) as usize;
                        bgra[idx..idx + 4].copy_from_slice(&[0, 0, 0, 0]);
                    }
                }
            }

            Ok(DragThumbnail {
                width,
                height,
                center_x: (width as i32) / 2,
                center_y: (height as i32) / 2,
                bgra,
            })
        }
    }

    #[implement(IDropSource)]
    struct CenteredDropSource;

    #[allow(non_snake_case)]
    impl IDropSource_Impl for CenteredDropSource {
        fn QueryContinueDrag(
            &self,
            fescapepressed: BOOL,
            grfkeystate: MODIFIERKEYS_FLAGS,
        ) -> HRESULT {
            if fescapepressed.as_bool() {
                DRAGDROP_S_CANCEL
            } else if (grfkeystate & MK_LBUTTON) == MODIFIERKEYS_FLAGS(0) {
                DRAGDROP_S_DROP
            } else {
                // Keep the Windows Shell drag preview window ("SysDragImage") above TOPMOST windows.
                // SAFETY: FindWindowW and SetWindowPos are standard Win32 calls with a static UTF-16 class name.
                unsafe {
                    let class_name: [u16; 13] = [
                        b'S' as u16,
                        b'y' as u16,
                        b's' as u16,
                        b'D' as u16,
                        b'r' as u16,
                        b'a' as u16,
                        b'g' as u16,
                        b'I' as u16,
                        b'm' as u16,
                        b'a' as u16,
                        b'g' as u16,
                        b'e' as u16,
                        0,
                    ];
                    let drag_hwnd =
                        FindWindowW(PCWSTR::from_raw(class_name.as_ptr()), PCWSTR::null());
                    if drag_hwnd.0 != 0 {
                        let _ = SetWindowPos(
                            drag_hwnd,
                            HWND_TOPMOST,
                            0,
                            0,
                            0,
                            0,
                            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
                        );
                    }
                }
                S_OK
            }
        }

        fn GiveFeedback(&self, _dweffect: DROPEFFECT) -> HRESULT {
            DRAGDROP_S_USEDEFAULTCURSORS
        }
    }

    pub fn create_shell_data_object(path: &Path) -> std::result::Result<IDataObject, HostError> {
        let clean_path = normalize_win32_path(path);
        let wide_path: Vec<u16> = clean_path
            .as_os_str()
            .encode_wide()
            .chain(once(0))
            .collect();

        // SAFETY: OleInitialize is safe to call per-thread; wide_path is null-terminated UTF-16 without the `\\?\` prefix so ILCreateFromPathW succeeds.
        unsafe {
            let _ = OleInitialize(Some(std::ptr::null_mut()));
            let item_id = ILCreateFromPathW(PCWSTR::from_raw(wide_path.as_ptr()));
            if item_id.is_null() {
                return Err(HostError::Storage(format!(
                    "failed to create shell item id for drag path: {}",
                    clean_path.display()
                )));
            }
            let list = [item_id.cast_const()];
            let shell_array_res: windows::core::Result<IShellItemArray> =
                SHCreateShellItemArrayFromIDLists(&list);
            ILFree(Some(item_id.cast_const()));
            let shell_array = shell_array_res.map_err(|err| HostError::Storage(err.to_string()))?;
            shell_array
                .BindToHandler(None, &BHID_DataObject)
                .map_err(|err| HostError::Storage(err.to_string()))
        }
    }

    pub fn attach_drag_thumbnail(data_object: &IDataObject, thumb: &super::DragThumbnail) -> bool {
        // SAFETY: thumb.bgra contains width * height * 4 bytes of 32-bpp premultiplied BGRA pixels.
        unsafe {
            let hbitmap = CreateBitmap(
                thumb.width as i32,
                thumb.height as i32,
                1,
                32,
                Some(thumb.bgra.as_ptr() as *const c_void),
            );
            if hbitmap.is_invalid() {
                return false;
            }
            let mut drag_image = SHDRAGIMAGE {
                sizeDragImage: SIZE {
                    cx: thumb.width as i32,
                    cy: thumb.height as i32,
                },
                ptOffset: POINT {
                    x: thumb.center_x,
                    y: thumb.center_y,
                },
                hbmpDragImage: hbitmap,
                crColorKey: COLORREF(0x00000000),
            };

            let helper_res: windows::core::Result<IDragSourceHelper> =
                CoCreateInstance(&CLSID_DragDropHelper, None, CLSCTX_ALL);
            if let Ok(helper) = helper_res {
                if helper
                    .InitializeFromBitmap(&mut drag_image, data_object)
                    .is_ok()
                {
                    return true;
                }
            }
            let _ = DeleteObject(hbitmap);
            false
        }
    }

    pub fn start_file_drag_centered(path: &Path) -> std::result::Result<(), HostError> {
        let clean_path = normalize_win32_path(path);
        let thumb = build_drag_thumbnail(&clean_path)?;
        let data_object = create_shell_data_object(&clean_path)?;
        let _ = attach_drag_thumbnail(&data_object, &thumb);

        // SAFETY: data_object and drop_source are valid COM objects on an OLE-initialized thread.
        unsafe {
            let drop_source: IDropSource = CenteredDropSource.into();
            let mut out_effect = DROPEFFECT::default();
            let _ = DoDragDrop(&data_object, &drop_source, DROPEFFECT_COPY, &mut out_effect);
        }

        Ok(())
    }
}

#[cfg(target_os = "windows")]
pub fn start_native_file_drag(
    _window: &tauri::WebviewWindow,
    path: &Path,
) -> Result<(), HostError> {
    win::start_file_drag_centered(path)
}

#[cfg(target_os = "macos")]
pub fn start_native_file_drag(window: &tauri::WebviewWindow, path: &Path) -> Result<(), HostError> {
    let canonical = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let img = image::open(&canonical).map_err(|err| HostError::Storage(err.to_string()))?;
    let resized = img.thumbnail(MAX_DRAG_PREVIEW_PX, MAX_DRAG_PREVIEW_PX);
    let mut png_bytes = Vec::new();
    let mut cursor = std::io::Cursor::new(&mut png_bytes);
    resized
        .write_to(&mut cursor, image::ImageFormat::Png)
        .map_err(|err| HostError::Storage(err.to_string()))?;

    let item = drag::DragItem::Files(vec![canonical]);
    let preview = drag::Image::Raw(png_bytes);
    drag::start_drag(window, item, preview, |_, _| {}, drag::Options::default())
        .map_err(|err| HostError::Storage(err.to_string()))
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
pub fn start_native_file_drag(
    _window: &tauri::WebviewWindow,
    _path: &Path,
) -> Result<(), HostError> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{normalize_win32_path, thumbnail_from_image, MAX_DRAG_PREVIEW_PX};

    #[test]
    fn large_image_is_scaled_down_and_cursor_offset_is_centered() {
        let img = image::DynamicImage::new_rgba8(1080, 2400);
        let thumb = thumbnail_from_image(&img, MAX_DRAG_PREVIEW_PX);

        assert!(thumb.width <= MAX_DRAG_PREVIEW_PX);
        assert!(thumb.height <= MAX_DRAG_PREVIEW_PX);
        assert_eq!(thumb.center_x, (thumb.width as i32) / 2);
        assert_eq!(thumb.center_y, (thumb.height as i32) / 2);
        assert_eq!(&thumb.bgra[0..4], &[0, 0, 0, 0]);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn win32_shell_data_object_succeeds_for_canonicalized_file() {
        let temp_dir = std::env::temp_dir();
        let file_path = temp_dir.join("fast_share_drag_test.png");
        let img = image::DynamicImage::new_rgba8(200, 100);
        img.save(&file_path).unwrap();

        let normalized = normalize_win32_path(&file_path);
        assert!(!normalized.to_string_lossy().starts_with(r"\\?\"));

        let data_object = super::win::create_shell_data_object(&file_path);
        let thumb = super::build_drag_thumbnail(&file_path).unwrap();
        let _ = std::fs::remove_file(&file_path);
        let data_object = data_object.expect("expected shell IDataObject");
        let bitmap_attached = super::win::attach_drag_thumbnail(&data_object, &thumb);
        assert!(bitmap_attached, "expected InitializeFromBitmap to succeed");
    }
}
