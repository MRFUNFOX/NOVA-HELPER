//! Загрузка базы правил: манифест с подписью Ed25519 → только изменённые документы → атомарная замена.

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};
use tauri::{AppHandle, Manager, State};

/// Откуда берём базу. Порядок — приоритет; второй адрес — запасной, если первый недоступен.
const MIRRORS: [&str; 2] = [
    "https://raw.githubusercontent.com/MRFUNFOX/NOVA-HELPER/data/",
    "https://cdn.jsdelivr.net/gh/MRFUNFOX/NOVA-HELPER@data/",
];

/// Открытый ключ подписи базы. Подделанный или повреждённый манифест программа не примет.
const PUBKEY_PEM: &str = include_str!("../../../config/nova-signing.pub.pem");

#[derive(Deserialize, Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ManifestDoc {
    pub id: String,
    pub title: String,
    pub sha256: String,
    pub path: String,
    #[serde(default)]
    pub size: u64,
}

#[derive(Deserialize, Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub schema: u32,
    pub db_version: String,
    pub generated_at: String,
    pub min_app_version: String,
    pub documents: Vec<ManifestDoc>,
    #[serde(default)]
    pub changelog: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChangelogIndex {
    versions: Vec<ChangelogEntry>,
}
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ChangelogEntry {
    db_version: String,
    path: String,
    summary: String,
}

/// Скачанный и проверенный, но ещё не применённый манифест
#[derive(Default)]
pub struct Pending {
    manifest_bytes: Vec<u8>,
    sig: String,
    manifest: Option<Manifest>,
    mirror: usize,
}

#[derive(Default)]
pub struct SyncState(pub Mutex<Pending>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckResult {
    /// upToDate | available | firstInstall | appTooOld
    pub status: String,
    pub local_version: Option<String>,
    pub remote_version: String,
    pub generated_at: String,
    pub changed_docs: usize,
    pub added_docs: usize,
    pub removed_docs: usize,
    pub summary: Vec<String>,
}

fn db_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("db"))
}

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent(concat!("NovaHelper/", env!("CARGO_PKG_VERSION")))
        .build()
        .expect("http client")
}

/// Скачать файл базы, перебирая зеркала. Возвращает байты и номер сработавшего зеркала.
async fn fetch(path: &str, prefer: usize) -> Result<(Vec<u8>, usize), String> {
    let http = client();
    let mut last = String::new();
    for k in 0..MIRRORS.len() {
        let i = (prefer + k) % MIRRORS.len();
        let url = format!("{}{}", MIRRORS[i], path);
        match http.get(&url).send().await {
            Ok(r) if r.status().is_success() => match r.bytes().await {
                Ok(b) => return Ok((b.to_vec(), i)),
                Err(e) => last = e.to_string(),
            },
            Ok(r) => last = format!("HTTP {}", r.status()),
            Err(e) => last = e.to_string(),
        }
    }
    Err(format!("Не удалось связаться с сервером базы правил ({last}). Проверьте интернет."))
}

fn public_key() -> Result<VerifyingKey, String> {
    let b64: String = PUBKEY_PEM.lines().filter(|l| !l.starts_with("-----")).collect();
    let der = B64.decode(b64.trim()).map_err(|e| e.to_string())?;
    // SPKI для Ed25519: 12 байт заголовка + 32 байта ключа
    let raw: [u8; 32] = der.get(der.len().saturating_sub(32)..).and_then(|s| s.try_into().ok()).ok_or("Неверный ключ")?;
    VerifyingKey::from_bytes(&raw).map_err(|e| e.to_string())
}

pub fn verify_manifest(manifest: &[u8], sig_b64: &str) -> Result<(), String> {
    let sig_bytes = B64.decode(sig_b64.trim()).map_err(|_| "Подпись базы повреждена")?;
    let sig = Signature::from_slice(&sig_bytes).map_err(|_| "Подпись базы повреждена")?;
    public_key()?
        .verify(manifest, &sig)
        .map_err(|_| "Подпись базы не совпадает — обновление отклонено ради вашей безопасности".to_string())
}

fn sha256_hex(b: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(b);
    h.finalize().iter().map(|x| format!("{x:02x}")).collect()
}

fn read_local_manifest(dir: &Path) -> Option<Manifest> {
    let bytes = fs::read(dir.join("current/manifest.json")).ok()?;
    serde_json::from_slice(&bytes).ok()
}

/// «0.1.10» → [0,1,10] для сравнения версий программы
fn ver(v: &str) -> Vec<u32> {
    v.split('.').map(|p| p.trim().parse().unwrap_or(0)).collect()
}

