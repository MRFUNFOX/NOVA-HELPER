//! ИИ-помощник: запросы к Groq или Z.ai с ключом самого игрока.
//!
//! Groq закрыт для России, поэтому для игроков оттуда есть Z.ai (бесплатные модели GLM Flash).
//! Сервис определяется по самому ключу: у Groq он начинается с «gsk_».
//!
//! Ключ хранится только на компьютере игрока (файл ai.json рядом с настройками) и уходит
//! только в Groq. В интерфейс он не передаётся — интерфейс знает лишь, есть ли ключ, и его
//! последние 4 символа для подписи.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{fs, path::PathBuf, time::Duration};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Clone, Copy, PartialEq)]
enum Provider {
    Groq,
    Zai,
}

impl Provider {
    fn of(key: &str) -> Self {
        if key.starts_with("gsk_") { Provider::Groq } else { Provider::Zai }
    }
    fn name(self) -> &'static str {
        match self { Provider::Groq => "Groq", Provider::Zai => "Z.ai" }
    }
    fn api(self) -> &'static str {
        match self { Provider::Groq => "https://api.groq.com/openai/v1", Provider::Zai => "https://api.z.ai/api/paas/v4" }
    }
    /// Модели по порядку предпочтения. У каждой модели свой бесплатный лимит, поэтому
    /// при «лимит исчерпан» пробуем следующую. Только сильные: экзамен 28.11.2026 показал,
    /// что слабые запасные (gpt-oss-20b, llama-8b) уверенно отвечают неверно — лучше подождать лимит.
    fn answer_models(self) -> &'static [&'static str] {
        match self {
            Provider::Groq => &["openai/gpt-oss-120b", "qwen/qwen3.8-27b", "llama-3.3-70b-versatile"],
            Provider::Zai => &["glm-4.7-flash", "glm-4.5-flash"],
        }
    }
    /// Перепроверка ответа: у Groq — другая сильная модель со своим лимитом,
    /// чтобы не ждать, пока у основной освободится лимит после самого ответа
    fn check_models(self) -> &'static [&'static str] {
        match self {
            Provider::Groq => &["qwen/qwen3.8-27b", "openai/gpt-oss-120b", "llama-3.3-70b-versatile"],
            Provider::Zai => &["glm-4.7-flash", "glm-4.5-flash"],
        }
    }
    /// Для подбора ключевых слов хватает модели попроще — и лимит у неё отдельный
    fn helper_models(self) -> &'static [&'static str] {
        match self {
            Provider::Groq => &["openai/gpt-oss-20b", "qwen/qwen3.8-27b", "llama-3.1-8b-instant", "llama-3.3-70b-versatile", "openai/gpt-oss-120b"],
            Provider::Zai => &["glm-4.5-flash", "glm-4.7-flash"],
        }
    }
}

#[derive(Serialize, Deserialize, Default, Clone)]
#[serde(default, rename_all = "camelCase")]
struct Stored {
    /// Ключ нейросети, которая сейчас выбрана
    key: String,
    /// Модели, доступные ключу Groq (из ответа Groq при проверке)
    models: Vec<String>,
    /// Ключи обеих нейросетей — чтобы переключаться без повторного ввода
    groq: String,
    zai: String,
}

impl Stored {
    /// Старый файл хранил один ключ — раскладываем его по своей нейросети
    fn migrate(mut self) -> Self {
        if !self.key.is_empty() {
            match Provider::of(&self.key) {
                Provider::Groq if self.groq.is_empty() => self.groq = self.key.clone(),
                Provider::Zai if self.zai.is_empty() => self.zai = self.key.clone(),
                _ => {}
            }
        }
        self
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AiStatus {
    has_key: bool,
    /// «…a1B2» — чтобы игрок видел, какой ключ стоит
    key_hint: String,
    model: Option<String>,
    /// «Groq» или «Z.ai»
    provider: Option<String>,
    /// Для каких нейросетей ключ уже введён
    has_groq: bool,
    has_zai: bool,
}

fn path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("ai.json"))
}

