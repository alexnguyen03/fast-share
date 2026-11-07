use std::path::Path;

use crate::domain::HostError;

pub const MAX_DRAG_PREVIEW_PX: u32 = 96;
const CORNER_RADIUS_PX: f32 = 8.0;

pub struct DragThumbnail {
    pub width: u32,
    pub height: u32,
    pub center_x: i32,
    pub center_y: i32,
    pub bgra: Vec<u8>,
}

pub fn build_drag_thumbnail(path: &Path) -> Result<DragThumbnail, HostError> {
    let img = image::open(path).map_err(|err| HostError::Storage(err.to_string()))?;
    Ok(thumbnail_from_image(&img, MAX_DRAG_PREVIEW_PX))
}

pub fn thumbnail_from_image(img: &image::DynamicImage, max_dim: u32) -> DragThumbnail {
    let resized = img.thumbnail(max_dim, max_dim).to_rgba8();
    let width = resized.width().max(1);
    let height = resized.height().max(1);
    let mut bgra = Vec::with_capacity((width * height * 4) as usize);

    for (x, y, pixel) in resized.enumerate_pixels() {
        if is_outside_rounded_corner(x, y, width, height, CORNER_RADIUS_PX) {
            // Color-key magenta (COLORREF 0x00FF00FF -> B=255, G=0, R=255) for transparent corners
            bgra.extend_from_slice(&[255, 0, 255, 0]);
        } else {
            let [r, g, mut b, a] = pixel.0;
            if r == 255 && g == 0 && b == 255 {
                b = 254;
            }
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
mod win {
    use std::{ffi::c_void, iter::once, os::windows::ffi::OsStrExt, path::Path, sync::Once};
    use windows::{
        core::*,
        Win32::{
            Foundation::{
                BOOL, COLORREF, DRAGDROP_S_CANCEL, DRAGDROP_S_DROP, DRAGDROP_S_USEDEFAULTCURSORS,
                POINT, SIZE, S_OK,
            },
            Graphics::Gdi::{CreateBitmap, DeleteObject},
            System::{
                Com::{CoCreateInstance, IDataObject, CLSCTX_ALL},
                Ole::{
                    DoDragDrop, IDropSource, IDropSource_Impl, OleInitialize, DROPEFFECT,
                    DROPEFFECT_COPY,
                },
                SystemServices::{MK_LBUTTON, MODIFIERKEYS_FLAGS},
            },
            UI::Shell::{
                BHID_DataObject, CLSID_DragDropHelper, IDragSourceHelper, ILCreateFromPathW,
                ILFree, IShellItemArray, SHCreateShellItemArrayFromIDLists, SHDRAGIMAGE,
            },
        },
    };

    use super::build_drag_thumbnail;
    use crate::domain::HostError;

    static OLE_INIT: Once = Once::new();

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
                S_OK
            }
        }

        fn GiveFeedback(&self, _dweffect: DROPEFFECT) -> HRESULT {
            DRAGDROP_S_USEDEFAULTCURSORS
        }
    }

    pub fn start_file_drag_centered(path: &Path) -> std::result::Result<(), HostError> {
        let canonical = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
        let thumb = build_drag_thumbnail(&canonical)?;

        OLE_INIT.call_once(|| {
            // SAFETY: OleInitialize initializes COM/OLE on the current thread with reserved null parameter.
            unsafe {
                let _ = OleInitialize(Some(std::ptr::null_mut()));
            }
        });

        let wide_path: Vec<u16> = canonical.as_os_str().encode_wide().chain(once(0)).collect();

        // SAFETY: wide_path is a valid null-terminated UTF-16 string; we free the ITEMIDLIST with ILFree after creating the shell array.
        let data_object: IDataObject = unsafe {
            let item_id = ILCreateFromPathW(PCWSTR::from_raw(wide_path.as_ptr()));
            if item_id.is_null() {
                return Err(HostError::Storage(
                    "failed to create shell item id for drag path".to_string(),
                ));
            }
            let list = [item_id.cast_const()];
            let shell_array_res: windows::core::Result<IShellItemArray> =
                SHCreateShellItemArrayFromIDLists(&list);
            ILFree(Some(item_id.cast_const()));
            let shell_array = shell_array_res.map_err(|err| HostError::Storage(err.to_string()))?;
            shell_array
                .BindToHandler(None, &BHID_DataObject)
                .map_err(|err| HostError::Storage(err.to_string()))?
        };

        // SAFETY: thumb.bgra contains exactly width * height * 4 bytes of 32-bpp BGRA pixels.
        unsafe {
            let hbitmap = CreateBitmap(
                thumb.width as i32,
                thumb.height as i32,
                1,
                32,
                Some(thumb.bgra.as_ptr() as *const c_void),
            );
            if !hbitmap.is_invalid() {
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
                    crColorKey: COLORREF(0x00FF00FF),
                };

                let helper_res: windows::core::Result<IDragSourceHelper> =
                    CoCreateInstance(&CLSID_DragDropHelper, None, CLSCTX_ALL);
                if let Ok(helper) = helper_res {
                    if helper
                        .InitializeFromBitmap(&mut drag_image, &data_object)
                        .is_err()
                    {
                        let _ = DeleteObject(hbitmap);
                    }
                } else {
                    let _ = DeleteObject(hbitmap);
                }
            }

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
    use super::{thumbnail_from_image, MAX_DRAG_PREVIEW_PX};

    #[test]
    fn large_image_is_scaled_down_and_cursor_offset_is_centered() {
        let img = image::DynamicImage::new_rgba8(1080, 2400);
        let thumb = thumbnail_from_image(&img, MAX_DRAG_PREVIEW_PX);

        assert!(thumb.width <= MAX_DRAG_PREVIEW_PX);
        assert!(thumb.height <= MAX_DRAG_PREVIEW_PX);
        assert_eq!(thumb.center_x, (thumb.width as i32) / 2);
        assert_eq!(thumb.center_y, (thumb.height as i32) / 2);
        assert_eq!(&thumb.bgra[0..4], &[255, 0, 255, 0]);
    }
}
