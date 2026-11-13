//! Окно поверх игры: показ/скрытие по клавише, возврат фокуса в игру, подсказка в углу экрана.
//! Никаких инъекций в игру: это обычное окно Windows поверх окна игры в режиме «без рамки».

use crate::settings::{self, HintMode, WindowGeom};
use std::sync::{
    atomic::{AtomicIsize, AtomicU64, Ordering},
    Arc,
};
use tauri::{AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, PhysicalSize, Position, Size, WebviewWindow};

/// Окно, которое было активным до показа программы (обычно — игра). Ему вернём фокус при скрытии.
#[derive(Default)]
pub struct OverlayState {
    pub previous: AtomicIsize,
    /// Счётчик для «временной» подсказки: старый таймер не прячет подсказку, показанную заново
    pub hint_epoch: Arc<AtomicU64>,
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

fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window("main")
}

fn hint_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window("hint")
}

/// По умолчанию — узкая колонка у правого края экрана, чтобы игра оставалась видна
pub fn place_default(win: &WebviewWindow) {
    let Ok(Some(mon)) = win.primary_monitor() else { return };
    let scale = mon.scale_factor();
    let area = mon.work_area();
    let width = (560.0 * scale) as u32;
    let height = ((area.size.height as f64) * 0.82).min(900.0 * scale) as u32;
    let x = area.position.x + area.size.width as i32 - width as i32 - (24.0 * scale) as i32;
    let y = area.position.y + ((area.size.height - height) / 2) as i32;
    let _ = win.set_size(Size::Physical(PhysicalSize::new(width, height)));
    let _ = win.set_position(Position::Physical(PhysicalPosition::new(x, y)));
}

/// Восстановить размер и место окна, если они сохранены и окно помещается на каком-то мониторе
pub fn restore_geometry(app: &AppHandle, win: &WebviewWindow) {
    let s = settings::load(app);
    let Some(g) = s.window.filter(|g| g.width >= 300 && g.height >= 300) else {
        place_default(win);
        return;
    };
    let visible = win.available_monitors().unwrap_or_default().iter().any(|m| {
        let p = m.position();
        let sz = m.size();
        g.x + 100 > p.x && g.x < p.x + sz.width as i32 && g.y >= p.y - 20 && g.y < p.y + sz.height as i32
    });
    if !visible {
        place_default(win);
        return;
    }
    let _ = win.set_size(Size::Physical(PhysicalSize::new(g.width, g.height)));
    let _ = win.set_position(Position::Physical(PhysicalPosition::new(g.x, g.y)));
}

fn save_geometry(app: &AppHandle, win: &WebviewWindow) {
    if win.is_maximized().unwrap_or(false) || win.is_minimized().unwrap_or(false) {
        return;
    }
    if let (Ok(pos), Ok(size)) = (win.outer_position(), win.inner_size()) {
        let mut s = settings::load(app);
        s.window = Some(WindowGeom { x: pos.x, y: pos.y, width: size.width, height: size.height });
        let _ = settings::save(app, &s);
    }
}

pub fn show_main(app: &AppHandle) {
    let Some(win) = main_window(app) else { return };
    let state = app.state::<OverlayState>();
    let fg = win::foreground();
    // Запоминаем, только если активно чужое окно (не сама программа)
    let own = win.hwnd_raw();
    if fg != 0 && fg != own {
        state.previous.store(fg, Ordering::Relaxed);
    }
    let _ = win.unminimize();
    let _ = win.show();
    // Поверх всех окон — только в игре; вне игры (в режиме разработчика) — обычное окно
    let _ = win.set_always_on_top(crate::game::in_game() || !crate::game::aware(app));
    let _ = win.set_focus();
    let _ = win.emit("overlay-shown", ());
    hide_hint(app);
}

pub fn hide_main(app: &AppHandle) {
    let Some(win) = main_window(app) else { return };
    save_geometry(app, &win);
    let _ = win.hide();
    // Возвращаем фокус в игру — иначе мышь и клавиатура остаются «у нас»
    let prev = app.state::<OverlayState>().previous.swap(0, Ordering::Relaxed);
    win::activate(prev);
    show_hint(app);
}

pub fn toggle(app: &AppHandle) {
    let Some(win) = main_window(app) else { return };
    let visible = win.is_visible().unwrap_or(false) && !win.is_minimized().unwrap_or(false);
    if visible {
        hide_main(app);
    } else {
        show_main(app);
    }
}

pub fn show_hint(app: &AppHandle) {
    let s = settings::load(app);
    let Some(hint) = hint_window(app) else { return };
    // В режиме разработчика подсказка видна только в игре
    if s.hint == HintMode::Off || !s.first_run_done || (crate::game::aware(app) && !crate::game::in_game()) {
        let _ = hint.hide();
        return;
    }
    // Есть закреплённые окна — во второй строке подсказка, как открыть их редактор
    let editor = crate::pins::active_editor_key(app);
    let lh = if editor.is_some() { 82.0 } else { 44.0 };
    if let Ok(Some(mon)) = hint.primary_monitor() {
        let scale = mon.scale_factor();
        let area = mon.work_area();
        let w = (300.0 * scale) as i32;
        let h = (lh * scale) as i32;
        let x = area.position.x + area.size.width as i32 - w - (16.0 * scale) as i32;
        let y = area.position.y + area.size.height as i32 - h - (16.0 * scale) as i32;
        let _ = hint.set_size(Size::Logical(LogicalSize::new(300.0, lh)));
        let _ = hint.set_position(Position::Physical(PhysicalPosition::new(x, y)));
    }
    // Подсказка не перехватывает мышь: клики проходят в игру
    let _ = hint.set_ignore_cursor_events(true);
    let _ = hint.emit("hint-update", serde_json::json!({ "hotkey": s.hotkey, "editor": editor }));
    let _ = hint.show();

    let epoch = app.state::<OverlayState>().hint_epoch.fetch_add(1, Ordering::Relaxed) + 1;
    if s.hint == HintMode::Timed {
        let app = app.clone();
        let counter = app.state::<OverlayState>().hint_epoch.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(10));
            if counter.load(Ordering::Relaxed) == epoch {
                hide_hint(&app);
            }
        });
    }
}

/// Обновить подсказку, если окно программы сейчас скрыто
pub fn show_hint_if_hidden(app: &AppHandle) {
    if main_window(app).is_some_and(|m| !m.is_visible().unwrap_or(true)) {
        show_hint(app);
    }
}

pub fn hide_hint(app: &AppHandle) {
    app.state::<OverlayState>().hint_epoch.fetch_add(1, Ordering::Relaxed);
    if let Some(h) = hint_window(app) {
        let _ = h.hide();
    }
}

trait RawHandle {
    fn hwnd_raw(&self) -> isize;
}

impl RawHandle for WebviewWindow {
    #[cfg(windows)]
    fn hwnd_raw(&self) -> isize {
        self.hwnd().map(|h| h.0 as isize).unwrap_or(0)
    }
    #[cfg(not(windows))]
    fn hwnd_raw(&self) -> isize {
        0
    }
}
