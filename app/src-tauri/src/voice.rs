//! Голосовой вопрос к ИИ: зажал клавишу — говоришь — отпустил.
//!
//! Всё работает на компьютере игрока, без ключей и серверов:
//!  • запись с микрофона — cpal;
//!  • шумоподавление — GTCRN, распознавание русской речи — GigaAM v2 (Сбер, MIT) через sherpa-onnx;
//!  • озвучка ответа — Piper «Денис» (CC0) через sherpa-onnx. Как произносить слова, подсказывает eSpeak NG —
//!    это отдельная программа (GPL-3.0): мы запускаем espeak-ng.exe и читаем ответ, а не встраиваем её.
//! Модели (~300 МБ) скачиваются один раз из выпуска `voice-models` нашего GitHub.
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde::Serialize;
use sha2::{Digest, Sha256};
use sherpa_onnx::{
    GenerationConfig, LinearResampler, OfflineRecognizer, OfflineRecognizerConfig, OfflineSpeechDenoiser,
    OfflineSpeechDenoiserConfig, OfflineTts, OfflineTtsConfig,
};
use std::{
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU32, AtomicU64, AtomicUsize, Ordering},
        mpsc, Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager};

use crate::settings;

const BASE: &str = "https://github.com/MRFUNFOX/NOVA-HELPER/releases/download/voice-models";
/// Наборы файлов: распознавание, голос, eSpeak
const PACKS: [&str; 3] = ["asr", "tts-denis", "espeak"];
/// Дольше — останавливаем запись сами
const MAX_SECONDS: f32 = 30.0;

#[derive(Default)]
pub struct VoiceState {
    rec: Mutex<Option<Recorder>>,
    asr: Mutex<Option<Arc<(OfflineRecognizer, Option<OfflineSpeechDenoiser>)>>>,
    tts: Mutex<Option<Arc<OfflineTts>>>,
    /// Номер озвучки: новая озвучка или «стоп» увеличивают его, старая видит это и замолкает
    say_gen: Arc<AtomicU64>,
    installing: AtomicBool,
}

struct Recorder {
    stop: mpsc::Sender<()>,
    done: mpsc::Receiver<(Vec<f32>, u32)>,
}

fn dir(app: &AppHandle) -> PathBuf {
    app.path().app_local_data_dir().unwrap_or_else(|_| std::env::temp_dir()).join("voice")
}

fn installed(app: &AppHandle) -> bool {
    let d = dir(app);
    d.join("asr/model.int8.onnx").exists() && d.join("tts-denis/model.onnx").exists() && d.join(exe_name()).exists()
}

fn exe_name() -> &'static str {
    if cfg!(windows) { "espeak/espeak-ng.exe" } else { "espeak/espeak-ng" }
}

#[derive(Serialize)]
pub struct VoiceStatus {
    installed: bool,
    installing: bool,
    /// Сколько займут модели (МБ), чтобы предупредить перед скачиванием
    size_mb: u32,
}

#[tauri::command]
pub fn voice_status(app: AppHandle) -> VoiceStatus {
    VoiceStatus { installed: installed(&app), installing: app.state::<VoiceState>().installing.load(Ordering::Relaxed), size_mb: 235 }
}

// ── Установка моделей ──

#[derive(Serialize, Clone)]
struct InstallProgress {
    /// Какой набор качаем: asr, tts-denis, espeak; «unpack» — распаковка
    stage: String,
    done: u64,
    total: u64,
}

#[tauri::command]
pub async fn voice_install(app: AppHandle) -> Result<(), String> {
    let st = app.state::<VoiceState>();
    if st.installing.swap(true, Ordering::SeqCst) {
        return Err("Уже скачиваю".into());
    }
    let r = install(&app).await;
    st.installing.store(false, Ordering::SeqCst);
    if r.is_err() {
        let _ = app.emit("voice-install", InstallProgress { stage: "error".into(), done: 0, total: 0 });
    }
    r
}

