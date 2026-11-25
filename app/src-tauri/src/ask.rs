//! Вопрос помощнику голосом прямо в игре (дизайн утверждён 25.11.2026).
//!
//! Игрок держит клавишу (по умолчанию Alt+E), говорит и отпускает. Речь распознаёт voice.rs,
//! вопрос задаёт главное окно (там правила и помощник), ответ показывает маленькое окно «ask»
//! поверх игры и само прячет его через некоторое время.
//!
//! Окно ответа не забирает фокус у игры и пропускает клики в игру. Когда открыто меню хелпера
//! (курсор свободен), окно поднимается выше меню и ловит мышь — у ответа появляются кнопки
//! «закрыть» и «закрепить», таймер стоит на паузе.
//!
//! Клавиша работает только в игре и только если функция включена в настройках:
//! глобальная клавиша «съедает» сочетание у всех программ, поэтому вне игры её не держим.

use crate::settings::{self, AskLayout};
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Position, Size, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

pub const LABEL: &str = "ask";
/// Ширина окна ответа по умолчанию (логические пиксели)
pub const DEFAULT_W: f64 = 380.0;
/// Меню хелпера открыто и управляет мышью — окно ответа кликабельно
static MENU: AtomicBool = AtomicBool::new(false);
/// Клавиша сейчас зажата (отпустили раньше, чем включился микрофон, — запись сразу останавливаем)
static HELD: AtomicBool = AtomicBool::new(false);
/// Какое сочетание сейчас зарегистрировано (пусто — никакое)
static KEY_ON: Mutex<String> = Mutex::new(String::new());
/// Высота содержимого окна (логические пиксели) — её сообщает само окно
static HEIGHT: Mutex<f64> = Mutex::new(120.0);
/// Что показано сейчас — окно, которое только загрузилось, берёт состояние отсюда (событие могло прийти раньше)
static LAST: Mutex<Option<Value>> = Mutex::new(None);

#[cfg(windows)]
mod win {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::*;
    fn hwnd(h: isize) -> HWND {
        HWND(h as *mut core::ffi::c_void)
    }
    /// Не показывать в Alt+Tab
    pub fn tool(h: isize) {
        unsafe {
            let ex = GetWindowLongPtrW(hwnd(h), GWL_EXSTYLE);
            SetWindowLongPtrW(hwnd(h), GWL_EXSTYLE, ex | WS_EX_TOOLWINDOW.0 as isize);
        }
    }
    /// Показать поверх всех, не забирая фокус у игры
    pub fn show_quiet(h: isize) {
        unsafe {
            let _ = ShowWindow(hwnd(h), SW_SHOWNOACTIVATE);
            let _ = SetWindowPos(hwnd(h), Some(HWND_TOPMOST), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW);
        }
    }
}

#[cfg(not(windows))]
mod win {
    pub fn tool(_h: isize) {}
    pub fn show_quiet(_h: isize) {}
}

fn window(app: &AppHandle) -> Option<WebviewWindow> {
    if let Some(w) = app.get_webview_window(LABEL) {
        return Some(w);
    }
    let w = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("ask.html".into()))
        .title("NOVA HELPER — ответ помощника")
        .transparent(true)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .shadow(false)
        .focused(false)
        .focusable(false)
        .visible(false)
        .inner_size(DEFAULT_W, 120.0)
        .build()
        .ok()?;
    win::tool(crate::pins::hwnd_of(&w));
    let _ = w.set_ignore_cursor_events(true);
    Some(w)
}

/// Где стоит окно ответа (логические пиксели на мониторе игры). Нет своего места — справа сверху.
pub fn layout(app: &AppHandle, w: Option<&WebviewWindow>) -> AskLayout {
    if let Some(l) = settings::load(app).ask_layout {
        return l;
    }
    let (mw, _) = w
        .or(app.get_webview_window("pins").as_ref())
        .and_then(crate::pins::game_monitor)
        .map(|m| (m.size().width as f64 / m.scale_factor(), m.size().height as f64 / m.scale_factor()))
        .unwrap_or((1920.0, 1080.0));
    AskLayout { x: (mw - DEFAULT_W - 40.0).max(0.0), y: 120.0, w: DEFAULT_W, bg: 88, font: 15, locked: false }
}

