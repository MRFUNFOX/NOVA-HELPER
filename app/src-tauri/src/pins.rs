//! Закреплённые пункты поверх игры.
//!
//! Один прозрачный слой во весь основной монитор («pins.html»), на нём — окошки с пунктами.
//! Обычно слой пропускает мышь и клавиатуру в игру. В режиме редактора (Alt+Shift+Z) слой
//! поднимается выше всех окон, включая саму программу, и ловит мышь: окна можно тянуть и настраивать.
//!
//! Пока функция в разработке, она работает только в режиме разработчика: без него слой
//! даже не создаётся.

use crate::settings;
use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Position, Size, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

/// Открыто ли всем игрокам. Пока `false` — только в режиме разработчика.
const PUBLIC: bool = false;
const LABEL: &str = "pins";
/// Поля раскладки — их хранит и меняет слой окон; остальное (текст пункта) — главное окно
const LAYOUT: &[&str] = &["x", "y", "w", "bg", "font", "locked"];

static EDITOR: AtomicBool = AtomicBool::new(false);
/// Какая клавиша редактора сейчас зарегистрирована (пусто — никакая)
static KEY_ON: std::sync::Mutex<String> = std::sync::Mutex::new(String::new());
/// Окно, активное до открытия редактора (обычно игра), — вернём ему фокус
static PREVIOUS: AtomicIsize = AtomicIsize::new(0);

pub fn enabled(app: &AppHandle) -> bool {
    PUBLIC || settings::load(app).dev_mode
}

fn path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("pins.json"))
}

fn load(app: &AppHandle) -> Vec<Value> {
    path(app)
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str::<Vec<Value>>(&s).ok())
        .unwrap_or_default()
}

fn store(app: &AppHandle, pins: &[Value]) -> Result<(), String> {
    let p = path(app).ok_or("Не найдена папка настроек")?;
    if let Some(dir) = p.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = p.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_vec(pins).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &p).map_err(|e| e.to_string())
}

fn key_of(v: &Value) -> &str {
    v["key"].as_str().unwrap_or("")
}

#[cfg(windows)]
mod win {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::*;

    fn hwnd(h: isize) -> HWND {
        HWND(h as *mut core::ffi::c_void)
    }

    pub fn foreground() -> isize {
        unsafe { GetForegroundWindow().0 as isize }
    }

    pub fn activate(h: isize) {
        if h != 0 {
            unsafe {
                if IsWindow(Some(hwnd(h))).as_bool() {
                    let _ = SetForegroundWindow(hwnd(h));
                }
            }
        }
    }

    /// Слой не забирает фокус у игры и не виден в Alt+Tab
    pub fn no_activate(h: isize) {
        unsafe {
            let ex = GetWindowLongPtrW(hwnd(h), GWL_EXSTYLE);
            SetWindowLongPtrW(hwnd(h), GWL_EXSTYLE, ex | (WS_EX_NOACTIVATE.0 | WS_EX_TOOLWINDOW.0) as isize);
        }
    }

    /// Поднять окно выше всех «поверх всех» окон, не активируя его
    pub fn raise(h: isize) {
        unsafe {
            let _ = SetWindowPos(hwnd(h), Some(HWND_TOPMOST), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW);
        }
    }
}

#[cfg(not(windows))]
mod win {
    pub fn foreground() -> isize { 0 }
    pub fn activate(_h: isize) {}
    pub fn no_activate(_h: isize) {}
    pub fn raise(_h: isize) {}
}

fn hwnd_of(w: &WebviewWindow) -> isize {
    #[cfg(windows)]
    {
        w.hwnd().map(|h| h.0 as isize).unwrap_or(0)
    }
    #[cfg(not(windows))]
    {
        let _ = w;
        0
    }
}

/// Растянуть слой на весь основной монитор. На 1 пиксель ниже экрана — иначе Windows
/// посчитает его «полноэкранным приложением» и спрячет панель задач и уведомления.
fn cover(w: &WebviewWindow) {
    // Монитор, на котором игра; не знаем — основной
    let on_game = crate::game::rect().and_then(|(x, y, gw, gh)| {
        let (cx, cy) = (x + gw / 2, y + gh / 2);
        w.available_monitors().ok()?.into_iter().find(|m| {
            let p = m.position();
            let s = m.size();
            cx >= p.x && cx < p.x + s.width as i32 && cy >= p.y && cy < p.y + s.height as i32
        })
    });
    if let Some(m) = on_game.or_else(|| w.primary_monitor().ok().flatten()) {
        let p = m.position();
        let s = m.size();
        let _ = w.set_position(Position::Physical(PhysicalPosition::new(p.x, p.y)));
        let _ = w.set_size(Size::Physical(PhysicalSize::new(s.width, s.height.saturating_sub(1))));
    }
}