fn load(app: &AppHandle) -> Stored {
    path(app).and_then(|p| fs::read_to_string(p).ok()).and_then(|s| serde_json::from_str::<Stored>(&s).ok()).unwrap_or_default().migrate()
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
    let p = Provider::of(&s.key);
    AiStatus {
        has_key,
        key_hint: if has_key { format!("…{}", &s.key[s.key.len().saturating_sub(4)..]) } else { String::new() },
        model: has_key.then(|| pick(p.answer_models(), &s.models)[0].to_string()),
        provider: has_key.then(|| p.name().to_string()),
        has_groq: !s.groq.is_empty(),
        has_zai: !s.zai.is_empty(),
    }
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(150))
        .user_agent(concat!("NOVA-HELPER/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())
}

/// Ошибка сети или ответа Groq — понятными словами
fn explain(p: Provider, status: Option<reqwest::StatusCode>, body: &str, net: Option<&reqwest::Error>) -> String {
    let n = p.name();
    // Groq закрыт для России — сразу подсказываем, что делать
    let other = if p == Provider::Groq { " Если вы в России или СНГ — подключите Z.ai: он бесплатный и работает там (Настройки → ИИ-помощник → «Сменить нейросеть»)." } else { "" };
    if let Some(e) = net {
        if e.is_timeout() {
            return format!("{n} долго не отвечает. Попробуйте ещё раз через минуту.");
        }
        return format!("Не удалось связаться с {n}. Проверьте интернет.{other}");
    }
    let msg = serde_json::from_str::<Value>(body).ok().and_then(|v| v["error"]["message"].as_str().map(String::from)).unwrap_or_default();
    match status.map(|s| s.as_u16()) {
        Some(401) => "Ключ не подходит. Скопируйте его ещё раз целиком.".into(),
        Some(403) if p == Provider::Groq => format!("Groq недоступен из вашей страны.{other}"),
        Some(403) => format!("{n} отказал в доступе{}", if msg.is_empty() { ".".into() } else { format!(": {msg}") }),
        Some(429 | 413) => format!("Бесплатный лимит {n} на сейчас исчерпан. Подождите минуту и спросите снова."),
        Some(code) if code >= 500 => format!("У {n} временные неполадки. Попробуйте чуть позже."),
        Some(code) => format!("{n} вернул ошибку {code}{}", if msg.is_empty() { String::new() } else { format!(": {msg}") }),
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
    // Вместо ключа скопировали ответ сайта: «{"error":{"message":"Forbidden"}}» — это блокировка Groq по стране
    if key.contains("error") || key.contains("Forbidden") || key.contains('{') {
        return Err("Это не ключ, а сообщение сайта об ошибке. «Forbidden» значит, что сайт недоступен из вашей страны: Groq не работает в России и СНГ — для них есть Z.ai.".into());
    }
    let p = Provider::of(&key);
    // Ключ Z.ai — длинный набор букв и цифр (обычно две части через точку)
    if p == Provider::Zai && key.len() < 20 {
        return Err("Это не похоже на ключ. У Groq он начинается с «gsk_», у Z.ai — длинный набор букв и цифр. Скопируйте ключ ещё раз.".into());
    }
    let http = client()?;
    let models: Vec<String> = match p {
        Provider::Groq => {
            let resp = http.get(format!("{}/models", p.api())).bearer_auth(&key).send().await.map_err(|e| explain(p, None, "", Some(&e)))?;
            let code = resp.status();
            let body = resp.text().await.unwrap_or_default();
            if !code.is_success() {
                return Err(explain(p, Some(code), &body, None));
            }
            serde_json::from_str::<Value>(&body)
                .ok()
                .and_then(|v| v["data"].as_array().map(|a| a.iter().filter_map(|m| m["id"].as_str().map(String::from)).collect()))
                .unwrap_or_default()
        }
        Provider::Zai => {
            // Списка моделей у Z.ai нет — проверяем ключ крошечным запросом
            let msgs = [Msg { role: "user".into(), content: "Ответь одним словом: ок".into() }];
            let resp = http.post(format!("{}/chat/completions", p.api())).bearer_auth(&key).json(&body(p, p.helper_models()[0], &msgs, false, false, 8, 0)).send().await.map_err(|e| explain(p, None, "", Some(&e)))?;
            let code = resp.status();
            let text = resp.text().await.unwrap_or_default();
            if !code.is_success() {
                return Err(explain(p, Some(code), &text, None));
            }
            Vec::new()
        }
    };
    let mut s = load(&app);
    match p {
        Provider::Groq => { s.groq = key.clone(); s.models = models; }
        Provider::Zai => s.zai = key.clone(),
    }
    s.key = key;
    store(&app, &s)?;
    Ok(status_of(&s))
}

/// Переключиться на другую нейросеть, ключ которой уже введён. `provider` — «groq» или «zai».
#[tauri::command]
pub fn ai_use(app: AppHandle, provider: String) -> Result<AiStatus, String> {
    let mut s = load(&app);
    let key = if provider == "zai" { s.zai.clone() } else { s.groq.clone() };
    if key.is_empty() {
        return Err("Для этой нейросети ещё нет ключа".into());
    }
    s.key = key;
    store(&app, &s)?;
    Ok(status_of(&s))
}

#[tauri::command]
pub fn ai_clear_key(app: AppHandle) -> Result<AiStatus, String> {
    // Удаляем ключ выбранной нейросети; если есть ключ другой — переключаемся на неё
    let mut s = load(&app);
    match Provider::of(&s.key) {
        Provider::Groq => { s.groq.clear(); s.models.clear(); }
        Provider::Zai => s.zai.clear(),
    }
    s.key = if !s.groq.is_empty() { s.groq.clone() } else { s.zai.clone() };
    store(&app, &s)?;
    Ok(status_of(&s))
}

#[derive(Clone, Deserialize)]
pub struct Msg {
    role: String,
    content: String,
}

/// think — ответ игроку: модель сначала рассуждает (разбирает ситуацию), потом отвечает. Для служебных запросов
/// (подбор документов, проверка ника) — без рассуждений: быстрее и не тратит лимит.
/// think: 0 — без рассуждений (служебные запросы), 1 — обычный вопрос, 2 — длинная ситуация или спор (думать глубже)
fn body(p: Provider, model: &str, messages: &[Msg], stream: bool, json_mode: bool, max_tokens: u32, think: u8) -> Value {
    let msgs: Vec<Value> = messages.iter().map(|m| json!({ "role": m.role, "content": m.content })).collect();
    let mut b = json!({ "model": model, "messages": msgs, "stream": stream, "temperature": if think > 0 { 0.3 } else { 0.2 }, "max_tokens": max_tokens });
    if p == Provider::Zai {
        b["thinking"] = json!({ "type": if think > 0 { "enabled" } else { "disabled" } });
    } else if model.starts_with("openai/gpt-oss") {
        // Рассуждения нужны, чтобы модель вдумалась в ситуацию; показываем их только команде.
        // «high» не используем: на бесплатном лимите модель тратит на раздумья всё и не успевает ответить
        b["reasoning_effort"] = json!(if think > 0 { "medium" } else { "low" });
        b["include_reasoning"] = json!(think > 0);
    } else if model.starts_with("qwen/") {
        // Без этого Qwen пишет раздумья прямо в ответ тегами <think>
        b["reasoning_format"] = json!(if think > 0 && !json_mode { "parsed" } else { "hidden" });
    }
    if json_mode {
        b["response_format"] = json!({ "type": "json_object" });
    }
    b
}

/// Короткий ответ целиком (JSON) — служебные шаги.
/// level: 0 — подбор слов, проверка ника (быстро, без рассуждений);
/// 1 — разбор ситуации перед поиском (модель-помощник думает);
/// 2 — проверка готового ответа и экзамен (сильная модель думает).
#[tauri::command]
pub async fn ai_complete(app: AppHandle, messages: Vec<Msg>, level: Option<u8>) -> Result<String, String> {
    let level = level.unwrap_or(0).min(2);
    let s = load(&app);
    if s.key.is_empty() {
        return Err("Помощник не настроен".into());
    }
    let p = Provider::of(&s.key);
    let http = client()?;
    let (models, think, max) = match level {
        0 => (p.helper_models(), 0, 600),
        1 => (p.helper_models(), 1, 1500),
        _ => (p.check_models(), 1, 2000),
    };
    let mut last = String::new();
    for model in pick(models, &s.models) {
        let resp = match http.post(format!("{}/chat/completions", p.api())).bearer_auth(&s.key).json(&body(p, model, &messages, false, true, max, think)).send().await {
            Ok(r) => r,
            Err(e) => return Err(explain(p, None, "", Some(&e))),
        };
        let code = resp.status();
        let text = resp.text().await.unwrap_or_default();
        if code.is_success() {
            let content = strip_think(
                &serde_json::from_str::<Value>(&text)
                    .ok()
                    .and_then(|v| v["choices"][0]["message"]["content"].as_str().map(String::from))
                    .unwrap_or_default(),
            );
            if !content.trim().is_empty() {
                return Ok(content);
            }
            // Модель всё время думала и не успела ответить — пробуем следующую
            last = format!("Пустой ответ {}", p.name());
            continue;
        }
        last = explain(p, Some(code), &text, None);
        // Лимит этой модели исчерпан, запрос ей велик или модель недоступна — пробуем следующую
        if !matches!(code.as_u16(), 429 | 413 | 404 | 400 | 503) {
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

/// Кусочек потока: текст ответа или рассуждение модели (Groq — `reasoning`, Z.ai — `reasoning_content`)
enum Delta {
    Text(String),
    Think(String),
}

/// Разобрать готовые строки потока «data: {…}» и вернуть кусочки текста
fn take_deltas(buf: &mut String) -> Vec<Delta> {
    let mut out = Vec::new();
    while let Some(nl) = buf.find('\n') {
        let line: String = buf.drain(..=nl).collect();
        let Some(data) = line.trim().strip_prefix("data:") else { continue };
        let data = data.trim();
        if data == "[DONE]" {
            continue;
        }
        if let Ok(v) = serde_json::from_str::<Value>(data) {
            let d = &v["choices"][0]["delta"];
            for key in ["reasoning", "reasoning_content"] {
                if let Some(t) = d[key].as_str().filter(|t| !t.is_empty()) {
                    out.push(Delta::Think(t.to_string()));
                }
            }
            if let Some(t) = d["content"].as_str().filter(|t| !t.is_empty()) {
                out.push(Delta::Text(t.to_string()));
            }
        }
    }
    out
}

/// Открытый поток ответа, в котором уже пришли первые слова
struct Opened {
    model: &'static str,
    resp: reqwest::Response,
    buf: String,
    first: Vec<Delta>,
}

/// Ошибка открытия потока: код ответа (если был) и понятное сообщение
/// Код ошибки, текст для игрока и сколько секунд просит подождать сервис (при 429)
type OpenErr = (Option<u16>, String, Option<f32>);

/// Отправить вопрос модели и дождаться первых слов ответа
async fn open_stream(http: &reqwest::Client, p: Provider, key: &str, model: &'static str, messages: &[Msg], think: u8) -> Result<Opened, OpenErr> {
    let mut resp = http
        .post(format!("{}/chat/completions", p.api()))
        .bearer_auth(key)
        .json(&body(p, model, messages, true, false, if think > 1 { 2600 } else { 2000 }, think))
        .send()
        .await
        .map_err(|e| (None, explain(p, None, "", Some(&e)), None))?;
    let code = resp.status();
    if !code.is_success() {
        let wait = retry_after(resp.headers());
        let text = resp.text().await.unwrap_or_default();
        return Err((Some(code.as_u16()), explain(p, Some(code), &text, None), wait.or_else(|| wait_in_text(&text))));
    }
    let mut buf = String::new();
    loop {
        match resp.chunk().await {
            Ok(Some(c)) => {
                buf.push_str(&String::from_utf8_lossy(&c));
                let first = take_deltas(&mut buf);
                if !first.is_empty() {
                    return Ok(Opened { model, resp, buf, first });
                }
            }
            // Поток закончился, а текста нет
            Ok(None) => return Err((Some(503), format!("Пустой ответ {}", p.name()), None)),
            Err(e) => return Err((None, explain(p, None, "", Some(&e)), None)),
        }
    }
}

/// Лимит исчерпан, запрос велик для лимита модели (413) или модель недоступна — можно попробовать другую
fn retryable(e: &OpenErr) -> bool {
    matches!(e.0, Some(429 | 413 | 404 | 400 | 503))
}

/// Столько секунд ждём лимит лучшей модели, прежде чем перейти на следующую
const MAX_WAIT: f32 = 20.0;
/// Все сильные модели упёрлись в лимит на минуту — столько ждём самую скорую, прежде чем сдаться
const MAX_WAIT_ALL: f32 = 65.0;

/// Заголовок retry-after (секунды)
fn retry_after(h: &reqwest::header::HeaderMap) -> Option<f32> {
    h.get("retry-after")?.to_str().ok()?.trim().parse::<f32>().ok()
}

/// «Please try again in 7.48s» / «in 1m2.5s» в тексте ошибки Groq
fn wait_in_text(text: &str) -> Option<f32> {
    let i = text.find("try again in ")? + "try again in ".len();
    let rest = &text[i..];
    let end = rest.find(|c: char| !(c.is_ascii_digit() || c == '.' || c == 'm' || c == 's')).unwrap_or(rest.len());
    let t = rest[..end].trim_end_matches('.');
    let (min, sec) = match t.split_once('m') {
        Some((m, s)) => (m.parse::<f32>().ok()?, s.trim_end_matches('s').parse::<f32>().unwrap_or(0.0)),
        None => (0.0, t.trim_end_matches('s').parse::<f32>().ok()?),
    };
    Some(min * 60.0 + sec)
}

/// Раздумья Qwen и других моделей тегами <think>…</think> — не часть ответа
fn strip_think(s: &str) -> String {
    let mut out = s.to_string();
    while let (Some(a), Some(b)) = (out.find("<think>"), out.find("</think>")) {
        if b < a { break; }
        out.replace_range(a..b + "</think>".len(), "");
    }
    out.trim().to_string()
}

#[derive(Serialize, Clone)]
struct Wait<'a> {
    id: &'a str,
    seconds: u32,
}

/// Ответ на вопрос: текст приходит по кусочкам событиями `ai-chunk`, по мере того как нейросеть его пишет.
/// Возвращает весь ответ и модель, которая отвечала.
///
/// У Z.ai бесплатные модели иногда подолгу стоят в очереди, поэтому спрашиваем две модели сразу
/// и берём ту, что начала отвечать первой; вторая отменяется.
#[tauri::command]
pub async fn ai_chat(app: AppHandle, id: String, messages: Vec<Msg>, deep: Option<bool>) -> Result<Value, String> {
    let think = if deep.unwrap_or(false) { 2 } else { 1 };
    let s = load(&app);
    if s.key.is_empty() {
        return Err("Помощник не настроен".into());
    }
    let p = Provider::of(&s.key);
    let http = client()?;
    let models = pick(p.answer_models(), &s.models);

    let opened: Result<Opened, String> = if p == Provider::Zai && models.len() >= 2 {
        let fa = open_stream(&http, p, &s.key, models[0], &messages, think);
        let fb = open_stream(&http, p, &s.key, models[1], &messages, think);
        tokio::pin!(fa);
        tokio::pin!(fb);
        let (mut a_done, mut b_done) = (false, false);
        let mut last = String::new();
        loop {
            tokio::select! {
                r = &mut fa, if !a_done => { a_done = true; match r { Ok(o) => break Ok(o), Err(e) => last = e.1 } }
                r = &mut fb, if !b_done => { b_done = true; match r { Ok(o) => break Ok(o), Err(e) => last = e.1 } }
                else => break Err(last),
            }
        }
    } else {
        let mut res = Err(String::new());
        let mut waited = false;
        let mut round2 = false;
        // Через сколько секунд освободится лимит самой скорой из моделей
        let mut soonest: Option<f32> = None;
        let mut i = 0;
        while i < models.len() {
            let model = models[i];
            match open_stream(&http, p, &s.key, model, &messages, think).await {
                Ok(o) => { res = Ok(o); break; }
                Err(e) => {
                    if e.0 == Some(429) {
                        if let Some(w) = e.2 { soonest = Some(soonest.map_or(w, |x| x.min(w))); }
                    }
                    // Лимит лучшей модели освободится через несколько секунд — лучше подождать, чем отвечать моделью слабее
                    if e.0 == Some(429) && !waited && i == 0 {
                        if let Some(w) = e.2.filter(|w| *w <= MAX_WAIT) {
                            waited = true;
                            let _ = app.emit("ai-wait", Wait { id: &id, seconds: w.ceil() as u32 });
                            tokio::time::sleep(Duration::from_secs_f32(w + 0.5)).await;
                            let _ = app.emit("ai-wait", Wait { id: &id, seconds: 0 });
                            continue;
                        }
                    }
                    let again = retryable(&e);
                    res = Err(e.1);
                    if !again { break; }
                }
            }
            i += 1;
            // Лимит на минуту у всех сильных моделей — ждём самую скорую и пробуем ещё круг
            if i == models.len() && !round2 {
                if let Some(w) = soonest.filter(|w| *w <= MAX_WAIT_ALL) {
                    round2 = true;
                    soonest = None;
                    let _ = app.emit("ai-wait", Wait { id: &id, seconds: w.ceil() as u32 });
                    tokio::time::sleep(Duration::from_secs_f32(w + 0.5)).await;
                    let _ = app.emit("ai-wait", Wait { id: &id, seconds: 0 });
                    i = 0;
                }
            }
        }
        res
    };
    let Opened { model, mut resp, mut buf, first } = opened?;

    let mut full = String::new();
    let mut thought = String::new();
    let mut send = |d: &Delta| match d {
        Delta::Text(t) => {
            full.push_str(t);
            let _ = app.emit("ai-chunk", Chunk { id: &id, delta: t });
        }
        Delta::Think(t) => {
            thought.push_str(t);
            let _ = app.emit("ai-think", Chunk { id: &id, delta: t });
        }
    };
    for d in &first {
        send(d);
    }
    loop {
        match resp.chunk().await {
            Ok(Some(c)) => {
                buf.push_str(&String::from_utf8_lossy(&c));
                for d in take_deltas(&mut buf) {
                    send(&d);
                }
            }
            Ok(None) => break,
            Err(e) => return Err(explain(p, None, "", Some(&e))),
        }
    }
    if full.trim().is_empty() {
        // Модель потратила всё на раздумья. Её раздумья уже есть — просим коротко ответить по ним, без новых раздумий
        let mut again = messages.clone();
        if !thought.trim().is_empty() {
            let t: String = thought.chars().rev().take(2500).collect::<Vec<_>>().into_iter().rev().collect();
            again.push(Msg { role: "assistant".into(), content: format!("(Мои черновые рассуждения: {t})") });
            again.push(Msg { role: "user".into(), content: "Хватит рассуждать. Дай итоговый ответ по правилам ответа, коротко.".into() });
        }
        let (text, used) = plain_answer(&app, &http, p, &s.key, &models, &again, &id).await
            .map_err(|_| format!("{} долго думала и не успела ответить. Спросите ещё раз или короче.", p.name()))?;
        let _ = app.emit("ai-chunk", Chunk { id: &id, delta: &text });
        return Ok(json!({ "text": text, "model": used, "reasoning": thought }));
    }
    Ok(json!({ "text": strip_think(&full), "model": model, "reasoning": thought }))
}

/// Ответ без раздумий и без потока — запасной путь, когда модель «задумалась» и не ответила
async fn plain_answer(app: &AppHandle, http: &reqwest::Client, p: Provider, key: &str, models: &[&'static str], messages: &[Msg], id: &str) -> Result<(String, &'static str), String> {
    let mut last = String::new();
    let mut waited = false;
    let mut i = 0;
    while i < models.len() {
        let model = models[i];
        let resp = http.post(format!("{}/chat/completions", p.api())).bearer_auth(key).json(&body(p, model, messages, false, false, 1200, 0)).send().await
            .map_err(|e| explain(p, None, "", Some(&e)))?;
        let code = resp.status();
        let wait = retry_after(resp.headers());
        let text = resp.text().await.unwrap_or_default();
        if code.is_success() {
            let content = strip_think(&serde_json::from_str::<Value>(&text).ok().and_then(|v| v["choices"][0]["message"]["content"].as_str().map(String::from)).unwrap_or_default());
            if !content.is_empty() {
                return Ok((content, model));
            }
        } else if code.as_u16() == 429 && !waited {
            if let Some(w) = wait.or_else(|| wait_in_text(&text)).filter(|w| *w <= MAX_WAIT) {
                waited = true;
                let _ = app.emit("ai-wait", Wait { id, seconds: w.ceil() as u32 });
                tokio::time::sleep(Duration::from_secs_f32(w + 0.5)).await;
                let _ = app.emit("ai-wait", Wait { id, seconds: 0 });
                continue;
            }
        }
        last = explain(p, Some(code), &text, None);
        i += 1;
    }
    Err(last)
}

#[cfg(test)]
mod think_tests {
    use super::{take_deltas, Delta};
    #[test]
    fn splits_thoughts_and_answer() {
        // Groq (gpt-oss): «reasoning», Z.ai (GLM): «reasoning_content», ответ — «content»
        let mut buf = String::from(concat!(
            "data: {\"choices\":[{\"delta\":{\"reasoning\":\"Игрок спрашивает про 8.3. \"}}]}\n",
            "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"Есть в двух документах.\"}}]}\n",
            "data: {\"choices\":[{\"delta\":{\"content\":\"Пункт 8.3 есть в двух местах\"}}]}\n",
            "data: [DONE]\n",
            "data: {\"choices\":[{\"delta\":{\"con"
        ));
        let d = take_deltas(&mut buf);
        let kinds: Vec<String> = d.iter().map(|x| match x { Delta::Think(t) => format!("думает: {t}"), Delta::Text(t) => format!("пишет: {t}") }).collect();
        assert_eq!(kinds, ["думает: Игрок спрашивает про 8.3. ", "думает: Есть в двух документах.", "пишет: Пункт 8.3 есть в двух местах"]);
        // Недописанная строка ждёт продолжения
        assert!(buf.starts_with("data: {\"choices\""));
    }

    #[test]
    fn wait_time_from_groq_text() {
        assert_eq!(super::wait_in_text("Rate limit reached... Please try again in 7.48s. Need more tokens?"), Some(7.48));
        assert_eq!(super::wait_in_text("Please try again in 1m2.5s."), Some(62.5));
        assert_eq!(super::wait_in_text("no hint here"), None);
    }

    #[test]
    fn think_tags_removed() {
        assert_eq!(super::strip_think("<think>хм, крыша</think>\n**Нет.** Запрещено."), "**Нет.** Запрещено.");
        assert_eq!(super::strip_think("Просто ответ"), "Просто ответ");
    }
}
