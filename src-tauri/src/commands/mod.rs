pub(crate) mod image_protocol;

use std::time::Duration;

use base64::Engine;
use serde::Serialize;
use tauri_plugin_opener::OpenerExt;

use crate::adapters::keys::{decode_public_key, KeyPair};
use crate::adapters::phone_client::{self, remembered_qr};
use crate::domain::{
    parse_qr, validate_text, BatchId, DeviceId, DeviceTrust, HostError, ImageId, PcId, QrPayload,
    TextId, MAX_IMAGE_BYTES,
};
use crate::ports::{Clipboard, Store};
use crate::runtime::{qr_png, DockEdge, SharedHost, WindowPrefs};
use crate::use_cases::{
    accept_device, copy_image, delete_all, delete_image, delete_text, forget_device, reject_device,
    toggle_pin, update_settings,
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
    /// Six digits to compare with the phone's screen, when it asked without a QR code.
    sas: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HostStatus {
    ready: bool,
    pc_name: String,
    retention_days: u32,
    qr_png_base64: String,
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
    /// File size in bytes, 0 when the file cannot be read.
    size: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TextView {
    id: String,
    /// First characters only; the full text comes from `get_history_text`.
    preview: String,
    pinned: bool,
    sensitive: Option<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BatchView {
    id: String,
    phone_name: String,
    received_at: String,
    images: Vec<ImageView>,
    texts: Vec<TextView>,
}

const TEXT_PREVIEW_CHARS: usize = 600;

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
    /// Six digits to compare with the computer's screen while waiting.
    sas: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RelayView {
    url: Option<String>,
    has_token: bool,
    status: crate::runtime::RelayStatus,
}

fn relay_view(host: &crate::runtime::HostInner) -> RelayView {
    RelayView {
        url: host.relay.as_ref().map(|relay| relay.url.clone()),
        has_token: host.relay.as_ref().is_some_and(|relay| relay.token.is_some()),
        status: host.relay_status.clone(),
    }
}

/// Sends a probe to this computer through its own relay and reports how long it took.
#[tauri::command]
pub(crate) async fn test_relay(state: tauri::State<'_, SharedHost>) -> Result<u64, String> {
    let (info, public_key) = {
        let host = state.lock().map_err(text_err)?;
        let info = host
            .relay
            .clone()
            .ok_or_else(|| HostError::InvalidRelay.to_string())?;
        (info, host.keys.public.clone())
    };
    phone_client::test_relay(&info, &public_key)
        .await
        .map(|ms| ms as u64)
        .map_err(text_err)
}

#[tauri::command]
pub(crate) async fn get_relay(state: tauri::State<'_, SharedHost>) -> Result<RelayView, String> {
    let host = state.lock().map_err(text_err)?;
    Ok(relay_view(&host))
}

/// Saves the relay string the admin pasted (empty text removes the relay) and reconnects.
#[tauri::command]
pub(crate) fn set_relay(
    state: tauri::State<'_, SharedHost>,
    app: tauri::AppHandle,
    text: String,
) -> Result<RelayView, String> {
    let trimmed = text.trim();
    let info = if trimmed.is_empty() {
        None
    } else {
        Some(crate::domain::RelayInfo::parse(trimmed).map_err(text_err)?)
    };
    {
        let mut host = state.lock().map_err(text_err)?;
        let path = host.data_dir.join("relay.json");
        match &info {
            Some(info) => {
                let json = serde_json::to_string(info).map_err(|error| error.to_string())?;
                crate::adapters::write_private_bytes(&path, json.as_bytes()).map_err(text_err)?;
            }
            None => {
                let _ = std::fs::remove_file(&path);
            }
        }
        host.relay = info.clone();
        host.relay_generation += 1;
        host.relay_status = crate::runtime::RelayStatus::Off;
    }
    if info.is_some() && !cfg!(any(target_os = "android", target_os = "ios")) {
        crate::runtime::spawn_relay(state.inner().clone(), app);
    }
    let host = state.lock().map_err(text_err)?;
    Ok(relay_view(&host))
}

/// Clipboard text on iOS, read natively so no WebKit "Paste" bubble appears; None elsewhere.
/// Synchronous on purpose: UIKit wants the main thread, where sync commands run.
#[tauri::command]
pub(crate) fn read_phone_clipboard() -> Option<String> {
    crate::adapters::phone_clipboard::read_text()
}

/// The Wi-Fi network name on iOS; `None` elsewhere or without permission (Android asks Kotlin).
#[tauri::command]
pub(crate) fn wifi_name() -> Option<String> {
    crate::adapters::wifi::wifi_name()
}

#[tauri::command]
pub(crate) fn request_wifi_permission(app: tauri::AppHandle) -> Result<(), String> {
    // CoreLocation must be driven from the main thread.
    app.run_on_main_thread(crate::adapters::wifi::request_wifi_permission)
        .map_err(|error| error.to_string())
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
    set_dock_expanded(&window, &state, None)
}

/// `h` in the app: tuck the window into the nearest screen edge, collapsed to its tab.
#[tauri::command]
pub(crate) fn hide_to_edge(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, SharedHost>,
) -> Result<WindowPrefs, String> {
    let mut prefs = state.lock().map_err(text_err)?.window_prefs.clone();
    if prefs.dock_edge.is_some() {
        return set_dock_expanded(&window, &state, Some(false));
    }
    let pos = window.outer_position().map_err(|error| error.to_string())?;
    let size = window.outer_size().map_err(|error| error.to_string())?;
    let monitor = window
        .current_monitor()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "no monitor".to_string())?;
    let work = monitor.work_area();
    let left = pos.x - work.position.x;
    let right = work.position.x + work.size.width as i32 - (pos.x + size.width as i32);
    let edge = if left <= right { DockEdge::Left } else { DockEdge::Right };
    prefs.snap_to_edge = true;
    prefs.dock_edge = Some(edge);
    prefs.dock_expanded = false;
    prefs.dock_x = pos.x;
    prefs.dock_y = pos.y;
    set_window_always_on_top(&window, true);
    apply_dock_geometry(&window, edge, false, pos.x, pos.y);
    state.lock().map_err(text_err)?.window_prefs = prefs.clone();
    let _ = window.emit("dock-state", &prefs);
    Ok(prefs)
}

/// The global shortcut: bring Fast Share up, or put it away when it is already in front.
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub(crate) fn summon_or_hide(app: &tauri::AppHandle) {
    use tauri::Manager;
    let (Some(window), Some(state)) = (
        app.get_webview_window("main"),
        app.try_state::<SharedHost>(),
    ) else {
        return;
    };
    let Ok(prefs) = state.lock().map(|host| host.window_prefs.clone()) else {
        return;
    };
    let in_front = window.is_visible().unwrap_or(false)
        && !window.is_minimized().unwrap_or(false)
        && window.is_focused().unwrap_or(false);
    let open = prefs.dock_edge.is_none() || prefs.dock_expanded;
    if in_front && open {
        if prefs.dock_edge.is_some() {
            let _ = set_dock_expanded(&window, &state, Some(false));
        } else {
            let _ = window.hide();
        }
        return;
    }
    let _ = window.show();
    let _ = window.unminimize();
    if prefs.dock_edge.is_some() && !prefs.dock_expanded {
        let _ = set_dock_expanded(&window, &state, Some(true));
    }
    let _ = window.set_focus();
}

/// Opens the full-screen preview on the monitor the app is on; `ids` is the list to step through.
/// Must stay `async`: building a window inside a synchronous command deadlocks on Windows
/// (the new window stays white and the whole app freezes).
#[tauri::command]
pub(crate) async fn open_preview(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    ids: Vec<String>,
    index: usize,
) -> Result<(), String> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = (app, window, ids, index);
        Ok(())
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    open_preview_window(app, window, ids, index)
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn open_preview_window(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    ids: Vec<String>,
    index: usize,
) -> Result<(), String> {
    use tauri::Manager;
    let payload = serde_json::json!({ "ids": ids, "index": index });
    if let Some(existing) = app.get_webview_window("preview") {
        let _ = existing.emit_to("preview", "preview-open", &payload);
        let _ = existing.show();
        let _ = existing.set_focus();
        return Ok(());
    }
    let mut builder = tauri::WebviewWindowBuilder::new(&app, "preview", tauri::WebviewUrl::default())
        .title("Fast Share preview")
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(true)
        .initialization_script(format!("window.__FS_PREVIEW__ = {payload};"));
    if let Ok(Some(monitor)) = window.current_monitor() {
        let scale = monitor.scale_factor();
        let at = monitor.position();
        let size = monitor.size();
        builder = builder
            .position(f64::from(at.x) / scale, f64::from(at.y) / scale)
            .inner_size(f64::from(size.width) / scale, f64::from(size.height) / scale);
    }
    builder.build().map_err(|error| error.to_string())?;
    Ok(())
}

fn set_dock_expanded(
    window: &tauri::WebviewWindow,
    state: &SharedHost,
    expanded: Option<bool>,
) -> Result<WindowPrefs, String> {
    let mut prefs = {
        let host = state.lock().map_err(text_err)?;
        host.window_prefs.clone()
    };
    let Some(edge) = prefs.dock_edge else {
        return Ok(prefs);
    };
    prefs.dock_expanded = expanded.unwrap_or(!prefs.dock_expanded);
    apply_dock_geometry(
        window,
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
pub(crate) async fn host_status(state: tauri::State<'_, SharedHost>) -> Result<HostStatus, String> {
    let mut host = state.lock().map_err(text_err)?;
    let settings = host.store.load_settings().map_err(text_err)?;
    let phones = host.store.list_phones().map_err(text_err)?;
    let payload = host.qr_payload().map_err(text_err)?;
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
        lan_address,
        firewall_warning: crate::adapters::firewall_warning(),
        pending,
        trusted_count,
    })
}

#[tauri::command]
pub(crate) async fn lan_info(state: tauri::State<'_, SharedHost>) -> Result<LanInfoView, String> {
    let snapshot = crate::adapters::lan_snapshot();
    let ip = if cfg!(any(target_os = "android", target_os = "ios")) {
        snapshot.ip
    } else {
        // Show the address the listener is actually bound to, not a live probe
        // that can disagree with the socket until the watcher rebinds.
        state.lock().map_err(text_err)?.bind_ip
    };
    Ok(LanInfoView {
        ip: ip.to_string(),
        subnet: crate::adapters::subnet_24(ip),
        addresses: snapshot
            .addresses
            .into_iter()
            .map(|(name, ip)| LanAddressView {
                name,
                ip: ip.to_string(),
            })
            .collect(),
    })
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
pub(crate) async fn list_phones(state: tauri::State<'_, SharedHost>) -> Result<Vec<PhoneView>, String> {
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
pub(crate) async fn list_history(state: tauri::State<'_, SharedHost>) -> Result<Vec<BatchView>, String> {
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
                size: host
                    .store
                    .image_file(&image.file_name)
                    .ok()
                    .and_then(|path| std::fs::metadata(path).ok())
                    .map_or(0, |meta| meta.len()),
            })
            .collect();
        let texts = batch
            .texts
            .into_iter()
            .map(|text| TextView {
                id: text.id.as_str().to_string(),
                preview: text.text.chars().take(TEXT_PREVIEW_CHARS).collect(),
                pinned: text.pinned,
                sensitive: text.sensitive,
            })
            .collect();
        views.push(BatchView {
            id: batch.id.as_str().to_string(),
            phone_name: batch.phone_name,
            received_at: batch.received_at.to_rfc3339(),
            images,
            texts,
        });
    }
    Ok(views)
}

fn full_text(store: &impl Store, text_id: String) -> Result<String, String> {
    let id = TextId::parse(text_id).map_err(text_err)?;
    store
        .list_batches()
        .map_err(text_err)?
        .into_iter()
        .flat_map(|batch| batch.texts.into_iter())
        .find(|text| text.id == id)
        .map(|text| text.text)
        .ok_or_else(|| HostError::NotFound.to_string())
}

#[tauri::command]
pub(crate) fn copy_history_text(
    state: tauri::State<'_, SharedHost>,
    text_id: String,
) -> Result<(), String> {
    let host = state.lock().map_err(text_err)?;
    let text = full_text(&host.store, text_id)?;
    host.clipboard.write_text(&text).map_err(text_err)
}

#[tauri::command]
pub(crate) fn get_history_text(
    state: tauri::State<'_, SharedHost>,
    text_id: String,
) -> Result<String, String> {
    let host = state.lock().map_err(text_err)?;
    full_text(&host.store, text_id)
}

#[tauri::command]
pub(crate) fn toggle_pin_text(
    state: tauri::State<'_, SharedHost>,
    text_id: String,
) -> Result<bool, String> {
    let mut host = state.lock().map_err(text_err)?;
    let id = TextId::parse(text_id).map_err(text_err)?;
    crate::use_cases::toggle_pin_text(&mut host.store, &id).map_err(text_err)
}

#[tauri::command]
pub(crate) fn set_text_sensitive(
    state: tauri::State<'_, SharedHost>,
    text_id: String,
    sensitive: Option<bool>,
) -> Result<(), String> {
    let mut host = state.lock().map_err(text_err)?;
    let id = TextId::parse(text_id).map_err(text_err)?;
    crate::use_cases::set_text_sensitive(&mut host.store, &id, sensitive).map_err(text_err)
}

#[tauri::command]
pub(crate) fn delete_history_text(
    state: tauri::State<'_, SharedHost>,
    text_id: String,
) -> Result<(), String> {
    let mut host = state.lock().map_err(text_err)?;
    let id = TextId::parse(text_id).map_err(text_err)?;
    delete_text(&mut host.store, &id).map_err(text_err)
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
    let qr = parse_qr(&payload).map_err(text_err)?;
    let token = Some(qr.token.clone());
    start_pairing(state.inner().clone(), qr, token)
}

/// Connects to a computer without a QR code. Either `pc_id` of a computer found on the Wi-Fi, or
/// a typed `address`. The computer is not authenticated yet: the user compares the six digits.
#[tauri::command]
pub(crate) async fn pair_nearby(
    state: tauri::State<'_, SharedHost>,
    pc_id: Option<String>,
    address: Option<String>,
) -> Result<PairView, String> {
    let manual = address
        .map(|val| val.trim().to_string())
        .filter(|val| !val.is_empty());
    let dest = if let Some(addr) = manual {
        let (host, port) = parse_host_port(&addr).map_err(text_err)?;
        let identity = phone_client::fetch_identity(&host, port)
            .await
            .map_err(text_err)?;
        let id = PcId::parse(&identity.pc_id).map_err(text_err)?;
        remembered_qr(&id, &identity.name, &host, port, &identity.fingerprint, &identity.pub_key)
    } else {
        let wanted = PcId::parse(pc_id.ok_or_else(|| HostError::NotFound.to_string())?)
            .map_err(text_err)?;
        let discovered = tokio::task::spawn_blocking(|| {
            crate::adapters::browse_hosts(Duration::from_millis(900))
        })
        .await
        .unwrap_or_default();
        if discovered.is_empty() {
            return Err(HostError::MulticastFiltered.to_string());
        }
        let found = discovered
            .into_iter()
            .find(|item| item.pc_id == wanted.as_str())
            .ok_or_else(|| HostError::Unreachable.to_string())?;
        remembered_qr(
            &wanted,
            &found.name,
            &found.host,
            found.port,
            &found.fingerprint,
            &found.public_key,
        )
    };
    decode_public_key(&dest.pub_key).map_err(text_err)?;
    start_pairing(state.inner().clone(), dest, None)
}

/// Records the computer as "pending" and runs the handshake in the background, because the user
/// on the computer can take up to two minutes. The phone polls `poll_pair`.
fn start_pairing(
    shared: SharedHost,
    dest: QrPayload,
    token: Option<String>,
) -> Result<PairView, String> {
    let pc_id = PcId::parse(&dest.pc_id).map_err(text_err)?;
    let (keys, name) = {
        let mut host = shared.lock().map_err(text_err)?;
        host.known_pcs.retain(|pc| pc.pc_id != pc_id);
        host.known_pcs.insert(
            0,
            crate::runtime::KnownPc {
                pc_id: pc_id.clone(),
                name: dest.name.clone(),
                host: dest.host.clone(),
                port: dest.port,
                fingerprint: dest.fingerprint.clone(),
                public_key: None,
                pending: true,
                sas: None,
                failure: None,
                relay: dest.relay.clone(),
            },
        );
        host.save_phone_book().map_err(text_err)?;
        (host.keys.clone(), host.phone.name.clone())
    };
    tauri::async_runtime::spawn(async move {
        let on_code = {
            let (shared, pc_id) = (shared.clone(), pc_id.clone());
            move |code: String| update_known_pc(&shared, &pc_id, |pc| pc.sas = Some(code))
        };
        let outcome = phone_client::pair(&dest, &keys, &name, token, on_code).await;
        update_known_pc(&shared, &pc_id, |pc| {
            pc.pending = false;
            pc.sas = None;
            match &outcome {
                Ok(done) if done.accepted => {
                    pc.public_key = Some(dest.pub_key.clone());
                    // The computer's own word about its relay wins over what the QR said.
                    if done.relay.is_some() {
                        pc.relay = done.relay.clone();
                    }
                }
                Ok(_) => {}
                Err(error) => pc.failure = Some(error.to_string()),
            }
        });
    });
    Ok(PairView {
        status: "pending".to_string(),
        sas: None,
    })
}

fn update_known_pc(
    shared: &SharedHost,
    pc_id: &PcId,
    change: impl FnOnce(&mut crate::runtime::KnownPc),
) {
    if let Ok(mut host) = shared.lock() {
        if let Some(pc) = host.known_pcs.iter_mut().find(|pc| &pc.pc_id == pc_id) {
            change(pc);
        }
        let _ = host.save_phone_book();
    }
}

#[tauri::command]
pub(crate) fn poll_pair(
    state: tauri::State<'_, SharedHost>,
    pc_id: String,
) -> Result<PairView, String> {
    let id = PcId::parse(pc_id).map_err(text_err)?;
    let mut host = state.lock().map_err(text_err)?;
    let pc = host
        .known_pcs
        .iter()
        .find(|pc| pc.pc_id == id)
        .ok_or_else(|| HostError::NotFound.to_string())?;
    if pc.public_key.is_some() {
        return Ok(PairView {
            status: "trusted".to_string(),
            sas: None,
        });
    }
    if pc.pending {
        return Ok(PairView {
            status: "pending".to_string(),
            sas: pc.sas.clone(),
        });
    }
    // The attempt is over without a trusted key: report why once, then forget the entry.
    let failure = pc.failure.clone();
    host.known_pcs.retain(|pc| pc.pc_id != id);
    host.save_phone_book().map_err(text_err)?;
    match failure {
        Some(message) => Err(message),
        None => Ok(PairView {
            status: "rejected".to_string(),
            sas: None,
        }),
    }
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
                .any(|pc| pc.pc_id.as_str() == item.pc_id && pc.public_key.is_some());
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

fn known_destination(pc: &crate::runtime::KnownPc) -> Option<QrPayload> {
    let key = pc.public_key.as_deref()?;
    let mut dest = remembered_qr(&pc.pc_id, &pc.name, &pc.host, pc.port, &pc.fingerprint, key);
    dest.relay = pc.relay.clone();
    Some(dest)
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
        let Some(qr) = known_destination(&pc) else {
            continue;
        };
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
    let mut decoded = Vec::with_capacity(images.len());
    for image in images {
        let trimmed = image.trim();
        if trimmed.is_empty() {
            return Err(HostError::ImageUndecodable.to_string());
        }
        let approx_bytes = (trimmed.len() * 3) / 4;
        if approx_bytes > MAX_IMAGE_BYTES {
            return Err(HostError::ImageTooLarge.to_string());
        }
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(trimmed)
            .map_err(|_| HostError::ImageUndecodable.to_string())?;
        decoded.push(bytes);
    }
    let id = PcId::parse(pc_id).map_err(text_err)?;
    let (batch, images) = (&parsed_batch_id, &decoded);
    deliver_to_pc(&state, &id, move |qr, keys, name| async move {
        phone_client::send_batch(&qr, &keys, &name, batch, images).await
    })
    .await
}

#[tauri::command]
pub(crate) async fn send_text(
    state: tauri::State<'_, SharedHost>,
    pc_id: String,
    batch_id: String,
    text: String,
) -> Result<(), String> {
    validate_text(&text).map_err(text_err)?;
    let parsed_batch_id = BatchId::parse(batch_id).map_err(text_err)?;
    let id = PcId::parse(pc_id).map_err(text_err)?;
    let (batch, body) = (&parsed_batch_id, &text);
    deliver_to_pc(&state, &id, move |qr, keys, name| async move {
        phone_client::send_text(&qr, &keys, &name, batch, body).await
    })
    .await
}

/// Looks up the paired computer and runs `send`. On a network failure it re-browses mDNS once
/// (the computer's IP may have changed) and retries with the updated address.
async fn deliver_to_pc<F, Fut>(state: &SharedHost, id: &PcId, send: F) -> Result<(), String>
where
    F: Fn(QrPayload, KeyPair, String) -> Fut,
    Fut: std::future::Future<Output = Result<(), HostError>>,
{
    let (keys, name, qr) = {
        let host = state.lock().map_err(text_err)?;
        let pc = host
            .known_pcs
            .iter()
            .find(|pc| &pc.pc_id == id)
            .ok_or_else(|| HostError::NotFound.to_string())?;
        let qr = known_destination(pc).ok_or_else(|| HostError::NotTrusted.to_string())?;
        (host.keys.clone(), host.phone.name.clone(), qr)
    };

    match send(qr, keys.clone(), name.clone()).await {
        Ok(()) => Ok(()),
        Err(
            first_err @ (HostError::Unreachable
            | HostError::NoServer { .. }
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
                    .find(|pc| &pc.pc_id == id)
                    .ok_or_else(|| HostError::NotFound.to_string())?;
                known_destination(pc).ok_or_else(|| HostError::NotTrusted.to_string())?
            };
            send(updated_qr, keys, name).await.map_err(text_err)
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
        wifi_name,
        read_phone_clipboard,
        request_wifi_permission,
        start_drag,
        get_window_prefs,
        set_window_prefs,
        toggle_dock_expanded,
        hide_to_edge,
        open_preview,
        slide_docked,
        undock_and_drag,
        quit_app,
        host_status,
        get_relay,
        set_relay,
        test_relay,
        lan_info,
        list_phones,
        accept_phone,
        reject_phone,
        forget_phone,
        list_history,
        get_history_image,
        copy_history_image,
        copy_history_text,
        get_history_text,
        toggle_pin_text,
        set_text_sensitive,
        delete_history_text,
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
        pair_nearby,
        discover_nearby_pcs,
        allow_firewall,
        poll_pair,
        discover_destinations,
        send_batch,
        send_text,
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
        sas: phone.sas.clone(),
    }
}
