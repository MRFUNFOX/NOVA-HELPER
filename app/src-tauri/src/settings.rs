use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager};

/// Когда показывать подсказку о клавише в правом нижнем углу
#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum HintMode {
    /// Всегда, пока игрок в игре
    Always,
    /// 10 секунд после входа в игру или скрытия окна
    Timed,
    Off,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default, rename_all = "camelCase")]
pub struct WindowGeom {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

impl Default for WindowGeom {
    fn default() -> Self {
        Self { x: 0, y: 0, width: 0, height: 0 }
    }
}

/// Где стоит подсказка в углу: отступ её правого нижнего угла от правого нижнего угла монитора
/// (логические пиксели, как в редакторе окон). Нет — стоит на месте по умолчанию.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
pub struct HintPos {
    pub right: f64,
    pub bottom: f64,
}

/// Окно ответа на голосовой вопрос в игре: место (логические пиксели на мониторе игры), ширина, фон 0–100, шрифт
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(default)]
pub struct AskLayout {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub bg: u32,
    pub font: u32,
    pub locked: bool,
}

impl Default for AskLayout {
    fn default() -> Self {
        Self { x: 40.0, y: 120.0, w: 380.0, bg: 88, font: 15, locked: false }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    /// Сочетание в формате плагина global-shortcut: «Alt+Q», «Ctrl+Shift+Space», «F9»
    pub hotkey: String,
    pub hint: HintMode,
    /// Крестик прячет программу в трей (клавиша продолжает работать), а не закрывает её
    pub close_to_tray: bool,
    pub first_run_done: bool,
    /// Игрок уже видел настройку ИИ-помощника (настроил или пропустил) — больше не показываем.
    /// У тех, кто ставил программу до появления помощника, поля нет → false → покажем один раз.
    pub ai_setup_done: bool,
    /// Режим разработчика: видны функции, которые игрокам ещё не показываем (включается кодом)
    pub dev_mode: bool,
    /// Анонимная статистика: None — ещё не спрашивали, Some(true) — разрешил, Some(false) — отказался
    pub analytics: Option<bool>,
    /// Клавиша редактора закреплённых окон
    pub editor_hotkey: String,
    pub window: Option<WindowGeom>,
    /// Подсказку в углу передвинули в редакторе окон
    pub hint_pos: Option<HintPos>,
    /// Вопрос помощнику голосом в игре: включён ли (клавиша «съедает» сочетание в игре — по умолчанию выключено)
    pub ask_on: bool,
    /// Клавиша «держи и говори»
    pub ask_hotkey: String,
    /// Сколько секунд показывать ответ; 0 — по длине ответа
    pub ask_show: u32,
    /// Место и вид окна ответа (передвинули в редакторе окон)
    pub ask_layout: Option<AskLayout>,
    /// Метка тестовых сборок с голосом (0.7.18–0.7.19, окно было на Alt+X). Только читаем — чтобы вернуть
    /// окно на Alt+Q; в файл больше не пишем.
    #[serde(default, skip_serializing)]
    pub keys_v2: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            hotkey: "Alt+Q".into(),
            hint: HintMode::Always,
            close_to_tray: true,
            first_run_done: false,
            ai_setup_done: false,
            dev_mode: false,
            analytics: None,
            editor_hotkey: "Alt+Shift+Z".into(),
            window: None,
            hint_pos: None,
            ask_on: false,
            ask_hotkey: "Alt+E".into(),
            ask_show: 0,
            ask_layout: None,
            keys_v2: false,
        }
    }
}

fn path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("settings.json"))
}

pub fn load(app: &AppHandle) -> Settings {
    path(app)
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// Голосовой помощник убрали (24.11.2026): у тех, у кого тестовые сборки 0.7.18–0.7.19 перенесли окно на Alt+X,
/// возвращаем привычный Alt+Q. Один раз: метка keys_v2 в файл больше не пишется.
pub fn restore_keys(s: &mut Settings) -> bool {
    if !s.keys_v2 {
        return false;
    }
    s.keys_v2 = false;
    if s.hotkey == "Alt+X" && s.editor_hotkey != "Alt+Q" {
        s.hotkey = "Alt+Q".into();
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn window_key_back_to_alt_q() {
        // Тестовая сборка с голосом: окно на Alt+X
        let mut s: Settings = serde_json::from_str(r#"{"hotkey":"Alt+X","keysV2":true,"keysMoved":true,"voiceHotkey":"Alt+Q"}"#).unwrap();
        assert!(restore_keys(&mut s));
        assert_eq!(s.hotkey, "Alt+Q");
        assert!(!serde_json::to_string(&s).unwrap().contains("keysV2"));
        // Своя клавиша — не трогаем
        let mut s: Settings = serde_json::from_str(r#"{"hotkey":"F8","keysV2":true}"#).unwrap();
        restore_keys(&mut s);
        assert_eq!(s.hotkey, "F8");
        // Обычные игроки (0.7.17) — ничего не меняется
        let mut s: Settings = serde_json::from_str(r#"{"hotkey":"Alt+X"}"#).unwrap();
        assert!(!restore_keys(&mut s));
        assert_eq!(s.hotkey, "Alt+X");
        assert_eq!(Settings::default().hotkey, "Alt+Q");
    }
}

pub fn save(app: &AppHandle, s: &Settings) -> Result<(), String> {
    let p = path(app).ok_or("Не найдена папка настроек")?;
    if let Some(dir) = p.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    // Пишем во временный файл и переименовываем: настройки не испортятся при сбое посреди записи
    let tmp = p.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_vec_pretty(s).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &p).map_err(|e| e.to_string())
}
