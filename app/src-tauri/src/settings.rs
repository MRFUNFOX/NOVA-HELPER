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
    /// Голосовой вопрос к ИИ: зажать и говорить
    pub voice_hotkey: String,
    /// Озвучивать ответ голосом
    pub voice_speak: bool,
    /// Микрофон (имя устройства); None — как в Windows
    pub voice_input: Option<String>,
    /// Куда выводить голос ИИ; None — как в Windows
    pub voice_output: Option<String>,
    /// Клавиши по новой схеме (23.11.2026): окно — Alt+X, голос — Alt+Q. У старых настроек поля нет → false →
    /// при запуске клавиша окна Alt+Q переезжает на Alt+X (Alt+Q теперь для голоса), игроку показываем подсказку.
    #[serde(default)]
    pub keys_v2: bool,
    /// Клавишу окна перенесли с Alt+Q на Alt+X — показать игроку один раз
    pub keys_moved: bool,
    /// Игрок сам удалил голос — больше не скачиваем его в фоне (кнопка «Установить голос» остаётся)
    pub voice_declined: bool,
    /// Громкость голоса ИИ, 0–100
    pub voice_volume: u8,
    /// Скорость речи: 1 — как записан голос; по умолчанию чуть быстрее
    pub voice_rate: f32,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            hotkey: "Alt+X".into(),
            hint: HintMode::Always,
            close_to_tray: true,
            first_run_done: false,
            ai_setup_done: false,
            dev_mode: false,
            analytics: None,
            editor_hotkey: "Alt+Shift+Z".into(),
            window: None,
            hint_pos: None,
            voice_hotkey: "Alt+Q".into(),
            voice_speak: true,
            voice_input: None,
            voice_output: None,
            keys_v2: true,
            keys_moved: false,
            voice_declined: false,
            voice_volume: 100,
            voice_rate: 1.15,
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

/// Переход на новую схему клавиш (один раз): Alt+Q у окна → Alt+X, Alt+Q отдаём голосу.
/// Игрок сам менял клавишу окна — её не трогаем, а голосу ставим Alt+Q, только если она свободна.
pub fn migrate_keys(s: &mut Settings) -> bool {
    if s.keys_v2 {
        return false;
    }
    s.keys_v2 = true;
    if s.hotkey == "Alt+Q" {
        s.hotkey = "Alt+X".into();
        s.keys_moved = true;
    }
    if s.voice_hotkey == s.hotkey || s.voice_hotkey == s.editor_hotkey {
        s.voice_hotkey = String::new();
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn old_settings_move_window_key() {
        let mut s: Settings = serde_json::from_str(r#"{"hotkey":"Alt+Q","firstRunDone":true}"#).unwrap();
        assert!(!s.keys_v2);
        assert!(migrate_keys(&mut s));
        assert_eq!((s.hotkey.as_str(), s.voice_hotkey.as_str(), s.keys_moved), ("Alt+X", "Alt+Q", true));
        assert!(!migrate_keys(&mut s));
        // Свою клавишу окна игрок оставляет
        let mut s: Settings = serde_json::from_str(r#"{"hotkey":"F8"}"#).unwrap();
        migrate_keys(&mut s);
        assert_eq!((s.hotkey.as_str(), s.voice_hotkey.as_str(), s.keys_moved), ("F8", "Alt+Q", false));
        // Новая установка — уже по новой схеме
        let s = Settings::default();
        assert!(s.keys_v2 && s.hotkey == "Alt+X" && s.voice_hotkey == "Alt+Q");
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
