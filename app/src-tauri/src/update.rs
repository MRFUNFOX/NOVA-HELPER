//! Обновление программы с выбранного выпуска.
//!
//! Обычная проверка плагина смотрит только «последний» выпуск GitHub. А тестовые сборки (pre-release)
//! и версии, которые команда открыла игрокам кнопкой «Опубликовать для всех», лежат по своему адресу:
//! github.com/MRFUNFOX/NOVA-HELPER/releases/download/v<версия>/latest.json. Эти команды проверяют
//! и ставят обновление с такого адреса. Подпись установщика проверяется так же, как обычно.
use tauri::{AppHandle, Emitter, Url};
use tauri_plugin_updater::UpdaterExt;

const ALLOWED: &str = "https://github.com/MRFUNFOX/NOVA-HELPER/releases/download/";

#[derive(serde::Serialize)]
pub struct Found {
    version: String,
    notes: Option<String>,
}

fn updater(app: &AppHandle, url: &str) -> Result<tauri_plugin_updater::Updater, String> {
    // Только выпуски нашей программы — чужой адрес не примем
    if !url.starts_with(ALLOWED) || !url.ends_with("/latest.json") {
        return Err("Неверный адрес обновления".into());
    }
    let url: Url = url.parse().map_err(|e| format!("{e}"))?;
    app.updater_builder()
        .endpoints(vec![url])
        .and_then(|b| b.build())
        .map_err(|e| e.to_string())
}

/// Есть ли по адресу версия новее установленной
#[tauri::command]
pub async fn update_check(app: AppHandle, url: String) -> Result<Option<Found>, String> {
    let u = updater(&app, &url)?.check().await.map_err(|e| e.to_string())?;
    Ok(u.map(|u| Found { version: u.version, notes: u.body }))
}

/// Скачать, поставить и перезапустить. Ход скачивания — событием «update-progress» (0…1)
#[tauri::command]
pub async fn update_install(app: AppHandle, url: String) -> Result<(), String> {
    let u = updater(&app, &url)?
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or("Эта версия уже стоит")?;
    let mut got: u64 = 0;
    let h = app.clone();
    u.download_and_install(
        move |chunk, total| {
            got += chunk as u64;
            if let Some(t) = total.filter(|t| *t > 0) {
                let _ = h.emit("update-progress", got as f64 / t as f64);
            }
        },
        || {},
    )
    .await
    .map_err(|e| e.to_string())?;
    app.restart();
}
