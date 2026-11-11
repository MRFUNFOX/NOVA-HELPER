//! ИИ-помощник: запросы к Groq с ключом самого игрока.
//!
//! Ключ хранится только на компьютере игрока (файл ai.json рядом с настройками) и уходит
//! только в Groq. В интерфейс он не передаётся — интерфейс знает лишь, есть ли ключ, и его
//! последние 4 символа для подписи.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{fs, path::PathBuf, time::Duration};
use tauri::{AppHandle, Emitter, Manager};

const API: &str = "https://api.groq.com/openai/v1";
/// Модели по порядку предпочтения. У каждой модели в Groq свой бесплатный лимит, поэтому
/// при «лимит исчерпан» пробуем следующую.
const ANSWER_MODELS: &[&str] = &["openai/gpt-oss-120b", "llama-3.3-70b-versatile", "openai/gpt-oss-20b", "llama-3.1-8b-instant"];
/// Для подбора ключевых слов хватает модели попроще — и лимит у неё отдельный
const HELPER_MODELS: &[&str] = &["openai/gpt-oss-20b", "llama-3.1-8b-instant", "llama-3.3-70b-versatile", "openai/gpt-oss-120b"];

#[derive(Serialize, Deserialize, Default, Clone)]
#[serde(default, rename_all = "camelCase")]
struct Stored {
    key: String,
    /// Модели, доступные этому ключу (из ответа Groq при проверке)
    models: Vec<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AiStatus {
    has_key: bool,
    /// «…a1B2» — чтобы игрок видел, какой ключ стоит
    key_hint: String,
    model: Option<String>,
}

fn path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("ai.json"))
}

fn load(app: &AppHandle) -> Stored {
    path(app).and_then(|p| fs::read_to_string(p).ok()).and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

fn store(app: &AppHandle, s: &Stored) -> Result<(), String> {
    let p = path(app).ok_or("Не найдена папка настроек")?;
    if let Some(dir) = p.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = p.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_vec(s).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &p).map_err(|e| e.to_string())
}

fn pick<'a>(prefs: &[&'a str], available: &[String]) -> Vec<&'a str> {
    let list: Vec<&str> = prefs.iter().copied().filter(|m| available.is_empty() || available.iter().any(|a| a == m)).collect();
    if list.is_empty() { prefs.to_vec() } else { list }
}

