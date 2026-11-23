//! Проверка ника: встречается ли имя / фамилия в жизни. Правило 2.13 ОП NOVA RP само советует
//! проверять ник на forebears.io — программа делает то же самое за игрока: открывает страницу имени
//! и читает «Approximately N people bear this surname/forename».
use std::time::Duration;

/// Сколько людей носят имя (`forenames`) или фамилию (`surnames`). None — сайт не ответил;
/// Some(0) — такого имени в базе нет.
#[tauri::command]
pub async fn name_count(kind: String, name: String) -> Result<Option<u64>, String> {
    if kind != "forenames" && kind != "surnames" {
        return Err("Неверный вид имени".into());
    }
    let name = name.trim().to_lowercase();
    if name.is_empty() || name.len() > 30 || !name.chars().all(|c| c.is_ascii_alphabetic()) {
        return Ok(Some(0));
    }
    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) NOVA-HELPER")
        .build()
        .map_err(|e| e.to_string())?;
    let Ok(r) = http.get(format!("https://forebears.io/{kind}/{name}")).send().await else {
        return Ok(None);
    };
    if r.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(Some(0));
    }
    if !r.status().is_success() {
        return Ok(None);
    }
    let Ok(html) = r.text().await else { return Ok(None) };
    Ok(Some(parse_count(&html)))
}

/// «Approximately 584,743 people bear this surname» → 584743; нет фразы — 0
fn parse_count(html: &str) -> u64 {
    let Some(i) = html.find("people bear this") else { return 0 };
    let head = &html[..i];
    let Some(j) = head.rfind("Approximately") else { return 0 };
    // Цифры между словами, без HTML-тегов (в классах тегов тоже бывают цифры)
    let mut inside = false;
    let mut digits = String::new();
    for c in head[j + "Approximately".len()..].chars() {
        match c {
            '<' => inside = true,
            '>' => inside = false,
            d if !inside && d.is_ascii_digit() => digits.push(d),
            _ => {}
        }
    }
    digits.parse().unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::parse_count;
    #[test]
    fn reads_count() {
        assert_eq!(parse_count("<p>Approximately <b>584,743</b> people bear this surname</p>"), 584_743);
        assert_eq!(parse_count("<p>No results</p>"), 0);
        assert_eq!(parse_count("Approximately <span class=\"n2\">4,886</span> people bear this surname"), 4_886);
    }
}