/// Поставить окно на место и по размеру содержимого
fn place(app: &AppHandle, w: &WebviewWindow) {
    let Some(m) = crate::pins::game_monitor(w) else { return };
    let l = layout(app, Some(w));
    let s = m.scale_factor();
    let p = m.position();
    let h = *HEIGHT.lock().unwrap();
    // Над окном — место под кнопки «закрыть» и «закрепить» (видны, когда открыто меню)
    let top = 40.0;
    // Слева и снизу — по 8 пикселей под тень карточки
    let x = p.x + ((l.x - 8.0).max(0.0) * s) as i32;
    let y = p.y + ((l.y - top).max(0.0) * s) as i32;
    let _ = w.set_position(Position::Physical(PhysicalPosition::new(x, y)));
    let _ = w.set_size(Size::Physical(PhysicalSize::new(((l.w + 16.0) * s) as u32, ((h + top + 16.0) * s) as u32)));
}

/// Показать окно с новым состоянием (слушаю / ищу / ответ / ошибка)
pub fn show(app: &AppHandle, state: Value) {
    *LAST.lock().unwrap() = Some(state.clone());
    let Some(w) = window(app) else { return };
    let _ = w.emit("ask-state", &state);
    if !w.is_visible().unwrap_or(false) {
        place(app, &w);
        win::show_quiet(crate::pins::hwnd_of(&w));
    }
    let open = MENU.load(Ordering::Relaxed);
    clickable(&w, open);
    let _ = w.emit("ask-menu", open);
}

/// Меню открыто — окно ловит мышь (кнопки «закрыть», «закрепить») и стоит выше меню; закрыто — клики идут в игру
fn clickable(w: &WebviewWindow, on: bool) {
    let _ = w.set_ignore_cursor_events(!on);
    let _ = w.set_focusable(on);
    if on {
        crate::pins::raise_window(w);
    }
}

fn hide(app: &AppHandle) {
    *LAST.lock().unwrap() = None;
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.hide();
        let _ = w.set_ignore_cursor_events(true);
        let _ = w.set_focusable(false);
    }
}

/// Меню хелпера открылось (курсор у игрока) или закрылось / отпущено в игру
pub fn menu(app: &AppHandle, open: bool) {
    MENU.store(open, Ordering::Relaxed);
    let Some(w) = app.get_webview_window(LABEL) else { return };
    let _ = w.emit("ask-menu", open);
    if !w.is_visible().unwrap_or(false) {
        return;
    }
    clickable(&w, open);
}

// ── Клавиша «держи и говори» ──

fn press(app: &AppHandle) {
    if HELD.swap(true, Ordering::SeqCst) {
        return;
    }
    if !crate::voice::installed_now(app) {
        show(app, json!({ "stage": "error", "error": "Скачай распознавание речи: помощник → кнопка микрофона" }));
        return;
    }
    show(app, json!({ "stage": "listen" }));
    match crate::voice::start(app, "game", true) {
        Ok(()) => {
            // Клавишу отпустили, пока включался микрофон, — сразу распознаём то, что успели сказать
            if !HELD.load(Ordering::SeqCst) {
                crate::voice::voice_stop(app.clone());
            }
        }
        Err(e) if e == "busy" => show(app, json!({ "stage": "error", "error": "Микрофон уже записывает в помощнике" })),
        Err(e) => show(app, json!({ "stage": "error", "error": e })),
    }
}

fn release(app: &AppHandle) {
    if HELD.swap(false, Ordering::SeqCst) {
        crate::voice::voice_stop(app.clone());
    }
}

fn register(app: &AppHandle, key: &str) -> Result<(), String> {
    app.global_shortcut()
        .on_shortcut(key, |app, _s, e| {
            // Клавиша срабатывает в главном потоке — микрофон включаем в отдельном
            let app = app.clone();
            let down = e.state == ShortcutState::Pressed;
            std::thread::spawn(move || if down { press(&app) } else { release(&app) });
        })
        .map_err(|_| format!("Сочетание «{key}» не подходит или уже занято другой программой. Выберите другое."))
}

/// Держать клавишу, только пока игрок в игре и функция включена
pub fn sync(app: &AppHandle) {
    let s = settings::load(app);
    let want = if s.ask_on && crate::game::in_game() { s.ask_hotkey.clone() } else { String::new() };
    let mut cur = KEY_ON.lock().unwrap();
    if *cur != want {
        if !cur.is_empty() {
            let _ = app.global_shortcut().unregister(cur.as_str());
            cur.clear();
        }
        if !want.is_empty() && register(app, &want).is_ok() {
            *cur = want;
        }
    }
    let on = !cur.is_empty();
    drop(cur);
    // Окно ответа готовим заранее (скрытым), чтобы «Слушаю…» появилось сразу
    if on {
        let _ = window(app);
    }
    // Ушли из игры — ответ не нужен
    if !crate::game::in_game() && !crate::pins::editor_open() {
        hide(app);
        if HELD.swap(false, Ordering::SeqCst) {
            crate::voice::voice_cancel(app.clone());
        }
    }
}

