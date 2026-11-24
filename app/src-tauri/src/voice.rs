//! Вопрос голосом: игрок жмёт микрофон в помощнике, говорит, замолкает — запись останавливается сама,
//! текст появляется в поле ввода (игрок правит и отправляет сам).
//!
//! Всё работает на компьютере игрока, без ключей и серверов:
//!  • запись с микрофона — cpal;
//!  • шумоподавление — GTCRN, распознавание русской речи — GigaAM v3 e2e (Сбер, MIT) через sherpa-onnx:
//!    сразу со знаками препинания, заглавными буквами и «ё».
//! Модель скачивается один раз из выпуска `voice-models` нашего GitHub (набор `asr`).
//! Озвучки ответов нет — от неё отказались 24.11.2026.
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde::Serialize;
use sha2::{Digest, Sha256};
use sherpa_onnx::{OfflineRecognizer, OfflineRecognizerConfig, OfflineSpeechDenoiser, OfflineSpeechDenoiserConfig};
use std::{
    io::Write,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU32, Ordering},
        mpsc, Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager};

const BASE: &str = "https://github.com/MRFUNFOX/NOVA-HELPER/releases/download/voice-models";
const PACK: &str = "asr";
/// Наборы прошлых тестовых сборок (озвучка) — удаляем, если остались
const OLD_PACKS: [&str; 3] = ["tts-supertonic", "tts-denis", "espeak"];
/// Дольше — останавливаем запись сами
const MAX_SECONDS: f32 = 30.0;
/// Сколько тишины после речи — и запись заканчивается
const SILENCE_END: f32 = 1.3;
/// Если за это время так и не заговорили — заканчиваем
const NO_SPEECH: f32 = 7.0;

#[derive(Default)]
pub struct VoiceState {
    rec: Mutex<Option<mpsc::Sender<Ctrl>>>,
    asr: Mutex<Option<Arc<(OfflineRecognizer, Option<OfflineSpeechDenoiser>)>>>,
    installing: AtomicBool,
}

enum Ctrl {
    /// Игрок нажал «Стоп» — распознать сказанное
    Stop,
    /// Закрыл помощник — выбросить запись
    Cancel,
}

fn dir(app: &AppHandle) -> PathBuf {
    app.path().app_local_data_dir().unwrap_or_else(|_| std::env::temp_dir()).join("voice")
}

/// Какая модель нужна программе: GigaAM v3 с пунктуацией. Старую v2 (без знаков препинания) предлагаем скачать заново
const MODEL_VERSION: &str = "gigaam-v3-e2e-ctc-punct";

fn installed(app: &AppHandle) -> bool {
    let d = dir(app).join(PACK);
    d.join("model.int8.onnx").exists() && std::fs::read_to_string(d.join("VERSION")).is_ok_and(|v| v.trim() == MODEL_VERSION)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceStatus {
    installed: bool,
    /// Стоит старая модель (без знаков препинания) — предложить обновить
    outdated: bool,
    installing: bool,
    /// Сколько скачивать (МБ) — чтобы предупредить заранее
    size_mb: u32,
}

#[tauri::command]
pub fn voice_status(app: AppHandle) -> VoiceStatus {
    VoiceStatus { installed: installed(&app), outdated: !installed(&app) && dir(&app).join(PACK).join("model.int8.onnx").exists(), installing: app.state::<VoiceState>().installing.load(Ordering::Relaxed), size_mb: 159 }
}

// ── Установка модели ──

#[derive(Serialize, Clone)]
struct InstallProgress {
    /// asr — качаем, unpack — распаковываем, done, error
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
    for old in OLD_PACKS {
        let _ = std::fs::remove_dir_all(root.join(old));
    }
    let info = &list["files"][PACK];
    let (Some(file), Some(sha)) = (info["file"].as_str(), info["sha256"].as_str()) else {
        return Err("В описании моделей нет распознавания речи".into());
    };
    let size = info["size"].as_u64().unwrap_or(0);
    let tmp = root.join(format!("{PACK}.zip.part"));
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
            let _ = app.emit("voice-install", InstallProgress { stage: PACK.into(), done: got, total: size });
        }
    }
    drop(out);
    if got != size || format!("{:x}", hasher.finalize()) != sha {
        let _ = std::fs::remove_file(&tmp);
        return Err("Файл скачался не полностью. Проверьте интернет и попробуйте ещё раз.".into());
    }
    let _ = app.emit("voice-install", InstallProgress { stage: "unpack".into(), done: size, total: size });
    let target = root.join(PACK);
    let staged = root.join(format!("{PACK}.new"));
    let _ = std::fs::remove_dir_all(&staged);
    let (tmp2, staged2) = (tmp.clone(), staged.clone());
    tokio::task::spawn_blocking(move || unzip(&tmp2, &staged2)).await.map_err(|e| e.to_string())??;
    let _ = std::fs::remove_file(&tmp);
    *app.state::<VoiceState>().asr.lock().unwrap() = None;
    let _ = std::fs::remove_dir_all(&target);
    std::fs::rename(&staged, &target).map_err(|e| e.to_string())?;
    let _ = app.emit("voice-install", InstallProgress { stage: "done".into(), done: size, total: size });
    Ok(())
}

