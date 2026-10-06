mod adapters;
mod commands;
mod domain;
mod ports;
mod runtime;
mod use_cases;

#[cfg(not(any(target_os = "ios", target_os = "android")))]
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            runtime::start(app.handle().clone()).map_err(|error| -> Box<dyn std::error::Error> {
                std::io::Error::other(error).into()
            })?;
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            {
                let handle = app.handle().clone();
                if let Some(icon) = app.default_window_icon() {
                    let _ = tauri::tray::TrayIconBuilder::new()
                        .icon(icon.clone())
                        .tooltip("Fast Share")
                        .on_tray_icon_event(move |_tray, event| {
                            if let tauri::tray::TrayIconEvent::Click {
                                button: tauri::tray::MouseButton::Left,
                                button_state: tauri::tray::MouseButtonState::Up,
                                ..
                            } = event
                            {
                                if let Some(window) = handle.get_webview_window("main") {
                                    let _ = window.show();
                                    let _ = window.set_focus();
                                }
                            }
                        })
                        .build(app.handle());
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                #[cfg(not(any(target_os = "ios", target_os = "android")))]
                {
                    api.prevent_close();
                    let _ = window.hide();
                }
                #[cfg(any(target_os = "ios", target_os = "android"))]
                {
                    let _ = (api, window);
                }
            }
        })
        .invoke_handler(commands::invoke_handler())
        .run(tauri::generate_context!())
        .expect("error while running Fast Share");
}
