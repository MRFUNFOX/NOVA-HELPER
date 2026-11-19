//! Меню поверх игры (утверждено 19.11.2026, образец — прототип в Claude Design).
//!
//! Одна клавиша вызова: если впереди GTA — поверх неё появляется прозрачный слой во весь
//! монитор игры («game.html») с горизонтальным меню и окнами разделов; вне игры та же клавиша
//! открывает обычное окно программы. Слой ловит мышь и клавиатуру, пока открыт; при скрытии
//! фокус возвращается в игру. Раскладка (где меню, где и какого размера окна, прозрачность)
//! хранится в gamemenu.json рядом с настройками.
//!
//! Открыто всем с 0.7.2.

use crate::settings;
use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicIsize, Ordering};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// Открыто ли всем игрокам. Пока `false` — только в режиме разработчика.
pub const PUBLIC: bool = true;
const LABEL: &str = "game";
/// Окно, активное до открытия меню (игра), — вернём ему фокус
static PREVIOUS: AtomicIsize = AtomicIsize::new(0);

pub fn enabled(app: &AppHandle) -> bool {
    PUBLIC || settings::load(app).dev_mode
}

#[cfg(windows)]
mod win {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, IsWindow, SetForegroundWindow};
    pub fn foreground() -> isize {
        unsafe { GetForegroundWindow().0 as isize }
    }
    pub fn activate(h: isize) {
        if h == 0 {
            return;
        }
        unsafe {
            let hwnd = HWND(h as *mut core::ffi::c_void);
            if IsWindow(Some(hwnd)).as_bool() {
                let _ = SetForegroundWindow(hwnd);
            }
        }
    }
}

#[cfg(not(windows))]
mod win {
    pub fn foreground() -> isize {
        0
    }
    pub fn activate(_h: isize) {}
}

fn layer(app: &AppHandle) -> Option<WebviewWindow> {
    if let Some(w) = app.get_webview_window(LABEL) {
        return Some(w);
    }
    let w = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("game.html".into()))
        .title("NOVA HELPER — меню в игре")
        .transparent(true)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .shadow(false)
        .visible(false)
        .build()
        .ok()?;
    crate::pins::cover(&w);
    Some(w)
}

/// Создать слой заранее (скрытым), чтобы меню открывалось сразу, без загрузки
pub fn prepare(app: &AppHandle) {
    if enabled(app) {
        let _ = layer(app);
    } else if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.destroy();
    }
}

pub fn visible(app: &AppHandle) -> bool {
    app.get_webview_window(LABEL).is_some_and(|w| w.is_visible().unwrap_or(false))
}

pub fn show(app: &AppHandle) {
    let Some(w) = layer(app) else { return };
    let fg = win::foreground();
    if fg != 0 && fg != crate::pins::hwnd_of(&w) {
        PREVIOUS.store(fg, Ordering::Relaxed);
    }
    crate::pins::cover(&w);
    let _ = w.show();
    // Выше слоя закреплённых окон и подсказки
    crate::pins::raise_window(&w);
    let _ = w.set_focus();
    let _ = w.emit("game-menu-shown", ());
}

pub fn hide(app: &AppHandle) {
    let Some(w) = app.get_webview_window(LABEL) else { return };
    if !w.is_visible().unwrap_or(false) {
        return;
    }
    let _ = w.hide();
    win::activate(PREVIOUS.swap(0, Ordering::Relaxed));
}

/// Клавиша вызова в игре: открыть или спрятать меню
pub fn toggle(app: &AppHandle) {
    if visible(app) {
        hide(app);
    } else {
        // Обычное окно программы поверх игры не нужно, когда открыто меню
        if let Some(m) = app.get_webview_window("main").filter(|m| m.is_visible().unwrap_or(false)) {
            let _ = m.hide();
        }
        show(app);
    }
}

fn path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("gamemenu.json"))
}

#[tauri::command]
pub fn game_menu_layout(app: AppHandle) -> Value {
    path(&app)
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(Value::Null)
}

#[tauri::command]
pub fn game_menu_save(app: AppHandle, layout: Value) -> Result<(), String> {
    let p = path(&app).ok_or("Не найдена папка настроек")?;
    if let Some(dir) = p.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = p.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_vec(&layout).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &p).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn game_menu_hide(app: AppHandle) {
    hide(&app);
}