// ── Команды для окон ──

/// Главное окно: показать ход ответа или сам ответ
#[tauri::command]
pub fn ask_show(app: AppHandle, state: Value) {
    show(&app, state);
}

/// Окно ответа: закрыть (крестик или вышло время)
#[tauri::command]
pub fn ask_hide(app: AppHandle) {
    hide(&app);
    // Закрыли крестиком при открытом меню — клавиатура снова у меню (Esc, клавиша вызова)
    if MENU.load(Ordering::Relaxed) {
        if let Some(m) = app.get_webview_window("game") {
            let _ = m.set_focus();
        }
    }
}

/// Окно ответа сообщает высоту содержимого — подгоняем окно
#[tauri::command]
pub fn ask_size(app: AppHandle, height: f64) {
    *HEIGHT.lock().unwrap() = height.clamp(40.0, 2000.0);
    if let Some(w) = app.get_webview_window(LABEL) {
        place(&app, &w);
    }
}

/// Место, ширина, фон и шрифт окна ответа (для окна ответа и редактора окон)
#[tauri::command]
pub fn ask_layout(app: AppHandle) -> Value {
    let s = settings::load(&app);
    json!({ "layout": layout(&app, None), "show": s.ask_show, "on": s.ask_on, "menuKey": s.hotkey, "key": s.ask_hotkey, "menu": MENU.load(Ordering::Relaxed), "state": LAST.lock().unwrap().clone() })
}

/// Редактор окон сохранил новое место или вид окна ответа
#[tauri::command]
pub fn ask_layout_save(app: AppHandle, layout: AskLayout) -> Result<(), String> {
    let mut s = settings::load(&app);
    s.ask_layout = Some(layout);
    settings::save(&app, &s)?;
    let _ = app.emit("ask-layout", &layout);
    if let Some(w) = app.get_webview_window(LABEL) {
        place(&app, &w);
    }
    Ok(())
}

/// Сменить клавишу «держи и говори». Старая освобождается, только если новая зарегистрировалась.
#[tauri::command]
pub fn set_ask_hotkey(app: AppHandle, hotkey: String) -> Result<settings::Settings, String> {
    let mut s = settings::load(&app);
    if hotkey == s.hotkey || hotkey == s.editor_hotkey {
        return Err("Это сочетание уже занято другой клавишей программы. Выберите другое.".into());
    }
    if s.ask_hotkey == hotkey {
        return Ok(s);
    }
    // Проверяем, что сочетание свободно
    {
        let cur = KEY_ON.lock().unwrap();
        if *cur != hotkey {
            register(&app, &hotkey)?;
            let _ = app.global_shortcut().unregister(hotkey.as_str());
        }
    }
    s.ask_hotkey = hotkey;
    settings::save(&app, &s)?;
    // Перерегистрируем: старое снимется, новое встанет (если игрок в игре)
    {
        let mut cur = KEY_ON.lock().unwrap();
        if !cur.is_empty() {
            let _ = app.global_shortcut().unregister(cur.as_str());
            cur.clear();
        }
    }
    sync(&app);
    let _ = app.emit("settings-changed", s.clone());
    Ok(s)
}

/// Включить или выключить функцию
#[tauri::command]
pub fn set_ask_on(app: AppHandle, on: bool) -> Result<settings::Settings, String> {
    let mut s = settings::load(&app);
    s.ask_on = on;
    settings::save(&app, &s)?;
    sync(&app);
    let _ = app.emit("settings-changed", s.clone());
    Ok(s)
}

/// Временно снять клавишу, пока игрок записывает новое сочетание
#[tauri::command]
pub fn suspend_ask_hotkey(app: AppHandle, suspended: bool) {
    if suspended {
        let mut cur = KEY_ON.lock().unwrap();
        if !cur.is_empty() {
            let _ = app.global_shortcut().unregister(cur.as_str());
            cur.clear();
        }
    } else {
        sync(&app);
    }
}