fn net(e: reqwest::Error) -> String {
    if e.is_timeout() || e.is_connect() { "Нет связи с GitHub. Проверьте интернет и попробуйте ещё раз.".into() } else { format!("Не удалось скачать распознавание речи: {e}") }
}

fn unzip(file: &Path, to: &Path) -> Result<(), String> {
    let f = std::fs::File::open(file).map_err(|e| e.to_string())?;
    let mut z = zip::ZipArchive::new(f).map_err(|e| e.to_string())?;
    z.extract(to).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn voice_remove(app: AppHandle) -> Result<(), String> {
    *app.state::<VoiceState>().asr.lock().unwrap() = None;
    let d = dir(&app);
    if d.exists() {
        std::fs::remove_dir_all(d).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ── Запись по кнопке ──

#[derive(Serialize, Clone)]
struct Stage {
    /// listen — слушаю, think — распознаю, heard — готово (text), idle — отменено, error
    stage: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

fn emit(app: &AppHandle, stage: &'static str, text: Option<String>, error: Option<String>) {
    let _ = app.emit("voice", Stage { stage, text, error });
}

/// Кнопка микрофона: начать запись. Остановится сама, когда игрок замолчит
#[tauri::command]
pub fn voice_start(app: AppHandle) -> Result<(), String> {
    if !installed(&app) {
        return Err("missing".into());
    }
    let st = app.state::<VoiceState>();
    let mut rec = st.rec.lock().unwrap();
    if rec.is_some() {
        return Ok(());
    }
    let (ctrl_tx, ctrl_rx) = mpsc::channel::<Ctrl>();
    let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();
    let a = app.clone();
    std::thread::spawn(move || record(a, ctrl_rx, ready_tx));
    ready_rx.recv_timeout(Duration::from_secs(3)).map_err(|_| "Микрофон не ответил".to_string())??;
    *rec = Some(ctrl_tx);
    emit(&app, "listen", None, None);
    Ok(())
}

/// «Стоп» — закончить запись раньше и распознать
#[tauri::command]
pub fn voice_stop(app: AppHandle) {
    if let Some(tx) = app.state::<VoiceState>().rec.lock().unwrap().as_ref() {
        let _ = tx.send(Ctrl::Stop);
    }
}

/// Отменить запись без распознавания (закрыли помощник)
#[tauri::command]
pub fn voice_cancel(app: AppHandle) {
    if let Some(tx) = app.state::<VoiceState>().rec.lock().unwrap().as_ref() {
        let _ = tx.send(Ctrl::Cancel);
    }
}

/// Поток записи: владеет потоком cpal (его нельзя передавать между потоками), сам решает, когда речь кончилась
fn record(app: AppHandle, ctrl: mpsc::Receiver<Ctrl>, ready: mpsc::Sender<Result<(), String>>) {
    let host = cpal::default_host();
    let Some(dev) = host.default_input_device() else {
        let _ = ready.send(Err("Микрофон не найден — подключите его и попробуйте ещё раз".into()));
        return;
    };
    let cfg = match dev.default_input_config() {
        Ok(c) => c,
        Err(_) => {
            let _ = ready.send(Err("Микрофон занят другой программой или выключен в Windows".into()));
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
        cpal::SampleFormat::F32 => dev.build_input_stream(&cfg.into(), move |d: &[f32], _| push(&mut d.chunks(ch).map(|f| f.iter().sum::<f32>() / ch as f32)), err, None),
        cpal::SampleFormat::I16 => dev.build_input_stream(&cfg.into(), move |d: &[i16], _| push(&mut d.chunks(ch).map(|f| f.iter().map(|&x| x as f32 / 32768.0).sum::<f32>() / ch as f32)), err, None),
        cpal::SampleFormat::U16 => dev.build_input_stream(&cfg.into(), move |d: &[u16], _| push(&mut d.chunks(ch).map(|f| f.iter().map(|&x| (x as f32 - 32768.0) / 32768.0).sum::<f32>() / ch as f32)), err, None),
        _ => {
            let _ = ready.send(Err("Этот микрофон не поддерживается".into()));
            return;
        }
    };
    let stream = match stream.map_err(|e| e.to_string()).and_then(|s| s.play().map(|_| s).map_err(|e| e.to_string())) {
        Ok(s) => s,
        Err(_) => {
            let _ = ready.send(Err("Нет доступа к микрофону: Параметры Windows → Конфиденциальность → Микрофон → разрешить классическим приложениям".into()));
            return;
        }
    };
    let _ = ready.send(Ok(()));

    let started = Instant::now();
    let mut vad = Vad::default();
    let mut cancelled = false;
    loop {
        match ctrl.recv_timeout(Duration::from_millis(60)) {
            Ok(Ctrl::Stop) => break,
            Ok(Ctrl::Cancel) | Err(mpsc::RecvTimeoutError::Disconnected) => {
                cancelled = true;
                break;
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                let lvl = f32::from_bits(level.load(Ordering::Relaxed));
                let _ = app.emit("voice-level", (lvl * 6.0).min(1.0));
                let t = started.elapsed().as_secs_f32();
                let end = vad.feed(lvl, t);
                if end == Some(true) || t > MAX_SECONDS {
                    break;
                }
                if end == Some(false) {
                    // Так и не заговорили
                    drop(stream);
                    *app.state::<VoiceState>().rec.lock().unwrap() = None;
                    emit(&app, "error", None, Some("Не услышал вас — проверьте микрофон и скажите ещё раз".into()));
                    return;
                }
            }
        }
    }
    drop(stream);
    *app.state::<VoiceState>().rec.lock().unwrap() = None;
    if cancelled {
        emit(&app, "idle", None, None);
        return;
    }
    emit(&app, "think", None, None);
    let samples = std::mem::take(&mut *buf.lock().unwrap());
    match recognize(&app, &samples, rate) {
        Ok(text) if !text.trim().is_empty() => emit(&app, "heard", Some(tidy(&text)), None),
        Ok(_) => emit(&app, "error", None, Some("Не расслышал — скажите ещё раз".into())),
        Err(e) => emit(&app, "error", None, Some(e)),
    }
}

/// Где кончилась речь — по громкости: первые доли секунды меряем фон, речь — заметно громче фона,
/// после речи тишина дольше SILENCE_END — конец. Some(true) — речь закончилась, Some(false) — речи не было.
#[derive(Default)]
struct Vad {
    noise: f32,
    noise_n: u32,
    spoke: bool,
    quiet_since: Option<f32>,
}

impl Vad {
    fn feed(&mut self, lvl: f32, t: f32) -> Option<bool> {
        if t < 0.35 {
            // Фон: первые ~0,35 с, пока игрок набирает воздух
            self.noise = (self.noise * self.noise_n as f32 + lvl) / (self.noise_n + 1) as f32;
            self.noise_n += 1;
            return None;
        }
        let loud = lvl > (self.noise * 3.0).max(0.012);
        if loud {
            self.spoke = true;
            self.quiet_since = None;
            return None;
        }
        if !self.spoke {
            return (t > NO_SPEECH).then_some(false);
        }
        let since = *self.quiet_since.get_or_insert(t);
        (t - since > SILENCE_END).then_some(true)
    }
}

/// Распознанное — как обычный вопрос: с большой буквы
fn tidy(text: &str) -> String {
    let t = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut c = t.chars();
    c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default()
}

fn recognize(app: &AppHandle, samples: &[f32], rate: u32) -> Result<String, String> {
    if (samples.len() as f32) < rate as f32 * 0.4 {
        return Err("Слишком коротко — скажите ещё раз".into());
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
    let rec = OfflineRecognizer::create(&rc).ok_or("Модель распознавания не загрузилась — удалите её в настройках и скачайте заново")?;
    let mut dc = OfflineSpeechDenoiserConfig::default();
    dc.model.gtcrn.model = p("gtcrn_simple.onnx");
    dc.model.num_threads = 1;
    let den = OfflineSpeechDenoiser::create(&dc);
    let a = Arc::new((rec, den));
    *g = Some(a.clone());
    Ok(a)
}

#[cfg(test)]
mod tests {
    use super::{tidy, Vad};

    /// Громкость по шагам 60 мс: фон, речь, тишина
    fn run(levels: &[f32]) -> (Option<bool>, f32) {
        let mut v = Vad::default();
        for (i, &l) in levels.iter().enumerate() {
            let t = i as f32 * 0.06;
            if let Some(r) = v.feed(l, t) {
                return (Some(r), t);
            }
        }
        (None, 0.0)
    }

    #[test]
    fn stops_after_speech_and_silence() {
        let mut l = vec![0.003; 6];
        l.extend(vec![0.08; 30]); // ~1,8 с речи
        l.extend(vec![0.004; 40]); // тишина
        let (r, t) = run(&l);
        assert_eq!(r, Some(true));
        assert!(t > 2.0 && t < 3.6, "остановилась в {t}");
    }

    #[test]
    fn short_pause_does_not_stop() {
        let mut l = vec![0.003; 6];
        l.extend(vec![0.08; 20]);
        l.extend(vec![0.004; 12]); // пауза 0,7 с между словами
        l.extend(vec![0.08; 20]);
        let (r, _) = run(&l);
        assert_eq!(r, None);
    }

    #[test]
    fn silence_only_gives_up() {
        let (r, t) = run(&vec![0.003; 140]);
        assert_eq!(r, Some(false));
        assert!(t > 6.9);
    }

    #[test]
    fn noisy_room_needs_louder_voice() {
        // Шумно (0,02): обычный шум не считается речью, громкий голос — считается
        let mut l = vec![0.02; 6];
        l.extend(vec![0.025; 30]);
        assert_eq!(run(&l).0, None);
    }

    #[test]
    fn capitalizes() {
        assert_eq!(tidy("  меня  убили  это dm "), "Меня убили это dm");
        assert_eq!(tidy(""), "");
    }
}

#[cfg(test)]
mod model_check {
    /// Проверка модели на записи: NH_ASR_DIR=<папка модели> NH_WAV=<файл.wav> cargo test --lib voice::model_check -- --ignored --nocapture
    #[test]
    #[ignore]
    fn decode_wav() {
        let dir = std::env::var("NH_ASR_DIR").expect("NH_ASR_DIR");
        let wav = std::fs::read(std::env::var("NH_WAV").expect("NH_WAV")).unwrap();
        // Простой WAV: 16 бит, моно — ищем блок data
        let rate = u32::from_le_bytes(wav[24..28].try_into().unwrap()) as i32;
        let pos = wav.windows(4).position(|w| w == b"data").unwrap() + 8;
        let samples: Vec<f32> = wav[pos..].chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]]) as f32 / 32768.0).collect();
        let mut rc = sherpa_onnx::OfflineRecognizerConfig::default();
        rc.model_config.nemo_ctc.model = Some(format!("{dir}/model.int8.onnx"));
        rc.model_config.tokens = Some(format!("{dir}/tokens.txt"));
        rc.model_config.num_threads = 2;
        let rec = sherpa_onnx::OfflineRecognizer::create(&rc).expect("модель не загрузилась");
        let t = std::time::Instant::now();
        let s = rec.create_stream();
        s.accept_waveform(rate, &samples);
        rec.decode(&s);
        println!("{} с записи, {:.2} с на распознавание:\n{}", samples.len() as f32 / rate as f32, t.elapsed().as_secs_f32(), s.get_result().map(|x| x.text).unwrap_or_default());
    }
}
