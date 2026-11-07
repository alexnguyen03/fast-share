mod adapters;
mod commands;
mod domain;
mod ports;
mod runtime;
mod use_cases;

#[cfg(not(any(target_os = "ios", target_os = "android")))]
use std::sync::atomic::{AtomicBool, Ordering};

#[cfg(not(any(target_os = "ios", target_os = "android")))]
use tauri::Manager;

#[cfg(not(any(target_os = "ios", target_os = "android")))]
static QUIT: AtomicBool = AtomicBool::new(false);

#[cfg(not(any(target_os = "ios", target_os = "android")))]
static MOVE_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

pub(crate) fn request_quit(app: &tauri::AppHandle) {
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    {
        QUIT.store(true, Ordering::Relaxed);
    }
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            #[cfg(mobile)]
            app.handle().plugin(tauri_plugin_barcode_scanner::init())?;
            runtime::start(app.handle().clone()).map_err(
                |error| -> Box<dyn std::error::Error> { std::io::Error::other(error).into() },
            )?;
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            {
                let open = tauri::menu::MenuItem::with_id(app, "open", "Open", true, None::<&str>)?;
                let exit = tauri::menu::MenuItem::with_id(app, "exit", "Exit", true, None::<&str>)?;
                let menu = tauri::menu::Menu::with_items(app, &[&open, &exit])?;
                if let Some(icon) = app.default_window_icon() {
                    let _ = tauri::tray::TrayIconBuilder::new()
                        .icon(icon.clone())
                        .tooltip("Fast Share")
                        .menu(&menu)
                        .show_menu_on_left_click(false)
                        .on_menu_event(|app, event| {
                            if event.id.as_ref() == "exit" {
                                QUIT.store(true, Ordering::Relaxed);
                                app.exit(0);
                                return;
                            }
                            show_main(app);
                        })
                        .on_tray_icon_event(|tray, event| {
                            if let tauri::tray::TrayIconEvent::Click {
                                button: tauri::tray::MouseButton::Left,
                                button_state: tauri::tray::MouseButtonState::Up,
                                ..
                            } = event
                            {
                                show_main(tray.app_handle());
                            }
                        })
                        .build(app)?;
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                #[cfg(not(any(target_os = "ios", target_os = "android")))]
                {
                    if QUIT.load(Ordering::Relaxed) {
                        return;
                    }
                    let close_to_tray = window
                        .app_handle()
                        .try_state::<runtime::SharedHost>()
                        .and_then(|shared| {
                            shared.lock().ok().and_then(|h| {
                                use crate::ports::Store;
                                h.store.load_settings().ok().map(|s| s.close_to_tray)
                            })
                        })
                        .unwrap_or(true);
                    if close_to_tray {
                        api.prevent_close();
                        let _ = window.hide();
                    } else {
                        QUIT.store(true, Ordering::Relaxed);
                    }
                }
                #[cfg(any(target_os = "ios", target_os = "android"))]
                {
                    let _ = (api, window);
                }
            }
            tauri::WindowEvent::Moved(_) => {
                #[cfg(not(any(target_os = "ios", target_os = "android")))]
                {
                    let seq = MOVE_SEQ.fetch_add(1, Ordering::SeqCst) + 1;
                    let app = window.app_handle().clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_millis(120));
                        while adapters::is_mouse_button_down() {
                            if MOVE_SEQ.load(Ordering::SeqCst) != seq {
                                return;
                            }
                            std::thread::sleep(std::time::Duration::from_millis(40));
                        }
                        std::thread::sleep(std::time::Duration::from_millis(60));
                        if MOVE_SEQ.load(Ordering::SeqCst) != seq {
                            return;
                        }
                        if let (Some(win), Some(shared)) = (
                            app.get_webview_window("main"),
                            app.try_state::<runtime::SharedHost>(),
                        ) {
                            commands::handle_window_moved(&win, &shared);
                        }
                    });
                }
            }
            _ => {}
        })
        .invoke_handler(commands::invoke_handler())
        .run(tauri::generate_context!())
        .expect("error while running Fast Share");
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
