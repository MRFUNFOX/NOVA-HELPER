//! Меню поверх игры (утверждено 19.11.2026, образец — прототип в Claude Design).
//!
//! Одна клавиша вызова: если впереди GTA — поверх неё появляется прозрачный слой во весь
//! монитор игры («game.html») с горизонтальным меню и окнами разделов; вне игры та же клавиша
//! открывает обычное окно программы. Слой ловит мышь и клавиатуру, пока открыт; при скрытии
//! фокус возвращается в игру. Раскладка (где меню, где и какого размера окна, прозрачность)
//! хранится в gamemenu.json рядом с настройками.
//!
//! Открыто всем с 0.7.2.
//!
//! «Закрепить» (булавка рядом с точками меню, с 0.7.3): клавиша, Esc и клик в пустое место
//! не прячут меню, а «отпускают» мышь и клавиатуру в игру — меню и окна остаются на экране,
//! клики проходят сквозь них. Снова управлять меню — клавиша вызова.

use crate::settings;
use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// Открыто ли всем игрокам. Пока `false` — только в режиме разработчика.
pub const PUBLIC: bool = true;
const LABEL: &str = "game";
/// Окно, активное до открытия меню (игра), — вернём ему фокус
static PREVIOUS: AtomicIsize = AtomicIsize::new(0);
/// Меню закреплено и сейчас «отпущено»: видно, но клики проходят в игру
static PASSIVE: AtomicBool = AtomicBool::new(false);
/// Закреплённое меню спрятали, потому что игрок ушёл из игры, — вернуть, когда он вернётся
static RESTORE: AtomicBool = AtomicBool::new(false);

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
    /// Показать, не забирая фокус у игры
    pub fn show_quiet(h: isize) {
        use windows::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_SHOWNOACTIVATE};
        if h != 0 {
            unsafe {
                let _ = ShowWindow(HWND(h as *mut core::ffi::c_void), SW_SHOWNOACTIVATE);
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
    pub fn show_quiet(_h: isize) {}
}

/// Закреплено ли меню (булавка) — хранится в раскладке gamemenu.json
fn pinned(app: &AppHandle) -> bool {
    game_menu_layout(app.clone())["pinned"].as_bool().unwrap_or(false)
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

/// Создать слой заранее (скрытым), чтобы меню открывалось сразу, без загрузки.
/// Только пока игра запущена: вне игры окно меню не держим — программа неделями висит в трее,
/// и лишнее скрытое окно занимало бы память впустую.
pub fn prepare(app: &AppHandle) {
    if enabled(app) && crate::game::in_game() {
        let _ = layer(app);
    } else if !enabled(app) {
        if let Some(w) = app.get_webview_window(LABEL) {
            let _ = w.destroy();
        }
    }
}

/// Номер «выхода из игры»: новый вход или выход отменяют прошлую отложенную уборку
static LEFT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
/// Сколько ждать после выхода из игры, прежде чем убрать окно меню из памяти (вдруг игрок свернулся на минуту)
const UNLOAD_AFTER: std::time::Duration = std::time::Duration::from_secs(10 * 60);

/// Игрок вне игры уже 10 минут — окно меню убираем из памяти. Вернётся в игру — создастся заново
fn unload_later(app: &AppHandle) {
    let gen = LEFT.fetch_add(1, Ordering::SeqCst) + 1;
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(UNLOAD_AFTER);
        // Закреплённое меню ждёт возвращения игрока — его не трогаем
        if LEFT.load(Ordering::SeqCst) != gen || crate::game::in_game() || visible(&app) || RESTORE.load(Ordering::Relaxed) {
            return;
        }
        if let Some(w) = app.get_webview_window(LABEL) {
            let _ = w.destroy();
        }
    });
}

pub fn visible(app: &AppHandle) -> bool {
    app.get_webview_window(LABEL).is_some_and(|w| w.is_visible().unwrap_or(false))
}

fn set_passive(app: &AppHandle, w: &WebviewWindow, on: bool) {
    PASSIVE.store(on, Ordering::Relaxed);
    let _ = w.set_ignore_cursor_events(on);
    let _ = app.emit_to(LABEL, "game-menu-passive", on);
}

/// Открыть меню и дать им управлять (мышь и клавиатура — у меню)
pub fn show(app: &AppHandle) {
    let Some(w) = layer(app) else { return };
    let fg = win::foreground();
    if fg != 0 && fg != crate::pins::hwnd_of(&w) {
        PREVIOUS.store(fg, Ordering::Relaxed);
    }
    RESTORE.store(false, Ordering::Relaxed);
    if !w.is_visible().unwrap_or(false) {
        crate::pins::cover(&w);
    }
    set_passive(app, &w, false);
    let _ = w.show();
    // Выше слоя закреплённых окон и подсказки
    crate::pins::raise_window(&w);
    let _ = w.set_focus();
    // Подсказка в углу не нужна, пока меню на экране (у закреплённого меню — своя)
    crate::overlay::hide_hint(app);
    let _ = w.emit("game-menu-shown", ());
}

/// Закреплённое меню: оставить на экране, а мышь и клавиатуру вернуть в игру
fn release(app: &AppHandle, w: &WebviewWindow) {
    set_passive(app, w, true);
    win::activate(PREVIOUS.load(Ordering::Relaxed));
}

/// Спрятать совсем (и закреплённое — тоже)
pub fn hide(app: &AppHandle) {
    let Some(w) = app.get_webview_window(LABEL) else { return };
    if !w.is_visible().unwrap_or(false) {
        return;
    }
    let was_active = !PASSIVE.load(Ordering::Relaxed);
    let _ = w.hide();
    set_passive(app, &w, false);
    if was_active {
        win::activate(PREVIOUS.swap(0, Ordering::Relaxed));
    }
    crate::overlay::show_hint_if_hidden(app);
}

/// Меню просят убрать (клавиша, Esc, клик в пустое место): закреплено — отпустить в игру, иначе спрятать
fn dismiss(app: &AppHandle) {
    let Some(w) = app.get_webview_window(LABEL) else { return };
    if pinned(app) {
        release(app, &w);
    } else {
        hide(app);
    }
}

/// Игрок ушёл из игры или вернулся в неё
pub fn game_changed(app: &AppHandle, in_game: bool) {
    if !in_game {
        // Закреплённое меню вернём, когда игрок вернётся в игру
        RESTORE.store(visible(app) && pinned(app), Ordering::Relaxed);
        hide(app);
        unload_later(app);
        return;
    }
    LEFT.fetch_add(1, Ordering::SeqCst);
    if !enabled(app) {
        return;
    }
    // Игра запущена — готовим меню заранее, чтобы клавиша открывала его сразу
    if !RESTORE.swap(false, Ordering::Relaxed) {
        let _ = layer(app);
    } else {
        let Some(w) = layer(app) else { return };
        crate::pins::cover(&w);
        set_passive(app, &w, true);
        win::show_quiet(crate::pins::hwnd_of(&w));
        crate::pins::raise_window(&w);
        crate::overlay::hide_hint(app);
    }
}

/// Клавиша вызова в игре: открыть меню, убрать его или (закреплённое) снова дать управлять
pub fn toggle(app: &AppHandle) {
    if visible(app) {
        if PASSIVE.load(Ordering::Relaxed) {
            show(app);
        } else {
            dismiss(app);
        }
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

/// Esc или клик в пустое место экрана
#[tauri::command]
pub fn game_menu_hide(app: AppHandle) {
    dismiss(&app);
}