async fn install(app: &AppHandle) -> Result<(), String> {
    let http = reqwest::Client::builder().timeout(Duration::from_secs(60 * 20)).build().map_err(|e| e.to_string())?;
    let list: serde_json::Value = http.get(format!("{BASE}/voice.json")).send().await.map_err(net)?.error_for_status().map_err(net)?.json().await.map_err(net)?;
    let root = dir(app);
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    // Что уже стоит (контрольные суммы наборов): одинаковые не качаем — обновление моделей докачивает только изменённое
    let have_path = root.join("installed.json");
    let mut have: serde_json::Map<String, serde_json::Value> =
        std::fs::read_to_string(&have_path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    let fresh = |pack: &str, have: &serde_json::Map<String, serde_json::Value>| {
        have.get(pack).and_then(|v| v.as_str()) == list["files"][pack]["sha256"].as_str() && root.join(pack).exists()
    };
    let need: Vec<&str> = PACKS.iter().copied().filter(|p| !fresh(p, &have)).collect();
    if need.is_empty() {
        let _ = app.emit("voice-install", InstallProgress { stage: "done".into(), done: 0, total: 0 });
        return Ok(());
    }
    let total: u64 = need.iter().map(|p| list["files"][p]["size"].as_u64().unwrap_or(0)).sum();
    let mut done_before = 0u64;
    for pack in need {
        let info = &list["files"][pack];
        let (Some(file), Some(sha)) = (info["file"].as_str(), info["sha256"].as_str()) else {
            return Err(format!("В описании моделей нет «{pack}»"));
        };
        let size = info["size"].as_u64().unwrap_or(0);
        let tmp = root.join(format!("{pack}.zip.part"));
        let mut out = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
        let mut resp = http.get(format!("{BASE}/{file}")).send().await.map_err(net)?.error_for_status().map_err(net)?;
        let mut hasher = Sha256::new();
        let mut got = 0u64;
        let mut last = Instant::now();
        while let Some(chunk) = resp.chunk().await.map_err(net)? {
            out.write_all(&chunk).map_err(|e| e.to_string())?;
            hasher.update(&chunk);
            got += chunk.len() as u64;
            if last.elapsed() > Duration::from_millis(150) {
                last = Instant::now();
                let _ = app.emit("voice-install", InstallProgress { stage: pack.into(), done: done_before + got, total });
            }
        }
        drop(out);
        if got != size || format!("{:x}", hasher.finalize()) != sha {
            let _ = std::fs::remove_file(&tmp);
            return Err("Файл скачался не полностью. Проверьте интернет и попробуйте ещё раз.".into());
        }
        done_before += size;
        let _ = app.emit("voice-install", InstallProgress { stage: "unpack".into(), done: done_before, total });
        // Распаковываем рядом и только потом подменяем: пока качается обновление, старый голос продолжает работать
        let target = root.join(pack);
        let staged = root.join(format!("{pack}.new"));
        let _ = std::fs::remove_dir_all(&staged);
        let (tmp2, staged2) = (tmp.clone(), staged.clone());
        tokio::task::spawn_blocking(move || unzip(&tmp2, &staged2)).await.map_err(|e| e.to_string())??;
        let _ = std::fs::remove_file(&tmp);
        {
            // Загруженные модели держат файлы — отпускаем, при следующем вопросе загрузятся новые
            let st = app.state::<VoiceState>();
            *st.asr.lock().unwrap() = None;
            *st.tts.lock().unwrap() = None;
        }
        let _ = std::fs::remove_dir_all(&target);
        std::fs::rename(&staged, &target).map_err(|e| e.to_string())?;
        have.insert(pack.into(), serde_json::Value::String(sha.into()));
        let _ = std::fs::write(&have_path, serde_json::Value::Object(have.clone()).to_string());
    }
    let _ = app.emit("voice-install", InstallProgress { stage: "done".into(), done: total, total });
    Ok(())
}

fn net(e: reqwest::Error) -> String {
    if e.is_timeout() || e.is_connect() { "Нет связи с GitHub. Проверьте интернет и попробуйте ещё раз.".into() } else { format!("Не удалось скачать модели: {e}") }
}

fn unzip(file: &Path, to: &Path) -> Result<(), String> {
    let f = std::fs::File::open(file).map_err(|e| e.to_string())?;
    let mut z = zip::ZipArchive::new(f).map_err(|e| e.to_string())?;
    z.extract(to).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn voice_remove(app: AppHandle) -> Result<(), String> {
    let st = app.state::<VoiceState>();
    *st.asr.lock().unwrap() = None;
    *st.tts.lock().unwrap() = None;
    let d = dir(&app);
    if d.exists() {
        std::fs::remove_dir_all(d).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ── Устройства ──

#[derive(Serialize)]
pub struct Devices {
    inputs: Vec<String>,
    outputs: Vec<String>,
}

#[tauri::command]
pub fn voice_devices() -> Devices {
    let host = cpal::default_host();
    let names = |it: Result<Vec<cpal::Device>, String>| it.unwrap_or_default().iter().filter_map(|d| d.name().ok()).collect();
    Devices {
        inputs: names(host.input_devices().map(|d| d.collect()).map_err(|e| e.to_string())),
        outputs: names(host.output_devices().map(|d| d.collect()).map_err(|e| e.to_string())),
    }
}

fn find_device(input: bool, name: Option<&str>) -> Option<cpal::Device> {
    let host = cpal::default_host();
    if let Some(n) = name {
        let list: Option<Vec<cpal::Device>> = if input { host.input_devices().ok().map(|d| d.collect()) } else { host.output_devices().ok().map(|d| d.collect()) };
        if let Some(d) = list.and_then(|l| l.into_iter().find(|d| d.name().ok().as_deref() == Some(n))) {
            return Some(d);
        }
    }
    if input { host.default_input_device() } else { host.default_output_device() }
}

// ── Запись по клавише ──

#[derive(Serialize, Clone)]
struct Stage {
    /// listen — слушаю, think — распознаю, idle — всё, missing — модели не скачаны, error
    stage: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

/// Клавиша голоса нажата
pub fn key_down(app: &AppHandle) {
    let st = app.state::<VoiceState>();
    crate::pins::voice_layer(app, true);
    if !installed(app) {
        // Голос ещё скачивается в фоне — так и скажем, а не «не установлен»
        let busy = st.installing.load(Ordering::Relaxed);
        let _ = app.emit("voice", Stage { stage: "missing", text: None, error: busy.then(|| "installing".to_string()) });
        return;
    }
    let mut rec = st.rec.lock().unwrap();
    if rec.is_some() {
        return; // клавиша «залипла» и повторяется — уже пишем
    }
    // Новый вопрос — прежний ответ замолкает
    st.say_gen.fetch_add(1, Ordering::SeqCst);
    match start_recording(app) {
        Ok(r) => {
            *rec = Some(r);
            let _ = app.emit("voice", Stage { stage: "listen", text: None, error: None });
        }
        Err(e) => {
            let _ = app.emit("voice", Stage { stage: "error", text: None, error: Some(e) });
        }
    }
}

/// Клавиша голоса отпущена: останавливаем запись и распознаём
pub fn key_up(app: &AppHandle) {
    let Some(r) = app.state::<VoiceState>().rec.lock().unwrap().take() else { return };
    let _ = r.stop.send(());
    let _ = app.emit("voice", Stage { stage: "think", text: None, error: None });
    let app = app.clone();
    std::thread::spawn(move || {
        let result = r.done.recv_timeout(Duration::from_secs(3)).map_err(|_| "Микрофон не ответил".to_string()).and_then(|(samples, rate)| recognize(&app, &samples, rate));
        match result {
            Ok(text) if !text.trim().is_empty() => {
                let _ = app.emit("voice", Stage { stage: "heard", text: Some(text), error: None });
            }
            Ok(_) => {
                let _ = app.emit("voice", Stage { stage: "error", text: None, error: Some("Не расслышал — скажите ещё раз".into()) });
            }
            Err(e) => {
                let _ = app.emit("voice", Stage { stage: "error", text: None, error: Some(e) });
            }
        }
    });
}

fn start_recording(app: &AppHandle) -> Result<Recorder, String> {
    let s = settings::load(app);
    let (stop_tx, stop_rx) = mpsc::channel::<()>();
    let (done_tx, done_rx) = mpsc::channel::<(Vec<f32>, u32)>();
    let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();
    let app = app.clone();
    // Поток записи владеет потоком cpal (его нельзя передавать между потоками)
    std::thread::spawn(move || {
        let Some(dev) = find_device(true, s.voice_input.as_deref()) else {
            let _ = ready_tx.send(Err("Микрофон не найден — подключите его и попробуйте ещё раз".into()));
            return;
        };
        let cfg = match dev.default_input_config() {
            Ok(c) => c,
            Err(_) => {
                let _ = ready_tx.send(Err("Микрофон занят другой программой или выключен в Windows".into()));
                return;
            }
        };
        let ch = cfg.channels() as usize;
        let rate = cfg.sample_rate().0;
        let buf = Arc::new(Mutex::new(Vec::<f32>::with_capacity(rate as usize * 10)));
        let level = Arc::new(AtomicU32::new(0));
        let push = {
            let buf = buf.clone();
            let level = level.clone();
            move |mono: &mut dyn Iterator<Item = f32>| {
                let mut b = buf.lock().unwrap();
                let start = b.len();
                b.extend(mono);
                let part = &b[start..];
                if !part.is_empty() {
                    let rms = (part.iter().map(|x| x * x).sum::<f32>() / part.len() as f32).sqrt();
                    level.store(rms.to_bits(), Ordering::Relaxed);
                }
            }
        };
        let err = |e| eprintln!("микрофон: {e}");
        let stream = match cfg.sample_format() {
            cpal::SampleFormat::F32 => {
                dev.build_input_stream(&cfg.into(), move |d: &[f32], _| push(&mut d.chunks(ch).map(|f| f.iter().sum::<f32>() / ch as f32)), err, None)
            }
            cpal::SampleFormat::I16 => {
                dev.build_input_stream(&cfg.into(), move |d: &[i16], _| push(&mut d.chunks(ch).map(|f| f.iter().map(|&x| x as f32 / 32768.0).sum::<f32>() / ch as f32)), err, None)
            }
            cpal::SampleFormat::U16 => {
                dev.build_input_stream(&cfg.into(), move |d: &[u16], _| push(&mut d.chunks(ch).map(|f| f.iter().map(|&x| (x as f32 - 32768.0) / 32768.0).sum::<f32>() / ch as f32)), err, None)
            }
            _ => {
                let _ = ready_tx.send(Err("Этот микрофон не поддерживается".into()));
                return;
            }
        };
        let stream = match stream.map_err(|e| e.to_string()).and_then(|s| s.play().map(|_| s).map_err(|e| e.to_string())) {
            Ok(s) => s,
            Err(_) => {
                let _ = ready_tx.send(Err("Нет доступа к микрофону: Параметры Windows → Конфиденциальность → Микрофон → разрешить классическим приложениям".into()));
                return;
            }
        };
        let _ = ready_tx.send(Ok(()));
        let started = Instant::now();
        // Пока держат клавишу — шлём громкость для полосок на плашке
        loop {
            match stop_rx.recv_timeout(Duration::from_millis(70)) {
                Ok(()) | Err(mpsc::RecvTimeoutError::Disconnected) => break,
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    let lvl = f32::from_bits(level.load(Ordering::Relaxed));
                    let _ = app.emit("voice-level", (lvl * 6.0).min(1.0));
                    if started.elapsed().as_secs_f32() > MAX_SECONDS {
                        // Забыли отпустить — останавливаем сами
                        let a = app.clone();
                        std::thread::spawn(move || key_up(&a));
                    }
                }
            }
        }
        drop(stream);
        let samples = std::mem::take(&mut *buf.lock().unwrap());
        let _ = done_tx.send((samples, rate));
    });
    ready_rx.recv_timeout(Duration::from_secs(3)).map_err(|_| "Микрофон не ответил".to_string())??;
    Ok(Recorder { stop: stop_tx, done: done_rx })
}

fn recognize(app: &AppHandle, samples: &[f32], rate: u32) -> Result<String, String> {
    if (samples.len() as f32) < rate as f32 * 0.4 {
        return Err("Слишком коротко — держите клавишу, пока говорите".into());
    }
    let models = asr(app)?;
    let (rec, den) = &*models;
    // Шумоподавление: голоса и звуки вдали глушатся, голос у микрофона остаётся
    let clean = den.as_ref().map(|d| d.run(samples, rate as i32));
    let (s, r) = match &clean {
        Some(c) => (c.samples.as_slice(), c.sample_rate),
        None => (samples, rate as i32),
    };
    let stream = rec.create_stream();
    stream.accept_waveform(r, s);
    rec.decode(&stream);
    Ok(stream.get_result().map(|x| x.text).unwrap_or_default())
}

fn threads() -> i32 {
    std::thread::available_parallelism().map(|n| (n.get() / 2).clamp(1, 4) as i32).unwrap_or(2)
}

fn asr(app: &AppHandle) -> Result<Arc<(OfflineRecognizer, Option<OfflineSpeechDenoiser>)>, String> {
    let st = app.state::<VoiceState>();
    let mut g = st.asr.lock().unwrap();
    if let Some(a) = g.as_ref() {
        return Ok(a.clone());
    }
    let d = dir(app).join("asr");
    let p = |f: &str| Some(d.join(f).to_string_lossy().into_owned());
    let mut rc = OfflineRecognizerConfig::default();
    rc.model_config.nemo_ctc.model = p("model.int8.onnx");
    rc.model_config.tokens = p("tokens.txt");
    rc.model_config.num_threads = threads();
    let rec = OfflineRecognizer::create(&rc).ok_or("Модель распознавания не загрузилась — переустановите голос в настройках")?;
    let mut dc = OfflineSpeechDenoiserConfig::default();
    dc.model.gtcrn.model = p("gtcrn_simple.onnx");
    dc.model.num_threads = 1;
    let den = OfflineSpeechDenoiser::create(&dc);
    let a = Arc::new((rec, den));
    *g = Some(a.clone());
    Ok(a)
}

// ── Озвучка ──

fn tts(app: &AppHandle) -> Result<Arc<OfflineTts>, String> {
    let st = app.state::<VoiceState>();
    let mut g = st.tts.lock().unwrap();
    if let Some(t) = g.as_ref() {
        return Ok(t.clone());
    }
    let d = dir(app).join("tts-denis");
    let mut c = OfflineTtsConfig::default();
    c.model.vits.model = Some(d.join("model.onnx").to_string_lossy().into_owned());
    c.model.vits.tokens = Some(d.join("tokens.txt").to_string_lossy().into_owned());
    c.model.vits.noise_scale = 0.667;
    c.model.vits.noise_scale_w = 0.8;
    c.model.vits.length_scale = 1.0;
    c.model.num_threads = threads();
    let t = Arc::new(OfflineTts::create(&c).ok_or("Голос не загрузился — переустановите голос в настройках")?);
    *g = Some(t.clone());
    Ok(t)
}

/// Слова, которые eSpeak прочитал бы по-английски или по буквам
fn speakable(text: &str) -> String {
    use regex::Regex;
    use std::sync::LazyLock;
    // Числа: точка внутри номера пункта — не конец фразы («4.1» → «4 точка 1», «1.4.2» → «1 точка 4 точка 2»);
    // «п.4.1» → «пункт 4.1»; «от 10–15» → «от 10 до 15»; «1,5» → «1 целых 5»
    static ABBR: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)(^|[^\p{L}])(п|ст|ч)\.\s*(\d)").unwrap());
    static DOT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(\d)\.(\d)").unwrap());
    static RANGE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(^|[^\p{L}\d])(от\s+)?(\d+)\s*[-–—]\s*(\d+)").unwrap());
    static COMMA: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(\d),(\d)").unwrap());
    let mut t = ABBR
        .replace_all(text, |c: &regex::Captures| {
            let w = match c[2].to_lowercase().as_str() { "п" => "пункт", "ст" => "статья", _ => "часть" };
            format!("{}{w} {}", &c[1], &c[3])
        })
        .into_owned();
    while DOT.is_match(&t) {
        t = DOT.replace_all(&t, "$1 точка $2").into_owned();
    }
    // «от 10–15» → «от 10 до 15»; «на 10–15» → «на 10, 15» (так и говорят вслух)
    t = RANGE
        .replace_all(&t, |c: &regex::Captures| {
            if c.get(2).is_some() { format!("{}от {} до {}", &c[1], &c[3], &c[4]) } else { format!("{}{}, {}", &c[1], &c[3], &c[4]) }
        })
        .into_owned();
    t = COMMA.replace_all(&t, "$1 целых $2").into_owned();
    let mut t = format!(" {t} ");
    for (a, b) in [
        ("JAIL", "джейл"), ("Jail", "джейл"), ("WARN", "варн"), ("Warn", "варн"), ("BAN", "бан"), ("Ban", "бан"), ("MUTE", "мут"),
        ("DM", "ди-эм"), ("RK", "эр-ка"), ("PG", "пэ-гэ"), ("MG", "эм-гэ"), ("NonRP", "нон-эр-пэ"), ("RP", "эр-пэ"), ("ООС", "о-о-эс"), ("OOC", "о-о-эс"), ("IC", "ай-си"),
        (" п. ", " пункт "), (" ст. ", " статья "), (" ч. ", " часть "), ("$", " долларов "),
    ] {
        t = t.replace(a, b);
    }
    t.trim().to_string()
}

/// Текст → фонемы Piper: каждую фразу отдельно спрашиваем у eSpeak, знаки препинания сохраняем (паузы и интонация)
fn phonemes(app: &AppHandle, text: &str) -> Result<Vec<Vec<i32>>, String> {
    let espeak = dir(app).join("espeak");
    let exe = dir(app).join(exe_name());
    let ask = |clause: &str| -> Result<String, String> {
        // Текст — через stdin в UTF-8, папка данных — относительно: в аргументах Windows портит кириллицу
        // (кодовая страница 1251), а путь к папке пользователя бывает русским.
        let mut cmd = Command::new(&exe);
        cmd.current_dir(&espeak)
            .args(["-q", "-v", "ru", "--ipa", "--path=.", "--stdin"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000); // без чёрного окна консоли
        }
        let fail = || "eSpeak не запустился — переустановите голос в настройках".to_string();
        let mut child = cmd.spawn().map_err(|_| fail())?;
        if let Some(mut inp) = child.stdin.take() {
            let _ = inp.write_all(clause.as_bytes());
            let _ = inp.write_all(b"\n");
        }
        let out = child.wait_with_output().map_err(|_| fail())?;
        let s = String::from_utf8_lossy(&out.stdout);
        // Метки смены языка «(en)…(ru)» — служебные
        let mut clean = String::new();
        let mut skip = false;
        for c in s.chars() {
            match c {
                '(' => skip = true,
                ')' => skip = false,
                _ if !skip => clean.push(c),
                _ => {}
            }
        }
        // eSpeak 1.52 читает цифру «1» как «ойдин» (1, 21, 101…) — правим на обычное «один»
        let clean = clean.replace("ojdʲˈin", "ʌdʲˈin");
        Ok(clean.split_whitespace().collect::<Vec<_>>().join(" "))
    };
    let mut sentences = Vec::new();
    let mut cur = String::new();
    let mut clause = String::new();
    let flush = |clause: &mut String, punct: Option<char>, cur: &mut String| -> Result<(), String> {
        let t = clause.trim().to_string();
        clause.clear();
        if !t.is_empty() {
            let ph = ask(&t)?;
            if !cur.is_empty() && !ph.is_empty() {
                cur.push(' ');
            }
            cur.push_str(&ph);
        }
        if let Some(p) = punct {
            cur.push(p);
        }
        Ok(())
    };
    for c in speakable(text).chars() {
        match c {
            ',' | ';' | ':' | '—' | '–' => flush(&mut clause, Some(if matches!(c, '—' | '–') { ',' } else { c }), &mut cur)?,
            '.' | '!' | '?' | '\n' => {
                flush(&mut clause, if c == '\n' { Some('.') } else { Some(c) }, &mut cur)?;
                if !cur.trim().is_empty() {
                    sentences.push(cur.chars().map(|c| c as i32).collect());
                }
                cur.clear();
            }
            _ => clause.push(c),
        }
    }
    flush(&mut clause, None, &mut cur)?;
    if !cur.trim().is_empty() {
        sentences.push(cur.chars().map(|c| c as i32).collect());
    }
    Ok(sentences)
}

#[derive(Serialize, Clone)]
struct SayProgress {
    /// Сколько прочитано: 0…1
    p: f32,
    done: bool,
}

/// Прочитать текст вслух (ответ ИИ). Ход озвучки — событием «voice-say», для полоски и проявления слов
#[tauri::command]
pub async fn voice_say(app: AppHandle, text: String) -> Result<(), String> {
    if !installed(&app) {
        return Err("Голос не установлен".into());
    }
    let gen_no = app.state::<VoiceState>().say_gen.fetch_add(1, Ordering::SeqCst) + 1;
    let a = app.clone();
    tokio::task::spawn_blocking(move || say(&a, &text, gen_no)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn voice_stop(app: AppHandle) {
    app.state::<VoiceState>().say_gen.fetch_add(1, Ordering::SeqCst);
}

fn say(app: &AppHandle, text: &str, gen_no: u64) -> Result<(), String> {
    let gen = app.state::<VoiceState>().say_gen.clone();
    let alive = || gen.load(Ordering::SeqCst) == gen_no;
    let t = tts(app)?;
    let mut g = GenerationConfig::default();
    g.speed = settings::load(app).voice_rate.clamp(0.7, 1.6);
    g.phoneme_codepoints = Some(phonemes(app, text)?);
    if !alive() {
        return Ok(());
    }
    let audio = t.generate_with_config(text, &g, None::<fn(&[f32], f32) -> bool>).ok_or("Не удалось озвучить ответ")?;
    if !alive() {
        return Ok(());
    }
    play(app, audio.samples(), audio.sample_rate(), &alive)
}

fn play(app: &AppHandle, samples: &[f32], rate: i32, alive: &dyn Fn() -> bool) -> Result<(), String> {
    let s = settings::load(app);
    let dev = find_device(false, s.voice_output.as_deref()).ok_or("Нет устройства вывода звука")?;
    let cfg = dev.default_output_config().map_err(|e| e.to_string())?;
    let out_rate = cfg.sample_rate().0 as i32;
    let ch = cfg.channels() as usize;
    // Громкость из настроек: квадрат — чтобы ползунок звучал равномерно на слух
    let gain = (s.voice_volume.min(100) as f32 / 100.0).powi(2);
    let mut data = if out_rate == rate {
        samples.to_vec()
    } else {
        LinearResampler::create(rate, out_rate).map(|r| r.resample(samples, true)).unwrap_or_else(|| samples.to_vec())
    };
    data.iter_mut().for_each(|v| *v *= gain);
    let data: Arc<Vec<f32>> = Arc::new(data);
    let pos = Arc::new(AtomicUsize::new(0));
    let err = |e| eprintln!("звук: {e}");
    macro_rules! out_stream {
        ($t:ty, $conv:expr) => {{
            let (data, pos) = (data.clone(), pos.clone());
            dev.build_output_stream(
                &cfg.clone().into(),
                move |out: &mut [$t], _| {
                    let mut i = pos.load(Ordering::Relaxed);
                    for frame in out.chunks_mut(ch) {
                        let v: f32 = data.get(i).copied().unwrap_or(0.0);
                        i += 1;
                        frame.fill($conv(v));
                    }
                    pos.store(i, Ordering::Relaxed);
                },
                err,
                None,
            )
        }};
    }
    let stream = match cfg.sample_format() {
        cpal::SampleFormat::F32 => out_stream!(f32, |v: f32| v),
        cpal::SampleFormat::I16 => out_stream!(i16, |v: f32| (v.clamp(-1.0, 1.0) * 32767.0) as i16),
        cpal::SampleFormat::U16 => out_stream!(u16, |v: f32| ((v.clamp(-1.0, 1.0) + 1.0) * 32767.5) as u16),
        _ => return Err("Это устройство вывода не поддерживается".into()),
    }
    .map_err(|e| e.to_string())?;
    stream.play().map_err(|e| e.to_string())?;
    let len = data.len().max(1);
    loop {
        std::thread::sleep(Duration::from_millis(80));
        let p = pos.load(Ordering::Relaxed);
        if !alive() || p >= len {
            break;
        }
        let _ = app.emit("voice-say", SayProgress { p: p as f32 / len as f32, done: false });
    }
    // Хвост буфера доиграть
    std::thread::sleep(Duration::from_millis(120));
    drop(stream);
    let _ = app.emit("voice-say", SayProgress { p: 1.0, done: true });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::speakable;
    #[test]
    fn reads_admin_words() {
        assert_eq!(speakable("JAIL до 120 минут, п. 4.1"), "джейл до 120 минут, пункт 4 точка 1");
    }
    #[test]
    fn reads_numbers() {
        assert_eq!(speakable("По п.1.4.2 нельзя."), "По пункт 1 точка 4 точка 2 нельзя.");
        assert_eq!(speakable("Нарушение пункта 2.13."), "Нарушение пункта 2 точка 13.");
        assert_eq!(speakable("Мут на 10–15 минут"), "Мут на 10, 15 минут");
        assert_eq!(speakable("от 10-15 минут, 1,5 часа"), "от 10 до 15 минут, 1 целых 5 часа");
        assert_eq!(speakable("ст. 12 ч. 3"), "статья 12 часть 3");
    }
}
