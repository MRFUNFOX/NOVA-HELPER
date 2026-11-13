//! Где сейчас игрок: в GTA или в другой программе.
//!
//! Раз в 0,4 секунды смотрим, какое окно активно, и по имени его процесса узнаём игру
//! (GTA5.exe — так же запускается и через RAGE MP / alt:V; у FiveM — …GTAProcess.exe).
//! В игру ничего не встраиваем: это обычный вопрос к Windows «какое окно сейчас впереди».
//!
//! Пока функция в разработке, поведение меняется только в режиме разработчика:
//! - программа поверх всех окон только в игре, вне игры — обычное окно;
//! - закреплённые пункты видны только в игре, на мониторе с игрой;
//! - подсказка в углу экрана — только в игре;
//! - игра в полноэкранном режиме → программа подскажет включить «Оконный без рамки».

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

/// Игрок в игре (активна GTA или наше окно, открытое поверх игры)
static IN_GAME: AtomicBool = AtomicBool::new(false);
/// Игра запущена в полноэкранном режиме (поверх неё ничего не видно)
static FULLSCREEN: AtomicBool = AtomicBool::new(false);
/// Окно игры: левый верхний угол и размер, пиксели экрана
static RECT: Mutex<Option<(i32, i32, i32, i32)>> = Mutex::new(None);

pub fn in_game() -> bool {
    IN_GAME.load(Ordering::Relaxed)
}

pub fn fullscreen() -> bool {
    FULLSCREEN.load(Ordering::Relaxed)
}

pub fn rect() -> Option<(i32, i32, i32, i32)> {
    *RECT.lock().unwrap()
}

/// Новое поведение (зависимость от игры) включено? Пока — только в режиме разработчика.
pub fn aware(app: &AppHandle) -> bool {
    crate::pins::enabled(app)
}

fn is_game_exe(path: &str) -> bool {
    let name = path.rsplit(['\\', '/']).next().unwrap_or(path).to_ascii_lowercase();
    name == "gta5.exe" || name == "gta5_enhanced.exe" || name.ends_with("gtaprocess.exe")
}

#[cfg(windows)]
mod win {
    use windows::core::PWSTR;
    use windows::Win32::Foundation::{CloseHandle, HWND, RECT};
    use windows::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION};
    use windows::Win32::UI::Shell::{SHQueryUserNotificationState, QUNS_RUNNING_D3D_FULL_SCREEN};
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowRect, GetWindowThreadProcessId, IsIconic};

    pub struct Fg {
        pub hwnd: isize,
        pub pid: u32,
    }

    pub fn foreground() -> Option<Fg> {
        unsafe {
            let h = GetForegroundWindow();
            if h.0.is_null() {
                return None;
            }
            let mut pid = 0u32;
            GetWindowThreadProcessId(h, Some(&mut pid as *mut u32));
            Some(Fg { hwnd: h.0 as isize, pid })
        }
    }

    pub fn exe(pid: u32) -> Option<String> {
        unsafe {
            let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
            let mut buf = [0u16; 520];
            let mut len = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len).is_ok();
            let _ = CloseHandle(h);
            ok.then(|| String::from_utf16_lossy(&buf[..len as usize]))
        }
    }

    pub fn rect(hwnd: isize) -> Option<(i32, i32, i32, i32)> {
        unsafe {
            let h = HWND(hwnd as *mut core::ffi::c_void);
            if IsIconic(h).as_bool() {
                return None;
            }
            let mut r = RECT::default();
            GetWindowRect(h, &mut r).ok()?;
            Some((r.left, r.top, r.right - r.left, r.bottom - r.top))
        }
    }

    /// Активное приложение работает в исключительном полноэкранном режиме (Direct3D)
    pub fn exclusive_fullscreen() -> bool {
        unsafe { SHQueryUserNotificationState().map(|s| s == QUNS_RUNNING_D3D_FULL_SCREEN).unwrap_or(false) }
    }
}

#[cfg(not(windows))]
mod win {
    pub struct Fg {
        pub hwnd: isize,
        pub pid: u32,
    }
    pub fn foreground() -> Option<Fg> { None }
    pub fn exe(_pid: u32) -> Option<String> { None }
    pub fn rect(_hwnd: isize) -> Option<(i32, i32, i32, i32)> { None }
    pub fn exclusive_fullscreen() -> bool { false }
}

/// Запустить наблюдение за активным окном
pub fn watch(app: AppHandle) {
    std::thread::spawn(move || {
        let own = std::process::id();
        // Последний проверенный процесс — чтобы не открывать его каждые 0,4 секунды
        let mut cache: (u32, bool) = (0, false);
        loop {
            std::thread::sleep(Duration::from_millis(400));
            if !aware(&app) {
                if IN_GAME.swap(false, Ordering::Relaxed) {
                    apply(&app);
                }
                continue;
            }
            let Some(fg) = win::foreground() else { continue };
            let game = if fg.pid == own {
                None // наше окно впереди — состояние не меняем (открыли программу поверх игры)
            } else {
                if cache.0 != fg.pid {
                    cache = (fg.pid, win::exe(fg.pid).is_some_and(|p| is_game_exe(&p)));
                }
                Some(cache.1)
            };
            let Some(is_game) = game else { continue };
            if is_game {
                *RECT.lock().unwrap() = win::rect(fg.hwnd).or(rect());
                let fs = win::exclusive_fullscreen();
                if fs && !FULLSCREEN.swap(true, Ordering::Relaxed) {
                    let _ = app.emit("game-fullscreen", true);
                } else if !fs && FULLSCREEN.swap(false, Ordering::Relaxed) {
                    let _ = app.emit("game-fullscreen", false);
                }
            }
            if IN_GAME.swap(is_game, Ordering::Relaxed) != is_game {
                apply(&app);
            }
        }
    });
}

/// Игрок вошёл в игру или вышел из неё: поверх ли программа, видны ли окна и подсказка
fn apply(app: &AppHandle) {
    let game = in_game();
    if let Some(m) = app.get_webview_window("main") {
        let _ = m.set_always_on_top(game || !aware(app));
    }
    crate::pins::sync(app);
    if app.get_webview_window("main").is_some_and(|m| !m.is_visible().unwrap_or(true)) {
        crate::overlay::show_hint(app);
    }
    let _ = app.emit("game-state", json_state());
}

fn json_state() -> serde_json::Value {
    serde_json::json!({ "inGame": in_game(), "fullscreen": fullscreen() })
}

#[tauri::command]
pub fn game_state() -> serde_json::Value {
    json_state()
}

#[cfg(test)]
mod tests {
    #[test]
    fn game_exe() {
        assert!(super::is_game_exe(r"C:\Games\Grand Theft Auto V\GTA5.exe"));
        assert!(super::is_game_exe(r"D:\Steam\steamapps\common\Grand Theft Auto V Enhanced\GTA5_Enhanced.exe"));
        assert!(super::is_game_exe(r"C:\Users\a\AppData\Local\FiveM\FiveM.app\data\cache\subprocess\FiveM_b2944_GTAProcess.exe"));
        assert!(!super::is_game_exe(r"C:\Program Files\Discord\Discord.exe"));
        assert!(!super::is_game_exe(r"C:\RAGEMP\ragemp_v.exe"));
    }
}
