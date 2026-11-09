use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager};

/// Когда показывать подсказку о клавише в правом нижнем углу
#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum HintMode {
    /// Всегда, пока окно программы скрыто
    Always,
    /// 10 секунд после скрытия окна
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

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    /// Сочетание в формате плагина global-shortcut: «Alt+Q», «Ctrl+Shift+Space», «F9»
    pub hotkey: String,
    pub hint: HintMode,
    /// Крестик прячет программу в трей (клавиша продолжает работать), а не закрывает её
    pub close_to_tray: bool,
    pub first_run_done: bool,
    pub window: Option<WindowGeom>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            hotkey: "Alt+Q".into(),
            hint: HintMode::Always,
            close_to_tray: true,
            first_run_done: false,
            window: None,
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