/// Проверить, вышла ли новая версия базы. Ничего не меняет на диске.
#[tauri::command]
pub async fn db_check(app: AppHandle, state: State<'_, SyncState>) -> Result<CheckResult, String> {
    let dir = db_dir(&app)?;
    let local = read_local_manifest(&dir);
    let (bytes, mirror) = fetch("manifest.json", 0).await?;
    let (sig, _) = fetch("manifest.sig", mirror).await?;
    let sig = String::from_utf8_lossy(&sig).to_string();
    verify_manifest(&bytes, &sig)?;
    let remote: Manifest = serde_json::from_slice(&bytes).map_err(|e| format!("Манифест не читается: {e}"))?;

    let local_docs: std::collections::HashMap<&str, &str> = local
        .as_ref()
        .map(|m| m.documents.iter().map(|d| (d.id.as_str(), d.sha256.as_str())).collect())
        .unwrap_or_default();
    let remote_ids: HashSet<&str> = remote.documents.iter().map(|d| d.id.as_str()).collect();
    let changed = remote.documents.iter().filter(|d| local_docs.get(d.id.as_str()).is_some_and(|s| *s != d.sha256)).count();
    let added = remote.documents.iter().filter(|d| !local_docs.contains_key(d.id.as_str())).count();
    let removed = local_docs.keys().filter(|id| !remote_ids.contains(*id)).count();

    // Краткое описание изменений из журнала (если он доступен)
    let mut summary = Vec::new();
    if let Ok((idx, _)) = fetch("changelog/index.json", mirror).await {
        if let Ok(index) = serde_json::from_slice::<ChangelogIndex>(&idx) {
            let since = local.as_ref().map(|m| m.db_version.clone()).unwrap_or_default();
            summary = index.versions.iter().filter(|v| v.db_version > since).take(5).map(|v| v.summary.clone()).collect();
        }
    }

    let status = if ver(&remote.min_app_version) > ver(env!("CARGO_PKG_VERSION")) {
        "appTooOld"
    } else if local.is_none() {
        "firstInstall"
    } else if local.as_ref().map(|m| &m.db_version) == Some(&remote.db_version) && changed + added + removed == 0 {
        "upToDate"
    } else {
        "available"
    };

    let result = CheckResult {
        status: status.into(),
        local_version: local.map(|m| m.db_version),
        remote_version: remote.db_version.clone(),
        generated_at: remote.generated_at.clone(),
        changed_docs: changed,
        added_docs: added,
        removed_docs: removed,
        summary,
    };
    *state.0.lock().unwrap() = Pending { manifest_bytes: bytes, sig, manifest: Some(remote), mirror };
    Ok(result)
}

/// Применить проверенную новую версию: скачать только изменённые документы и заменить базу целиком.
#[tauri::command]
pub async fn db_update(app: AppHandle, state: State<'_, SyncState>) -> Result<String, String> {
    let (bytes, sig, manifest, mirror) = {
        let p = state.0.lock().unwrap();
        let m = p.manifest.clone().ok_or("Сначала нужна проверка обновлений")?;
        (p.manifest_bytes.clone(), p.sig.clone(), m, p.mirror)
    };
    let dir = db_dir(&app)?;
    let current = dir.join("current");
    let staging = dir.join("staging");
    let _ = fs::remove_dir_all(&staging);
    fs::create_dir_all(staging.join("docs")).map_err(|e| e.to_string())?;
    fs::create_dir_all(staging.join("changelog")).map_err(|e| e.to_string())?;

    for doc in &manifest.documents {
        let local = current.join(&doc.path);
        let target = staging.join(&doc.path);
        // Файлы документов называются по хешу содержимого: если файл уже есть — он тот же
        if let Ok(existing) = fs::read(&local) {
            if sha256_hex(&existing) == doc.sha256 {
                fs::write(&target, existing).map_err(|e| e.to_string())?;
                continue;
            }
        }
        let (data, _) = fetch(&doc.path, mirror).await?;
        if sha256_hex(&data) != doc.sha256 {
            return Err(format!("Файл «{}» скачался повреждённым — попробуйте ещё раз", doc.title));
        }
        fs::write(&target, data).map_err(|e| e.to_string())?;
    }

    // Журнал изменений: прежние записи переносим, новые докачиваем (для экрана «Что изменилось»)
    if let Ok(entries) = fs::read_dir(current.join("changelog")) {
        for e in entries.flatten() {
            let _ = fs::copy(e.path(), staging.join("changelog").join(e.file_name()));
        }
    }
    if let Ok((idx, _)) = fetch("changelog/index.json", mirror).await {
        let _ = fs::write(staging.join("changelog/index.json"), &idx);
        if let Ok(index) = serde_json::from_slice::<ChangelogIndex>(&idx) {
            for v in index.versions.iter().take(20) {
                let file = staging.join(&v.path);
                if !file.exists() {
                    if let Ok((data, _)) = fetch(&v.path, mirror).await {
                        let _ = fs::write(file, data);
                    }
                }
            }
        }
    }

    // Манифест — последним: пока его нет, база в staging считается незаконченной
    fs::write(staging.join("manifest.sig"), &sig).map_err(|e| e.to_string())?;
    fs::write(staging.join("manifest.json"), &bytes).map_err(|e| e.to_string())?;

    let old = dir.join("old");
    let _ = fs::remove_dir_all(&old);
    if current.exists() {
        fs::rename(&current, &old).map_err(|e| e.to_string())?;
    }
    if let Err(e) = fs::rename(&staging, &current) {
        let _ = fs::rename(&old, &current); // откат: старая база остаётся рабочей
        return Err(e.to_string());
    }
    let _ = fs::remove_dir_all(&old);
    db_load(app).await
}