fn layer(app: &AppHandle) -> Option<WebviewWindow> {
    if let Some(w) = app.get_webview_window(LABEL) {
        return Some(w);
    }
    let w = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("pins.html".into()))
        .title("NOVA HELPER — закреплённые пункты")
        .transparent(true)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .shadow(false)
        .focused(false)
        .visible(false)
        .build()
        .ok()?;
    win::no_activate(hwnd_of(&w));
    cover(&w);
    let _ = w.set_ignore_cursor_events(true);
    Some(w)
}

fn register_editor_key(app: &AppHandle, key: &str) -> Result<(), String> {
    app.global_shortcut()
        .on_shortcut(key, |app, _s, e| {
            if e.state == ShortcutState::Pressed {
                let open = !EDITOR.load(Ordering::Relaxed);
                editor(app, open);
            }
        })
        .map_err(|_| format!("Сочетание «{key}» не подходит или уже занято другой программой. Выберите другое."))
}

/// Включить клавишу редактора (сочетание из настроек) или снять её
fn set_editor_key(app: &AppHandle, on: bool) {
    let want = if on { settings::load(app).editor_hotkey } else { String::new() };
    let mut cur = KEY_ON.lock().unwrap();
    if *cur == want {
        return;
    }
    if !cur.is_empty() {
        let _ = app.global_shortcut().unregister(cur.as_str());
        cur.clear();
    }
    if !want.is_empty() && register_editor_key(app, &want).is_ok() {
        *cur = want;
    }
}

/// Какая клавиша редактора действует сейчас — для подсказки в углу экрана (None — окон нет)
pub fn active_editor_key(app: &AppHandle) -> Option<String> {
    let _ = app;
    let cur = KEY_ON.lock().unwrap();
    (!cur.is_empty()).then(|| cur.clone())
}

/// Показать или убрать слой в зависимости от того, включена ли функция и есть ли закреплённые пункты
pub fn sync(app: &AppHandle) {
    let pins = if enabled(app) { load(app) } else { Vec::new() };
    // Окна видны только в игре (или пока открыт редактор)
    let visible = crate::game::in_game() || EDITOR.load(Ordering::Relaxed);
    if pins.is_empty() || !visible {
        if pins.is_empty() {
            editor(app, false);
        }
        set_editor_key(app, false);
        if let Some(w) = app.get_webview_window(LABEL) {
            let _ = w.emit("pins-changed", &pins);
            let _ = w.hide();
        }
    } else if let Some(w) = layer(app) {
        set_editor_key(app, true);
        cover(&w);
        let _ = w.emit("pins-changed", &pins);
        if !w.is_visible().unwrap_or(false) {
            let _ = w.show();
            win::raise(hwnd_of(&w));
        }
    }
    let _ = app.emit("pins-changed", &pins);
    // В подсказке в углу появляется (или пропадает) строка про редактор
    if app.get_webview_window("main").is_some_and(|m| !m.is_visible().unwrap_or(true)) {
        crate::overlay::show_hint(app);
    }
}

/// Открыть или закрыть редактор окон
pub fn editor(app: &AppHandle, open: bool) {
    if EDITOR.swap(open, Ordering::Relaxed) == open {
        return;
    }
    // Редактор можно открыть и вне игры (кнопкой в настройках) — тогда слой создаём сейчас
    let w = if open { layer(app) } else { app.get_webview_window(LABEL) };
    let Some(w) = w else {
        EDITOR.store(false, Ordering::Relaxed);
        return;
    };
    if open {
        let _ = w.emit("pins-changed", load(app));
    }
    let gs = app.global_shortcut();
    if open {
        let fg = win::foreground();
        if fg != hwnd_of(&w) {
            PREVIOUS.store(fg, Ordering::Relaxed);
        }
        cover(&w);
        let _ = w.set_ignore_cursor_events(false);
        let _ = w.show();
        // Выше всех окон — даже выше самой программы
        win::raise(hwnd_of(&w));
        // Слой не берёт фокус клавиатуры, поэтому Esc ловим как глобальную клавишу, пока открыт редактор
        let _ = gs.on_shortcut("Escape", |app, _s, e| {
            if e.state == ShortcutState::Pressed {
                editor(app, false);
            }
        });
    } else {
        let _ = gs.unregister("Escape");
        let _ = w.set_ignore_cursor_events(true);
        // Если программа открыта — возвращаем её наверх, иначе отдаём фокус игре
        match app.get_webview_window("main") {
            Some(m) if m.is_visible().unwrap_or(false) && !m.is_minimized().unwrap_or(false) => win::raise(hwnd_of(&m)),
            _ => win::activate(PREVIOUS.swap(0, Ordering::Relaxed)),
        }
    }
    let _ = app.emit("pins-editor", open);
    // Редактор открыли вне игры (кнопкой в настройках) — после закрытия окна снова прячутся
    if !open {
        sync(app);
    }
}

