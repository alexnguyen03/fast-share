use std::time::Duration;

use base64::Engine;
use serde::Serialize;
use tauri_plugin_opener::OpenerExt;

use crate::adapters::phone_client::{self, remembered_qr};
use crate::domain::{BatchId, DeviceId, DeviceTrust, HostError, ImageId, PcId, MAX_IMAGE_BYTES};
use crate::ports::Store;
use crate::runtime::{qr_png, DockEdge, SharedHost, WindowPrefs};
use crate::use_cases::{
    accept_device, copy_image, delete_all, delete_image, forget_device, reject_device, toggle_pin,
    update_settings,
};
use tauri::Emitter;

const APP_GROUP: &str = "group.com.alexnguyen03.fastshare";

fn text_err(error: HostError) -> String {
    error.to_string()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PhoneView {
    id: String,
    name: String,
    trust: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HostStatus {
    ready: bool,
    pc_name: String,
    retention_days: u32,
    qr_png_base64: String,
    pair_code: String,
    lan_address: String,
    firewall_warning: Option<String>,
    pending: Vec<PhoneView>,
    trusted_count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LanAddressView {
    name: String,
    ip: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LanInfoView {
    ip: String,
    subnet: String,
    addresses: Vec<LanAddressView>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NearbyPcView {
    pc_id: String,
    name: String,
    host: String,
    port: u16,
    paired: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImageView {
    id: String,
    pinned: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BatchView {
    id: String,
    phone_name: String,
    received_at: String,
    images: Vec<ImageView>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DestinationView {
    pc_id: String,
    name: String,
    online: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PairView {
    status: String,
}

#[tauri::command]
pub(crate) fn surface() -> &'static str {
    if cfg!(any(target_os = "ios", target_os = "android")) {
        "phone"
    } else {
        "desktop"
    }
}

#[tauri::command]
pub(crate) fn start_drag(window: tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        window.start_dragging().map_err(|error| error.to_string())
    }
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = window;
        Ok(())
    }
}

fn set_window_always_on_top(window: &tauri::WebviewWindow, always_on_top: bool) {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let _ = window.set_always_on_top(always_on_top);
    }
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = (window, always_on_top);
    }
}

fn begin_window_dragging(window: &tauri::WebviewWindow) {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let _ = window.start_dragging();
    }
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = window;
    }
}

const EXPANDED_W: f64 = 420.0;
const EXPANDED_H: f64 = 680.0;
const COLLAPSED_BOX: f64 = 160.0;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
const SNAP_THRESHOLD_PX: i32 = 40;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
const UNDOCK_THRESHOLD_PX: i32 = 72;

#[tauri::command]
pub(crate) fn get_window_prefs(state: tauri::State<'_, SharedHost>) -> Result<WindowPrefs, String> {
    let host = state.lock().map_err(text_err)?;
    Ok(host.window_prefs.clone())
}

#[tauri::command]
pub(crate) fn set_window_prefs(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, SharedHost>,
    snap_to_edge: Option<bool>,
    always_on_top: Option<bool>,
) -> Result<WindowPrefs, String> {
    let mut prefs = {
        let mut host = state.lock().map_err(text_err)?;
        if let Some(snap) = snap_to_edge {
            host.window_prefs.snap_to_edge = snap;
            if !snap {
                host.window_prefs.dock_edge = None;
                host.window_prefs.dock_expanded = true;
            }
        }
        if let Some(top) = always_on_top {
            host.window_prefs.always_on_top = top;
        }
        host.window_prefs.clone()
    };
    let effective_top = prefs.always_on_top || prefs.dock_edge.is_some();
    set_window_always_on_top(&window, effective_top);
    if prefs.dock_edge.is_none() {
        let _ = window.set_size(tauri::LogicalSize::new(EXPANDED_W, EXPANDED_H));
        prefs.dock_expanded = true;
    }
    let _ = window.emit("dock-state", &prefs);
    Ok(prefs)
}

#[tauri::command]
pub(crate) fn toggle_dock_expanded(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, SharedHost>,
) -> Result<WindowPrefs, String> {
    let mut prefs = {
        let host = state.lock().map_err(text_err)?;
        host.window_prefs.clone()
    };
    let Some(edge) = prefs.dock_edge else {
        return Ok(prefs);
    };
    prefs.dock_expanded = !prefs.dock_expanded;
    apply_dock_geometry(
        &window,
        edge,
        prefs.dock_expanded,
        prefs.dock_x,
        prefs.dock_y,
    );
    {
        let mut host = state.lock().map_err(text_err)?;
        host.window_prefs = prefs.clone();
    }
    let _ = window.emit("dock-state", &prefs);
    Ok(prefs)
}

#[tauri::command]
pub(crate) fn slide_docked(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, SharedHost>,
    delta_x: i32,
    delta_y: i32,
) -> Result<WindowPrefs, String> {
    let mut prefs = {
        let host = state.lock().map_err(text_err)?;
        host.window_prefs.clone()
    };
    let Some(edge) = prefs.dock_edge else {
        return Ok(prefs);
    };
    let scale = window
        .current_monitor()
        .ok()
        .flatten()
        .map(|m| m.scale_factor())
        .unwrap_or(1.0);
    match edge {
        DockEdge::Left | DockEdge::Right => {
            prefs.dock_y += (delta_y as f64 * scale).round() as i32;
        }
        DockEdge::Top | DockEdge::Bottom => {
            prefs.dock_x += (delta_x as f64 * scale).round() as i32;
        }
    }
    apply_dock_geometry(
        &window,
        edge,
        prefs.dock_expanded,
        prefs.dock_x,
        prefs.dock_y,
    );
    {
        let mut host = state.lock().map_err(text_err)?;
        host.window_prefs = prefs.clone();
    }
    Ok(prefs)
}

#[tauri::command]
pub(crate) fn undock_and_drag(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, SharedHost>,
) -> Result<WindowPrefs, String> {
    let Ok(Some(monitor)) = window.current_monitor() else {
        return Err("no monitor".to_string());
    };
    let scale = monitor.scale_factor();
    let work = monitor.work_area();
    let mon_left = work.position.x;
    let mon_top = work.position.y;
    let mon_right = work.position.x + work.size.width as i32;
    let mon_bottom = work.position.y + work.size.height as i32;

    let mut prefs = {
        let host = state.lock().map_err(text_err)?;
        host.window_prefs.clone()
    };
    let prev_edge = prefs.dock_edge;
    prefs.dock_edge = None;
    prefs.dock_expanded = true;

    let req_w = (EXPANDED_W * scale).round().max(1.0) as u32;
    let req_h = (EXPANDED_H * scale).round().max(1.0) as u32;
    set_window_always_on_top(&window, prefs.always_on_top);
    let _ = window.set_size(tauri::PhysicalSize::new(req_w, req_h));

    let w = req_w as i32;
    let h = req_h as i32;
    let margin = (52.0 * scale).round() as i32;
    let (new_x, new_y) = match prev_edge {
        Some(DockEdge::Left) => (
            mon_left + margin,
            prefs.dock_y.clamp(mon_top, (mon_bottom - h).max(mon_top)),
        ),
        Some(DockEdge::Right) => (
            (mon_right - w - margin).max(mon_left),
            prefs.dock_y.clamp(mon_top, (mon_bottom - h).max(mon_top)),
        ),
        Some(DockEdge::Top) => (
            prefs.dock_x.clamp(mon_left, (mon_right - w).max(mon_left)),
            mon_top + margin,
        ),
        Some(DockEdge::Bottom) => (
            prefs.dock_x.clamp(mon_left, (mon_right - w).max(mon_left)),
            (mon_bottom - h - margin).max(mon_top),
        ),
        None => (prefs.dock_x, prefs.dock_y),
    };
    let _ = window.set_position(tauri::PhysicalPosition::new(new_x, new_y));
    {
        let mut host = state.lock().map_err(text_err)?;
        host.window_prefs = prefs.clone();
    }
    let _ = window.emit("dock-state", &prefs);
    begin_window_dragging(&window);
    Ok(prefs)
}

#[tauri::command]
pub(crate) fn quit_app(app: tauri::AppHandle) {
    crate::request_quit(&app);
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub(crate) fn handle_window_moved(window: &tauri::WebviewWindow, shared: &SharedHost) {
    let Ok(pos) = window.outer_position() else {
        return;
    };
    let Ok(size) = window.outer_size() else {
        return;
    };
    let Ok(Some(monitor)) = window.current_monitor() else {
        return;
    };
    let scale = monitor.scale_factor();
    let work = monitor.work_area();
    let mon_left = work.position.x;
    let mon_top = work.position.y;
    let mon_right = work.position.x + work.size.width as i32;
    let mon_bottom = work.position.y + work.size.height as i32;

    let win_left = pos.x;
    let win_top = pos.y;
    let win_right = pos.x + size.width as i32;
    let win_bottom = pos.y + size.height as i32;

    let mut prefs = {
        let Ok(host) = shared.lock() else {
            return;
        };
        host.window_prefs.clone()
    };
    if !prefs.snap_to_edge {
        return;
    }

    let over_left = win_left - mon_left;
    let over_right = mon_right - win_right;
    let over_top = win_top - mon_top;
    let over_bottom = mon_bottom - win_bottom;

    if let Some(current_edge) = prefs.dock_edge {
        let raw_dist = match current_edge {
            DockEdge::Left => (win_left - mon_left).abs(),
            DockEdge::Right => (mon_right - win_right).abs(),
            DockEdge::Top => (win_top - mon_top).abs(),
            DockEdge::Bottom => (mon_bottom - win_bottom).abs(),
        };
        if raw_dist > (UNDOCK_THRESHOLD_PX as f64 * scale) as i32 {
            prefs.dock_edge = None;
            prefs.dock_expanded = true;
            set_window_always_on_top(window, prefs.always_on_top);
            let _ = window.set_size(tauri::LogicalSize::new(EXPANDED_W, EXPANDED_H));
            if let Ok(mut host) = shared.lock() {
                host.window_prefs = prefs.clone();
            }
            let _ = window.emit("dock-state", &prefs);
        } else {
            match current_edge {
                DockEdge::Left | DockEdge::Right => prefs.dock_y = pos.y,
                DockEdge::Top | DockEdge::Bottom => prefs.dock_x = pos.x,
            }
            apply_dock_geometry(
                window,
                current_edge,
                prefs.dock_expanded,
                prefs.dock_x,
                prefs.dock_y,
            );
            if let Ok(mut host) = shared.lock() {
                host.window_prefs = prefs;
            }
            return;
        }
    }

    let snap_px = (SNAP_THRESHOLD_PX as f64 * scale) as i32;
    let mut candidates = [
        (DockEdge::Left, over_left),
        (DockEdge::Right, over_right),
        (DockEdge::Top, over_top),
        (DockEdge::Bottom, over_bottom),
    ];
    candidates.sort_by_key(|(_, d)| *d);
    let target_edge = (candidates[0].1 <= snap_px).then_some(candidates[0].0);

    if let Some(edge) = target_edge {
        prefs.dock_edge = Some(edge);
        prefs.dock_expanded = false;
        prefs.dock_x = pos.x;
        prefs.dock_y = pos.y;
        set_window_always_on_top(window, true);
        apply_dock_geometry(window, edge, false, pos.x, pos.y);
        if let Ok(mut host) = shared.lock() {
            host.window_prefs = prefs.clone();
        }
        let _ = window.emit("dock-state", &prefs);
    }
}

fn apply_dock_geometry(
    window: &tauri::WebviewWindow,
    edge: DockEdge,
    expanded: bool,
    saved_x: i32,
    saved_y: i32,
) {
    let Ok(Some(monitor)) = window.current_monitor() else {
        return;
    };
    let scale = monitor.scale_factor();
    let work = monitor.work_area();
    let mon_left = work.position.x;
    let mon_top = work.position.y;
    let mon_right = work.position.x + work.size.width as i32;
    let mon_bottom = work.position.y + work.size.height as i32;

    let (w_log, h_log) = if expanded {
        (EXPANDED_W, EXPANDED_H)
    } else {
        (COLLAPSED_BOX, COLLAPSED_BOX)
    };
    let req_w = (w_log * scale).round().max(1.0) as u32;
    let req_h = (h_log * scale).round().max(1.0) as u32;

    let _ = window.set_min_size(Some(tauri::LogicalSize::new(1.0, 1.0)));
    let _ = window.set_size(tauri::PhysicalSize::new(req_w, req_h));

    let actual = window
        .outer_size()
        .unwrap_or(tauri::PhysicalSize::new(req_w, req_h));
    let w = actual.width as i32;
    let h = actual.height as i32;

    let clamp_x = saved_x.clamp(mon_left, (mon_right - w).max(mon_left));
    let clamp_y = saved_y.clamp(mon_top, (mon_bottom - h).max(mon_top));

    let (x, y) = match edge {
        DockEdge::Left => (mon_left, clamp_y),
        DockEdge::Right => (mon_right - w, clamp_y),
        DockEdge::Top => (clamp_x, mon_top),
        DockEdge::Bottom => (clamp_x, mon_bottom - h),
    };

    let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
}

#[tauri::command]
pub(crate) fn host_status(state: tauri::State<'_, SharedHost>) -> Result<HostStatus, String> {
    let mut host = state.lock().map_err(text_err)?;
    let settings = host.store.load_settings().map_err(text_err)?;
    let phones = host.store.list_phones().map_err(text_err)?;
    let payload = host.qr_payload().map_err(text_err)?;
    let pair_code = host.ticket.code.clone();
    let lan_address = format!("{}:{}", payload.host, payload.port);
    let png = qr_png(&payload).map_err(text_err)?;
    let pending = phones
        .iter()
        .filter(|phone| phone.trust == DeviceTrust::PendingAcceptance)
        .map(phone_view)
        .collect();
    let trusted_count = phones
        .iter()
        .filter(|phone| phone.trust == DeviceTrust::Trusted)
        .count();
    Ok(HostStatus {
        ready: true,
        pc_name: settings.pc_display_name,
        retention_days: settings.history_retention_days,
        qr_png_base64: base64::engine::general_purpose::STANDARD.encode(png),
        pair_code,
        lan_address,
        firewall_warning: crate::adapters::firewall_warning(),
        pending,
        trusted_count,
    })
}

#[tauri::command]
pub(crate) fn lan_info() -> LanInfoView {
    let snapshot = crate::adapters::lan_snapshot();
    LanInfoView {
        ip: snapshot.ip.to_string(),
        subnet: snapshot.subnet,
        addresses: snapshot
            .addresses
            .into_iter()
            .map(|(name, ip)| LanAddressView {
                name,
                ip: ip.to_string(),
            })
            .collect(),
    }
}

#[tauri::command]
pub(crate) fn allow_firewall(state: tauri::State<'_, SharedHost>) -> Result<(), String> {
    let port = {
        let host = state.lock().map_err(text_err)?;
        host.port
    };
    crate::adapters::allow_in_firewall(port)
}

#[tauri::command]
pub(crate) fn list_phones(state: tauri::State<'_, SharedHost>) -> Result<Vec<PhoneView>, String> {
    let host = state.lock().map_err(text_err)?;
    let phones = host.store.list_phones().map_err(text_err)?;
    Ok(phones
        .iter()
        .filter(|phone| phone.trust != DeviceTrust::Unknown)
        .map(phone_view)
        .collect())
}

#[tauri::command]
pub(crate) fn accept_phone(
    state: tauri::State<'_, SharedHost>,
    device_id: String,
) -> Result<(), String> {
    let mut host = state.lock().map_err(text_err)?;
    let id = DeviceId::parse(device_id).map_err(text_err)?;
    accept_device(&mut host.store, &id)
        .map(|_| ())
        .map_err(text_err)
}

#[tauri::command]
pub(crate) fn reject_phone(
    state: tauri::State<'_, SharedHost>,
    device_id: String,
) -> Result<(), String> {
    let mut host = state.lock().map_err(text_err)?;
    let id = DeviceId::parse(device_id).map_err(text_err)?;
    reject_device(&mut host.store, &id).map_err(text_err)
}

#[tauri::command]
pub(crate) fn forget_phone(
    state: tauri::State<'_, SharedHost>,
    device_id: String,
) -> Result<(), String> {
    let mut host = state.lock().map_err(text_err)?;
    let id = DeviceId::parse(device_id).map_err(text_err)?;
    forget_device(&mut host.store, &id).map_err(text_err)
}

#[tauri::command]
pub(crate) fn list_history(state: tauri::State<'_, SharedHost>) -> Result<Vec<BatchView>, String> {
    let host = state.lock().map_err(text_err)?;
    let mut batches = host.store.list_batches().map_err(text_err)?;
    batches.sort_by(|left, right| right.received_at.cmp(&left.received_at));
    let mut views = Vec::new();
    for batch in batches {
        let images = batch
            .images
            .into_iter()
            .map(|image| ImageView {
                id: image.id.as_str().to_string(),
                pinned: image.pinned,
            })
            .collect();
        views.push(BatchView {
            id: batch.id.as_str().to_string(),
            phone_name: batch.phone_name,
            received_at: batch.received_at.to_rfc3339(),
            images,
        });
    }
    Ok(views)
}

#[tauri::command]
pub(crate) fn get_history_image(
    state: tauri::State<'_, SharedHost>,
    image_id: String,
) -> Result<String, String> {
    let host = state.lock().map_err(text_err)?;
    let id = ImageId::parse(image_id).map_err(text_err)?;
    let batches = host.store.list_batches().map_err(text_err)?;
    let file_name = batches
        .iter()
        .flat_map(|batch| batch.images.iter())
        .find(|image| image.id == id)
        .map(|image| image.file_name.clone())
        .ok_or_else(|| HostError::NotFound.to_string())?;
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    if let Ok(path) = host.store.image_file(&file_name) {
        crate::adapters::warm_drag_thumbnail_async(path);
    }
    let png = host.store.read_image(&file_name).map_err(text_err)?;
    Ok(base64::engine::general_purpose::STANDARD.encode(png))
}

#[tauri::command]
pub(crate) fn copy_history_image(
    state: tauri::State<'_, SharedHost>,
    image_id: String,
) -> Result<(), String> {
    let host = state.lock().map_err(text_err)?;
    let id = ImageId::parse(image_id).map_err(text_err)?;
    copy_image(&host.store, &host.clipboard, &id).map_err(text_err)
}

#[tauri::command]
pub(crate) fn open_history_image(
    app: tauri::AppHandle,
    state: tauri::State<'_, SharedHost>,
    image_id: String,
) -> Result<(), String> {
    let path = history_image_path(&state, &image_id)?;
    app.opener()
        .open_path(path.to_string_lossy().to_string(), None::<&str>)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn reveal_history_image(
    app: tauri::AppHandle,
    state: tauri::State<'_, SharedHost>,
    image_id: String,
) -> Result<(), String> {
    let path = history_image_path(&state, &image_id)?;
    app.opener()
        .reveal_item_in_dir(path)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn copy_history_image_path(
    state: tauri::State<'_, SharedHost>,
    image_id: String,
) -> Result<String, String> {
    let path = history_image_path(&state, &image_id)?;
    let path_str = path.to_string_lossy().to_string();
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    {
        if let Ok(mut clipboard) = arboard::Clipboard::new() {
            let _ = clipboard.set_text(path_str.clone());
        }
    }
    Ok(path_str)
}

#[tauri::command]
pub(crate) fn toggle_pin_image(
    state: tauri::State<'_, SharedHost>,
    image_id: String,
) -> Result<bool, String> {
    let mut host = state.lock().map_err(text_err)?;
    let id = ImageId::parse(image_id).map_err(text_err)?;
    toggle_pin(&mut host.store, &id).map_err(text_err)
}

#[tauri::command]
pub(crate) fn start_file_drag(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, SharedHost>,
    image_id: String,
) -> Result<(), String> {
    let path = history_image_path(&state, &image_id)?;
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        crate::adapters::start_native_file_drag(&window, &path).map_err(text_err)?;
    }
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = (window, path);
    }
    Ok(())
}

fn history_image_path(
    state: &tauri::State<'_, SharedHost>,
    image_id: &str,
) -> Result<std::path::PathBuf, String> {
    let host = state.lock().map_err(text_err)?;
    let id = ImageId::parse(image_id).map_err(text_err)?;
    let batches = host.store.list_batches().map_err(text_err)?;
    let file_name = batches
        .iter()
        .flat_map(|batch| batch.images.iter())
        .find(|image| image.id == id)
        .map(|image| image.file_name.clone())
        .ok_or_else(|| HostError::NotFound.to_string())?;
    host.store.image_file(&file_name).map_err(text_err)
}

#[tauri::command]
pub(crate) fn delete_history_image(
    state: tauri::State<'_, SharedHost>,
    image_id: String,
) -> Result<(), String> {
    let mut host = state.lock().map_err(text_err)?;
    let id = ImageId::parse(image_id).map_err(text_err)?;
    delete_image(&mut host.store, &id).map_err(text_err)
}

#[tauri::command]
pub(crate) fn delete_history(state: tauri::State<'_, SharedHost>) -> Result<(), String> {
    let mut host = state.lock().map_err(text_err)?;
    delete_all(&mut host.store).map_err(text_err)
}

#[tauri::command]
pub(crate) fn get_settings(
    state: tauri::State<'_, SharedHost>,
) -> Result<crate::domain::Settings, String> {
    let host = state.lock().map_err(text_err)?;
    host.store.load_settings().map_err(text_err)
}

#[tauri::command]
pub(crate) fn update_host_settings(
    state: tauri::State<'_, SharedHost>,
    patch: String,
) -> Result<crate::domain::Settings, String> {
    let mut host = state.lock().map_err(text_err)?;
    let updated = update_settings(&mut host.store, &patch, chrono::Utc::now()).map_err(text_err)?;
    crate::adapters::set_os_auto_start(updated.auto_start_with_os);
    Ok(updated)
}

#[tauri::command]
pub(crate) fn phone_identity(
    state: tauri::State<'_, SharedHost>,
) -> Result<PhoneIdentityView, String> {
    let host = state.lock().map_err(text_err)?;
    Ok(PhoneIdentityView {
        device_id: host.phone.device_id.as_str().to_string(),
        name: host.phone.name.clone(),
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PhoneIdentityView {
    device_id: String,
    name: String,
}

#[tauri::command]
pub(crate) fn set_phone_name(
    state: tauri::State<'_, SharedHost>,
    name: String,
) -> Result<(), String> {
    let mut host = state.lock().map_err(text_err)?;
    host.set_phone_name(&name).map_err(text_err)
}

#[tauri::command]
pub(crate) fn list_known_pcs(
    state: tauri::State<'_, SharedHost>,
) -> Result<Vec<DestinationView>, String> {
    let host = state.lock().map_err(text_err)?;
    Ok(host
        .known_pcs
        .iter()
        .map(|pc| DestinationView {
            pc_id: pc.pc_id.as_str().to_string(),
            name: pc.name.clone(),
            online: false,
        })
        .collect())
}

#[tauri::command]
pub(crate) fn forget_pc(state: tauri::State<'_, SharedHost>, pc_id: String) -> Result<(), String> {
    let mut host = state.lock().map_err(text_err)?;
    let id = PcId::parse(pc_id).map_err(text_err)?;
    host.known_pcs.retain(|pc| pc.pc_id != id);
    host.save_phone_book().map_err(text_err)
}

#[tauri::command]
pub(crate) async fn pair_with_qr(
    state: tauri::State<'_, SharedHost>,
    payload: String,
) -> Result<PairView, String> {
    let (device_id, name) = {
        let host = state.lock().map_err(text_err)?;
        (host.phone.device_id.clone(), host.phone.name.clone())
    };
    let (qr, reply) = phone_client::pair(&payload, &device_id, &name)
        .await
        .map_err(text_err)?;
    save_paired_pc(&state, qr, reply)
}

#[tauri::command]
pub(crate) async fn pair_with_code(
    state: tauri::State<'_, SharedHost>,
    code: String,
    address: Option<String>,
) -> Result<PairView, String> {
    let trimmed_code = code.trim().to_string();
    if trimmed_code.len() != 6 || !trimmed_code.chars().all(|c| c.is_ascii_digit()) {
        return Err(HostError::PairingExpired.to_string());
    }
    let (device_id, name) = {
        let host = state.lock().map_err(text_err)?;
        (host.phone.device_id.clone(), host.phone.name.clone())
    };
    let manual = address
        .map(|val| val.trim().to_string())
        .filter(|val| !val.is_empty());
    if let Some(addr) = manual {
        let (host_str, port) = parse_host_port(&addr).map_err(text_err)?;
        let (qr, reply) = phone_client::pair_with_code_endpoint(
            &host_str,
            port,
            None,
            &trimmed_code,
            &device_id,
            &name,
        )
        .await
        .map_err(text_err)?;
        return save_paired_pc(&state, qr, reply);
    }

    let discovered =
        tokio::task::spawn_blocking(|| crate::adapters::browse_hosts(Duration::from_millis(900)))
            .await
            .unwrap_or_default();
    if discovered.is_empty() {
        return Err(HostError::MulticastFiltered.to_string());
    }
    let mut last_error = HostError::Unreachable;
    for candidate in discovered {
        let fp = (!candidate.fingerprint.is_empty()).then_some(candidate.fingerprint.as_str());
        match phone_client::pair_with_code_endpoint(
            &candidate.host,
            candidate.port,
            fp,
            &trimmed_code,
            &device_id,
            &name,
        )
        .await
        {
            Ok((qr, reply)) => return save_paired_pc(&state, qr, reply),
            Err(error) => last_error = error,
        }
    }
    Err(last_error.to_string())
}

#[tauri::command]
pub(crate) async fn discover_nearby_pcs(
    state: tauri::State<'_, SharedHost>,
) -> Result<Vec<NearbyPcView>, String> {
    let discovered =
        tokio::task::spawn_blocking(|| crate::adapters::browse_hosts(Duration::from_millis(800)))
            .await
            .unwrap_or_default();
    let known = {
        let mut host = state.lock().map_err(text_err)?;
        if host.apply_discovered_hosts(&discovered) {
            let _ = host.save_phone_book();
        }
        host.known_pcs.clone()
    };
    Ok(discovered
        .into_iter()
        .map(|item| {
            let paired = known
                .iter()
                .any(|pc| pc.pc_id.as_str() == item.pc_id && pc.secret.is_some());
            NearbyPcView {
                pc_id: item.pc_id,
                name: item.name,
                host: item.host,
                port: item.port,
                paired,
            }
        })
        .collect())
}

fn parse_host_port(input: &str) -> Result<(String, u16), HostError> {
    let trimmed = input
        .trim()
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .trim_end_matches('/');
    if let Some((host, port_str)) = trimmed.rsplit_once(':') {
        let port: u16 = port_str.parse().map_err(|_| HostError::Unreachable)?;
        crate::domain::require_lan_host(host.trim())?;
        return Ok((host.trim().to_string(), port));
    }
    crate::domain::require_lan_host(trimmed)?;
    Ok((trimmed.to_string(), 47654))
}

fn save_paired_pc(
    state: &tauri::State<'_, SharedHost>,
    qr: crate::domain::QrPayload,
    reply: phone_client::PairReply,
) -> Result<PairView, String> {
    let mut host = state.lock().map_err(text_err)?;
    let pc_id = PcId::parse(&qr.pc_id).map_err(text_err)?;
    let previous_secret = host
        .known_pcs
        .iter()
        .find(|pc| pc.pc_id == pc_id)
        .and_then(|pc| pc.secret.clone());
    let resolved_secret = if reply.status == "trusted" {
        reply.secret.clone().or(previous_secret)
    } else {
        None
    };
    let status = if reply.status == "trusted" && resolved_secret.is_none() {
        "needs_forget".to_string()
    } else {
        reply.status
    };
    host.known_pcs.retain(|pc| pc.pc_id != pc_id);
    if status != "needs_forget" {
        host.known_pcs.insert(
            0,
            crate::runtime::KnownPc {
                pc_id,
                name: qr.name.clone(),
                host: qr.host.clone(),
                port: qr.port,
                fingerprint: qr.fingerprint.clone(),
                cert_der: qr.cert_der.clone(),
                secret: resolved_secret,
                poll_token: if status == "pending" {
                    reply.poll_token.clone()
                } else {
                    None
                },
            },
        );
    }
    host.save_phone_book().map_err(text_err)?;
    Ok(PairView { status })
}

#[tauri::command]
pub(crate) async fn poll_pair(
    state: tauri::State<'_, SharedHost>,
    pc_id: String,
) -> Result<PairView, String> {
    let (device_id, qr, poll_token) = {
        let host = state.lock().map_err(text_err)?;
        let id = PcId::parse(pc_id).map_err(text_err)?;
        let pc = host
            .known_pcs
            .iter()
            .find(|pc| pc.pc_id == id)
            .ok_or_else(|| HostError::NotFound.to_string())?;
        let poll_token = pc
            .poll_token
            .clone()
            .ok_or_else(|| HostError::NotTrusted.to_string())?;
        let qr = remembered_qr(
            &pc.pc_id,
            &pc.name,
            &pc.host,
            pc.port,
            &pc.fingerprint,
            &pc.cert_der,
        );
        (host.phone.device_id.clone(), qr, poll_token)
    };
    let reply = phone_client::pair_status(&qr, &device_id, &poll_token)
        .await
        .map_err(text_err)?;
    let mut host = state.lock().map_err(text_err)?;
    if let Some(pc) = host
        .known_pcs
        .iter_mut()
        .find(|pc| pc.pc_id.as_str() == qr.pc_id)
    {
        if reply.status == "trusted" {
            pc.secret = reply.secret.clone();
            pc.poll_token = None;
        } else if reply.status == "rejected" {
            pc.secret = None;
            pc.poll_token = None;
        }
    }
    host.save_phone_book().map_err(text_err)?;
    Ok(PairView {
        status: reply.status,
    })
}

#[tauri::command]
pub(crate) async fn discover_destinations(
    state: tauri::State<'_, SharedHost>,
) -> Result<Vec<DestinationView>, String> {
    let discovered =
        tokio::task::spawn_blocking(|| crate::adapters::browse_hosts(Duration::from_millis(700)))
            .await
            .unwrap_or_default();
    let pcs = {
        let mut host = state.lock().map_err(text_err)?;
        if host.apply_discovered_hosts(&discovered) {
            let _ = host.save_phone_book();
        }
        host.known_pcs.clone()
    };
    let mut views = Vec::new();
    for pc in pcs {
        let qr = remembered_qr(
            &pc.pc_id,
            &pc.name,
            &pc.host,
            pc.port,
            &pc.fingerprint,
            &pc.cert_der,
        );
        let online = phone_client::ready(&qr).await;
        views.push(DestinationView {
            pc_id: pc.pc_id.as_str().to_string(),
            name: pc.name,
            online,
        });
    }
    Ok(views)
}

#[tauri::command]
pub(crate) async fn send_batch(
    state: tauri::State<'_, SharedHost>,
    pc_id: String,
    batch_id: String,
    images: Vec<String>,
) -> Result<(), String> {
    if images.is_empty() {
        return Err(HostError::ImageUndecodable.to_string());
    }
    let parsed_batch_id = BatchId::parse(batch_id).map_err(text_err)?;
    let mut cleaned = Vec::with_capacity(images.len());
    for image in images {
        let trimmed = image.trim();
        if trimmed.is_empty() {
            return Err(HostError::ImageUndecodable.to_string());
        }
        let approx_bytes = (trimmed.len() * 3) / 4;
        if approx_bytes > MAX_IMAGE_BYTES {
            return Err(HostError::ImageTooLarge.to_string());
        }
        cleaned.push(trimmed.to_string());
    }
    let id = PcId::parse(pc_id).map_err(text_err)?;
    let (device_id, secret, qr) = {
        let host = state.lock().map_err(text_err)?;
        let pc = host
            .known_pcs
            .iter()
            .find(|pc| pc.pc_id == id)
            .ok_or_else(|| HostError::NotFound.to_string())?;
        let secret = pc
            .secret
            .clone()
            .ok_or_else(|| HostError::NotTrusted.to_string())?;
        let qr = remembered_qr(
            &pc.pc_id,
            &pc.name,
            &pc.host,
            pc.port,
            &pc.fingerprint,
            &pc.cert_der,
        );
        (host.phone.device_id.clone(), secret, qr)
    };

    match phone_client::send_batch(&qr, &device_id, &secret, &parsed_batch_id, &cleaned).await {
        Ok(()) => Ok(()),
        Err(
            first_err @ (HostError::Unreachable
            | HostError::DifferentSubnet { .. }
            | HostError::GuestWifiOrFirewall),
        ) => {
            let discovered = tokio::task::spawn_blocking(|| {
                crate::adapters::browse_hosts(Duration::from_millis(700))
            })
            .await
            .unwrap_or_default();
            let updated_qr = {
                let mut host = state.lock().map_err(text_err)?;
                if !host.apply_discovered_hosts(&discovered) {
                    return Err(first_err.to_string());
                }
                let _ = host.save_phone_book();
                let pc = host
                    .known_pcs
                    .iter()
                    .find(|pc| pc.pc_id == id)
                    .ok_or_else(|| HostError::NotFound.to_string())?;
                remembered_qr(
                    &pc.pc_id,
                    &pc.name,
                    &pc.host,
                    pc.port,
                    &pc.fingerprint,
                    &pc.cert_der,
                )
            };
            phone_client::send_batch(&updated_qr, &device_id, &secret, &parsed_batch_id, &cleaned)
                .await
                .map_err(text_err)
        }
        Err(other_err) => Err(other_err.to_string()),
    }
}

#[tauri::command]
pub(crate) fn take_shared_images(
    state: tauri::State<'_, SharedHost>,
) -> Result<Vec<String>, String> {
    let inbox = shared_inbox(&state)?;
    let images = crate::adapters::shared_images::take_inbox(&inbox).map_err(text_err)?;
    Ok(images
        .into_iter()
        .map(|bytes| base64::engine::general_purpose::STANDARD.encode(bytes))
        .collect())
}

fn shared_inbox(state: &SharedHost) -> Result<std::path::PathBuf, String> {
    if let Some(group) = app_group_dir() {
        return Ok(group.join("incoming"));
    }
    let host = state.lock().map_err(text_err)?;
    Ok(host.data_dir.join("incoming"))
}

fn app_group_dir() -> Option<std::path::PathBuf> {
    crate::adapters::shared_images::ios_app_group(APP_GROUP)
}

pub fn invoke_handler() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        surface,
        start_drag,
        get_window_prefs,
        set_window_prefs,
        toggle_dock_expanded,
        slide_docked,
        undock_and_drag,
        quit_app,
        host_status,
        lan_info,
        list_phones,
        accept_phone,
        reject_phone,
        forget_phone,
        list_history,
        get_history_image,
        copy_history_image,
        open_history_image,
        reveal_history_image,
        copy_history_image_path,
        toggle_pin_image,
        start_file_drag,
        delete_history_image,
        delete_history,
        get_settings,
        update_host_settings,
        phone_identity,
        set_phone_name,
        list_known_pcs,
        forget_pc,
        pair_with_qr,
        pair_with_code,
        discover_nearby_pcs,
        allow_firewall,
        poll_pair,
        discover_destinations,
        send_batch,
        take_shared_images,
    ]
}

fn phone_view(phone: &crate::domain::PhoneRecord) -> PhoneView {
    let trust = match phone.trust {
        DeviceTrust::Unknown => "unknown",
        DeviceTrust::PendingAcceptance => "pending",
        DeviceTrust::Trusted => "trusted",
        DeviceTrust::Forgotten => "forgotten",
    };
    PhoneView {
        id: phone.id.as_str().to_string(),
        name: phone.name.clone(),
        trust: trust.to_string(),
    }
}