/// Отдать интерфейсу локальную базу одной JSON-строкой: {manifest, docs, changelogs}
#[tauri::command]
pub async fn db_load(app: AppHandle) -> Result<String, String> {
    let current = db_dir(&app)?.join("current");
    let Ok(manifest_bytes) = fs::read(current.join("manifest.json")) else {
        return Ok(r#"{"manifest":null,"docs":[],"changelogs":[]}"#.into());
    };
    // Локальную копию тоже проверяем: её мог испортить антивирус или сбой диска
    let sig = fs::read_to_string(current.join("manifest.sig")).unwrap_or_default();
    if verify_manifest(&manifest_bytes, &sig).is_err() {
        return Ok(r#"{"manifest":null,"docs":[],"changelogs":[],"corrupted":true}"#.into());
    }
    let manifest: Manifest = serde_json::from_slice(&manifest_bytes).map_err(|e| e.to_string())?;
    let mut docs = Vec::with_capacity(manifest.documents.len());
    for d in &manifest.documents {
        if let Ok(s) = fs::read_to_string(current.join(&d.path)) {
            docs.push(s);
        }
    }
    let mut changelogs = Vec::new();
    if let Ok(idx) = fs::read(current.join("changelog/index.json")) {
        if let Ok(index) = serde_json::from_slice::<ChangelogIndex>(&idx) {
            for v in index.versions.iter().take(20) {
                if let Ok(s) = fs::read_to_string(current.join(&v.path)) {
                    changelogs.push(s);
                }
            }
        }
    }
    Ok(format!(
        r#"{{"manifest":{},"docs":[{}],"changelogs":[{}]}}"#,
        String::from_utf8_lossy(&manifest_bytes),
        docs.join(","),
        changelogs.join(",")
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_key_parses() {
        assert!(public_key().is_ok());
    }

    #[test]
    fn rejects_wrong_signature() {
        let fake = B64.encode([0u8; 64]);
        assert!(verify_manifest(b"{}", &fake).is_err());
        assert!(verify_manifest(b"{}", "not base64!").is_err());
    }

    /// Настоящая база с GitHub: подпись манифеста сходится, документы скачиваются и совпадают по хешу.
    /// Сеть нужна, поэтому запуск вручную: `cargo test -- --ignored`
    #[tokio::test]
    #[ignore]
    async fn real_database_verifies() {
        let (bytes, mirror) = fetch("manifest.json", 0).await.expect("manifest");
        let (sig, _) = fetch("manifest.sig", mirror).await.expect("sig");
        verify_manifest(&bytes, &String::from_utf8_lossy(&sig)).expect("подпись базы должна сходиться");
        let m: Manifest = serde_json::from_slice(&bytes).expect("manifest json");
        assert!(m.documents.len() >= 10, "в базе мало документов: {}", m.documents.len());
        for d in m.documents.iter().take(3) {
            let (data, _) = fetch(&d.path, mirror).await.expect("doc");
            assert_eq!(sha256_hex(&data), d.sha256, "хеш документа {}", d.title);
        }
        // Подделка: изменённый манифест с прежней подписью не принимается
        let mut forged = bytes.clone();
        forged[10] ^= 1;
        assert!(verify_manifest(&forged, &String::from_utf8_lossy(&sig)).is_err());
    }

    #[test]
    fn version_compare() {
        assert!(ver("0.2.0") > ver("0.1.9"));
        assert!(ver("0.1.10") > ver("0.1.9"));
    }
}