#[tauri::command]
pub fn pins_get(app: AppHandle) -> Value {
    json!({ "enabled": enabled(&app), "pins": load(&app), "editorKey": settings::load(&app).editor_hotkey, "editor": EDITOR.load(Ordering::Relaxed) })
}

/// Главное окно сообщает список закреплённых пунктов (текст). Раскладка уже закреплённых сохраняется.
#[tauri::command]
pub fn pins_set(app: AppHandle, pins: Vec<Value>) -> Result<(), String> {
    if !enabled(&app) {
        return Ok(());
    }
    let old = load(&app);
    let merged: Vec<Value> = pins
        .into_iter()
        .filter(|p| !key_of(p).is_empty())
        .map(|mut p| {
            if let (Some(prev), Some(obj)) = (old.iter().find(|o| key_of(o) == key_of(&p)), p.as_object_mut()) {
                for f in LAYOUT {
                    if let Some(v) = prev.get(*f) {
                        obj.insert((*f).to_string(), v.clone());
                    }
                }
            }
            p
        })
        .collect();
    store(&app, &merged)?;
    sync(&app);
    Ok(())
}

/// Слой окон сообщает новую раскладку: положение, ширину, фон, шрифт, замок
#[tauri::command]
pub fn pins_layout(app: AppHandle, layout: Vec<Value>) -> Result<(), String> {
    let mut pins = load(&app);
    for l in &layout {
        if let Some(p) = pins.iter_mut().find(|p| key_of(p) == key_of(l)) {
            if let (Some(obj), Some(src)) = (p.as_object_mut(), l.as_object()) {
                for f in LAYOUT {
                    if let Some(v) = src.get(*f) {
                        obj.insert((*f).to_string(), v.clone());
                    }
                }
            }
        }
    }
    store(&app, &pins)?;
    // Главному окну раскладка не нужна, но список держим одинаковым
    let _ = app.emit_to("main", "pins-changed", &pins);
    Ok(())
}

/// Открепить пункт (крестик в редакторе)
#[tauri::command]
pub fn pins_remove(app: AppHandle, key: String) -> Result<(), String> {
    let pins: Vec<Value> = load(&app).into_iter().filter(|p| key_of(p) != key).collect();
    store(&app, &pins)?;
    sync(&app);
    Ok(())
}

#[tauri::command]
pub fn pins_editor(app: AppHandle, open: bool) {
    editor(&app, open);
}

/// Пересчитать после включения/выключения режима разработчика
#[tauri::command]
pub fn pins_sync(app: AppHandle) {
    sync(&app);
}


/// Сменить клавишу редактора. Старая освобождается, только если новая зарегистрировалась.
#[tauri::command]
pub fn set_editor_hotkey(app: AppHandle, hotkey: String) -> Result<settings::Settings, String> {
    let mut s = settings::load(&app);
    if hotkey == s.hotkey {
        return Err("Это сочетание уже открывает саму программу. Выберите другое.".into());
    }
    if s.editor_hotkey == hotkey {
        return Ok(s);
    }
    let active = !KEY_ON.lock().unwrap().is_empty();
    if active {
        // Проверяем, что новое сочетание свободно, прежде чем отпускать старое
        set_editor_key(&app, false);
        if let Err(e) = register_editor_key(&app, &hotkey) {
            set_editor_key(&app, true);
            return Err(e);
        }
        let _ = app.global_shortcut().unregister(hotkey.as_str());
    }
    s.editor_hotkey = hotkey;
    settings::save(&app, &s)?;
    if active {
        set_editor_key(&app, true);
    }
    let _ = app.emit("settings-changed", s.clone());
    crate::overlay::show_hint_if_hidden(&app);
    Ok(s)
}

/// Временно снять клавишу редактора, пока игрок записывает новое сочетание
#[tauri::command]
pub fn suspend_editor_hotkey(app: AppHandle, suspended: bool) {
    if suspended {
        set_editor_key(&app, false);
    } else {
        sync(&app);
    }
}
