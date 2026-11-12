//! Анонимная статистика (Aptabase) — только если игрок разрешил при запуске или в настройках.
//!
//! Никаких ников, ключей, IP-адресов и идентификаторов устройства: каждое событие — это название,
//! пара чисел или слов и версия программы/Windows. Номер «сеанса» случайный и живёт до закрытия программы.

use serde_json::{json, Value};
use std::sync::OnceLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

/// Ключ приложения в Aptabase. Он не секретный — всё равно лежит внутри программы.
/// Пустой — статистика не отправляется вовсе.
const APP_KEY: &str = "A-EU-0587265149";

fn session() -> &'static str {
    static S: OnceLock<String> = OnceLock::new();
    S.get_or_init(|| {
        let d = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
        format!("{}{:08}", d.as_secs(), d.subsec_nanos() % 100_000_000)
    })
}

/// Текущее время в формате «2026-11-12T17:40:00Z»
fn now_rfc3339() -> String {
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() as i64;
    let (days, rem) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    // Перевод числа дней в дату (алгоритм Говарда Хиннанта)
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z", rem / 3600, rem % 3600 / 60, rem % 60)
}

#[tauri::command]
pub async fn stat(app: AppHandle, name: String, props: Option<Value>, locale: String, os_version: String) -> Result<(), String> {
    if APP_KEY.is_empty() || crate::settings::load(&app).analytics != Some(true) {
        return Ok(());
    }
    let base = if APP_KEY.contains("-US-") { "https://us.aptabase.com" } else { "https://eu.aptabase.com" };
    let props = match props {
        Some(Value::Object(m)) => Value::Object(m),
        _ => json!({}),
    };
    let ev = json!([{
        "timestamp": now_rfc3339(),
        "sessionId": session(),
        "eventName": name,
        "systemProps": {
            "isDebug": cfg!(debug_assertions),
            "osName": "Windows",
            "osVersion": os_version,
            "locale": locale,
            "appVersion": env!("CARGO_PKG_VERSION"),
            "sdkVersion": concat!("nova-helper@", env!("CARGO_PKG_VERSION")),
        },
        "props": props,
    }]);
    let http = reqwest::Client::builder().timeout(Duration::from_secs(10)).build().map_err(|e| e.to_string())?;
    // Статистика не должна мешать: ошибки отправки молча пропускаем
    let _ = http.post(format!("{base}/api/v0/events")).header("App-Key", APP_KEY).json(&ev).send().await;
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn time_format() {
        let t = super::now_rfc3339();
        assert_eq!(t.len(), 20);
        assert!(t.starts_with("20") && t.ends_with('Z'));
    }
}