fn status_of(s: &Stored) -> AiStatus {
    let has_key = !s.key.is_empty();
    AiStatus {
        has_key,
        key_hint: if has_key { format!("…{}", &s.key[s.key.len().saturating_sub(4)..]) } else { String::new() },
        model: has_key.then(|| pick(ANSWER_MODELS, &s.models)[0].to_string()),
    }
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(90))
        .user_agent(concat!("NOVA-HELPER/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())
}

/// Ошибка сети или ответа Groq — понятными словами
fn explain(status: Option<reqwest::StatusCode>, body: &str, net: Option<&reqwest::Error>) -> String {
    if let Some(e) = net {
        if e.is_timeout() {
            return "Groq долго не отвечает. Попробуйте ещё раз через минуту.".into();
        }
        return "Не удалось связаться с Groq. Проверьте интернет. Если интернет есть — сервис может быть недоступен из вашей страны.".into();
    }
    let msg = serde_json::from_str::<Value>(body).ok().and_then(|v| v["error"]["message"].as_str().map(String::from)).unwrap_or_default();
    match status.map(|s| s.as_u16()) {
        Some(401) => "Ключ не подходит. Скопируйте его ещё раз целиком — он начинается с «gsk_».".into(),
        Some(403) => format!("Groq отказал в доступе{}. Возможно, сервис недоступен из вашей страны.", if msg.is_empty() { String::new() } else { format!(": {msg}") }),
        Some(429) => "Бесплатный лимит Groq на сейчас исчерпан. Подождите минуту и спросите снова.".into(),
        Some(code) if code >= 500 => "У Groq временные неполадки. Попробуйте чуть позже.".into(),
        Some(code) => format!("Groq вернул ошибку {code}{}", if msg.is_empty() { String::new() } else { format!(": {msg}") }),
        None => "Неизвестная ошибка".into(),
    }
}

#[tauri::command]
pub fn ai_status(app: AppHandle) -> AiStatus {
    status_of(&load(&app))
}

/// Проверить ключ пробным запросом и сохранить. Ключ не сохраняется, если не подошёл.
#[tauri::command]
pub async fn ai_set_key(app: AppHandle, key: String) -> Result<AiStatus, String> {
    // Частая ошибка: вместе с ключом скопировали пробелы, кавычки или подпись
    let key: String = key.trim().trim_matches(|c| c == '"' || c == '\'' || c == '«' || c == '»').chars().filter(|c| !c.is_whitespace()).collect();
    if key.is_empty() {
        return Err("Вставьте ключ в поле — сочетание Ctrl+V.".into());
    }
    if !key.starts_with("gsk_") {
        return Err("Это не похоже на ключ Groq: он начинается с «gsk_». Скопируйте ключ ещё раз на сайте Groq.".into());
    }
    let resp = client()?.get(format!("{API}/models")).bearer_auth(&key).send().await.map_err(|e| explain(None, "", Some(&e)))?;
    let code = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !code.is_success() {
        return Err(explain(Some(code), &body, None));
    }
    let models = serde_json::from_str::<Value>(&body)
        .ok()
        .and_then(|v| v["data"].as_array().map(|a| a.iter().filter_map(|m| m["id"].as_str().map(String::from)).collect()))
        .unwrap_or_default();
    let s = Stored { key, models };
    store(&app, &s)?;
    Ok(status_of(&s))
}

#[tauri::command]
pub fn ai_clear_key(app: AppHandle) -> Result<AiStatus, String> {
    let s = Stored::default();
    store(&app, &s)?;
    Ok(status_of(&s))
}

#[derive(Deserialize)]
pub struct Msg {
    role: String,
    content: String,
}

fn body(model: &str, messages: &[Msg], stream: bool, json_mode: bool, max_tokens: u32) -> Value {
    let msgs: Vec<Value> = messages.iter().map(|m| json!({ "role": m.role, "content": m.content })).collect();
    let mut b = json!({ "model": model, "messages": msgs, "stream": stream, "temperature": 0.2, "max_tokens": max_tokens });
    if model.starts_with("openai/gpt-oss") {
        // Рассуждения модели игроку не нужны, а «низкие» — быстрее и экономят лимит
        b["reasoning_effort"] = json!("low");
        b["include_reasoning"] = json!(false);
    }
    if json_mode {
        b["response_format"] = json!({ "type": "json_object" });
    }
    b
}

/// Короткий ответ целиком — для подбора ключевых слов к вопросу
#[tauri::command]
pub async fn ai_complete(app: AppHandle, messages: Vec<Msg>) -> Result<String, String> {
    let s = load(&app);
    if s.key.is_empty() {
        return Err("Помощник не настроен".into());
    }
    let http = client()?;
    let mut last = String::new();
    for model in pick(HELPER_MODELS, &s.models) {
        let resp = match http.post(format!("{API}/chat/completions")).bearer_auth(&s.key).json(&body(model, &messages, false, true, 300)).send().await {
            Ok(r) => r,
            Err(e) => return Err(explain(None, "", Some(&e))),
        };
        let code = resp.status();
        let text = resp.text().await.unwrap_or_default();
        if code.is_success() {
            return serde_json::from_str::<Value>(&text)
                .ok()
                .and_then(|v| v["choices"][0]["message"]["content"].as_str().map(String::from))
                .ok_or_else(|| "Пустой ответ Groq".to_string());
        }
        last = explain(Some(code), &text, None);
        // Лимит этой модели исчерпан или модель недоступна — пробуем следующую
        if !matches!(code.as_u16(), 429 | 404 | 400 | 503) {
            break;
        }
    }
    Err(last)
}

#[derive(Serialize, Clone)]
struct Chunk<'a> {
    id: &'a str,
    delta: &'a str,
}

/// Ответ на вопрос: текст приходит по кусочкам событиями `ai-chunk`, по мере того как Groq его пишет.
/// Возвращает весь ответ и модель, которая отвечала.
#[tauri::command]
pub async fn ai_chat(app: AppHandle, id: String, messages: Vec<Msg>) -> Result<Value, String> {
    let s = load(&app);
    if s.key.is_empty() {
        return Err("Помощник не настроен".into());
    }
    let http = client()?;
    let mut last = String::new();
    for model in pick(ANSWER_MODELS, &s.models) {
        let mut resp = match http.post(format!("{API}/chat/completions")).bearer_auth(&s.key).json(&body(model, &messages, true, false, 900)).send().await {
            Ok(r) => r,
            Err(e) => return Err(explain(None, "", Some(&e))),
        };
        let code = resp.status();
        if !code.is_success() {
            let text = resp.text().await.unwrap_or_default();
            last = explain(Some(code), &text, None);
            if matches!(code.as_u16(), 429 | 404 | 400 | 503) {
                continue;
            }
            return Err(last);
        }
        // Потоковый ответ: строки «data: {…}», конец — «data: [DONE]»
        let mut full = String::new();
        let mut buf = String::new();
        loop {
            let chunk = match resp.chunk().await {
                Ok(Some(c)) => c,
                Ok(None) => break,
                Err(e) => return Err(explain(None, "", Some(&e))),
            };
            buf.push_str(&String::from_utf8_lossy(&chunk));
            while let Some(nl) = buf.find('\n') {
                let line: String = buf.drain(..=nl).collect();
                let line = line.trim();
                let Some(data) = line.strip_prefix("data:") else { continue };
                let data = data.trim();
                if data == "[DONE]" {
                    continue;
                }
                if let Ok(v) = serde_json::from_str::<Value>(data) {
                    if let Some(d) = v["choices"][0]["delta"]["content"].as_str() {
                        if !d.is_empty() {
                            full.push_str(d);
                            let _ = app.emit("ai-chunk", Chunk { id: &id, delta: d });
                        }
                    }
                }
            }
        }
        return Ok(json!({ "text": full, "model": model }));
    }
    Err(last)
}
