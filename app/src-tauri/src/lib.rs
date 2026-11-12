mod ai;
mod overlay;
mod settings;
mod sync;

use overlay::OverlayState;
use settings::Settings;
use sync::SyncState;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WindowEvent,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

/// Зарегистрировать горячую клавишу. Если сочетание занято другой программой — ошибка с понятным текстом.
fn register_hotkey(app: &AppHandle, hotkey: &str) -> Result<(), String> {
    let gs = app.global_shortcut();
    gs.on_shortcut(hotkey, |app, _shortcut, event| {
        if event.state == ShortcutState::Pressed {
            overlay::toggle(app);
        }
    })
    .map_err(|_| format!("Сочетание «{hotkey}» не подходит или уже занято другой программой. Выберите другое."))
}

#[tauri::command]
fn get_settings(app: AppHandle) -> Settings {
    settings::load(&app)
}

#[tauri::command]
fn save_settings(app: AppHandle, new: Settings) -> Result<Settings, String> {
    let old = settings::load(&app);
    // Клавишу меняем через set_hotkey; здесь сохраняем остальное, не трогая геометрию окна
    let merged = Settings { hotkey: old.hotkey.clone(), window: old.window.clone(), ..new };
    settings::save(&app, &merged)?;
    let _ = app.emit("settings-changed", merged.clone());
    Ok(merged)
}

/// Сменить клавишу вызова. Старая освобождается, только если новая зарегистрировалась.
#[tauri::command]
fn set_hotkey(app: AppHandle, hotkey: String) -> Result<Settings, String> {
    let mut s = settings::load(&app);
    if s.hotkey == hotkey {
        return Ok(s);
    }
    let gs = app.global_shortcut();
    let _ = gs.unregister(s.hotkey.as_str());
    if let Err(e) = register_hotkey(&app, &hotkey) {
        let _ = register_hotkey(&app, &s.hotkey);
        return Err(e);
    }
    s.hotkey = hotkey;
    settings::save(&app, &s)?;
    let _ = app.emit("settings-changed", s.clone());
    Ok(s)
}

/// Временно снять клавишу, пока пользователь записывает новое сочетание в настройках
#[tauri::command]
fn suspend_hotkey(app: AppHandle, suspended: bool) -> Result<(), String> {
    let s = settings::load(&app);
    if suspended {
        app.global_shortcut().unregister(s.hotkey.as_str()).map_err(|e| e.to_string())
    } else {
        register_hotkey(&app, &s.hotkey)
    }
}

#[tauri::command]
fn hide_main(app: AppHandle) {
    let s = settings::load(&app);
    if s.close_to_tray {
        overlay::hide_main(&app);
    } else {
        app.exit(0);
    }
}

#[tauri::command]
fn minimize_main(app: AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.minimize();
        let prev = app.state::<OverlayState>().previous.swap(0, std::sync::atomic::Ordering::Relaxed);
        let _ = prev; // фокус Windows вернёт сам при сворачивании
    }
}

#[tauri::command]
fn finish_first_run(app: AppHandle) -> Result<(), String> {
    let mut s = settings::load(&app);
    s.first_run_done = true;
    settings::save(&app, &s)
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Открыть NOVA HELPER", true, None::<&str>)?;
    let check = MenuItem::with_id(app, "check", "Проверить обновление правил", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &check, &quit])?;
    TrayIconBuilder::with_id("main")
        .tooltip("NOVA HELPER")
        .icon(app.default_window_icon().cloned().expect("иконка программы"))
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, e| match e.id.as_ref() {
            "open" => overlay::show_main(app),
            "check" => {
                overlay::show_main(app);
                let _ = app.emit("check-updates", ());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, e| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                overlay::toggle(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Второй запуск программы просто открывает уже работающую
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| overlay::show_main(app)))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .manage(OverlayState::default())
        .manage(SyncState::default())
        .invoke_handler(tauri::generate_handler![
            sync::db_load,
            sync::db_check,
            sync::db_update,
            get_settings,
            save_settings,
            set_hotkey,
            suspend_hotkey,
            hide_main,
            minimize_main,
            finish_first_run,
            quit_app,
            app_version,
            ai::ai_status,
            ai::ai_set_key,
            ai::ai_clear_key,
            ai::ai_use,
            ai::ai_complete,
            ai::ai_chat,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let s = settings::load(&handle);
            if let Err(e) = register_hotkey(&handle, &s.hotkey) {
                eprintln!("{e}");
            }
            build_tray(&handle)?;
            if let Some(win) = app.get_webview_window("main") {
                overlay::restore_geometry(&handle, &win);
                // Крестик системы (Alt+F4) тоже прячет в трей, если так настроено
                let h = handle.clone();
                win.on_window_event(move |e| {
                    if let WindowEvent::CloseRequested { api, .. } = e {
                        if settings::load(&h).close_to_tray {
                            api.prevent_close();
                            overlay::hide_main(&h);
                        }
                    }
                });
            }
            let minimized = std::env::args().any(|a| a == "--minimized");
            if minimized && s.first_run_done {
                overlay::show_hint(&handle);
            } else {
                overlay::show_main(&handle);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("ошибка запуска NOVA HELPER");
}
