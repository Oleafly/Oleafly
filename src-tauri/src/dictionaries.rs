use std::collections::BTreeSet;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::AsyncWriteExt as _;

use crate::assets::AssetProgress;
use crate::paths;

const MAX_FILE_BYTES: u64 = 64 * 1024 * 1024;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(300);
const MAX_REDIRECTS: usize = 5;
const ALLOWED_HOSTS: [&str; 3] = ["cdn.jsdelivr.net", "cdn.oleafly.com", "mirrors.oleafly.com"];
const UNREACHABLE: &str = "That spelling dictionary could not be downloaded.";
const CORRUPT: &str = "The downloaded spelling dictionary did not match its published checksum.";

static DOWNLOADING: Mutex<BTreeSet<String>> = Mutex::new(BTreeSet::new());

#[derive(Deserialize, Serialize, Clone, Default)]
pub struct DictionaryLicense {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub url: String,
}

#[derive(Deserialize, Serialize, Clone)]
pub struct DictionaryFile {
    pub name: String,
    pub url: String,
    #[serde(default)]
    pub sha256: String,
    #[serde(default)]
    pub bytes: u64,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DictionaryPack {
    pub id: String,
    #[serde(default)]
    pub language: String,
    #[serde(default)]
    pub region: Option<String>,
    #[serde(default)]
    pub bundled: bool,
    pub files: Vec<DictionaryFile>,
    #[serde(default)]
    pub license: DictionaryLicense,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DictionaryInfo {
    pub id: String,
    pub language: String,
    pub region: Option<String>,
    pub license: DictionaryLicense,
    pub bytes: u64,
    pub state: String,
}

struct DownloadGuard(String);

impl DownloadGuard {
    fn acquire(id: &str) -> Result<Self, String> {
        let mut busy = DOWNLOADING
            .lock()
            .map_err(|_| "The download queue is unavailable.".to_string())?;
        if !busy.insert(id.to_string()) {
            return Err("That spelling dictionary is already downloading.".into());
        }
        Ok(Self(id.to_string()))
    }
}

impl Drop for DownloadGuard {
    fn drop(&mut self) {
        if let Ok(mut busy) = DOWNLOADING.lock() {
            busy.remove(&self.0);
        }
    }
}

fn is_downloading(id: &str) -> bool {
    DOWNLOADING
        .lock()
        .map(|busy| busy.contains(id))
        .unwrap_or(false)
}

pub fn is_valid_id(id: &str) -> bool {
    let (language, qualifier) = match id.split_once('_') {
        Some((language, qualifier)) => (language, Some(qualifier)),
        None => (id, None),
    };
    let language_ok =
        (2..=3).contains(&language.len()) && language.chars().all(|c| c.is_ascii_lowercase());
    let qualifier_ok = match qualifier {
        None => true,
        Some(value) => {
            (2..=4).contains(&value.len()) && value.chars().all(|c| c.is_ascii_alphabetic())
        }
    };
    language_ok && qualifier_ok
}

fn label_for(pack: &DictionaryPack) -> String {
    match pack.region.as_deref() {
        Some(region) if !region.is_empty() => format!("{} ({region})", pack.language),
        _ => pack.language.clone(),
    }
}

fn catalog_path(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(path) = app.path().resolve(
        "resources/dictionary-packs.json",
        tauri::path::BaseDirectory::Resource,
    ) {
        if path.is_file() {
            return Ok(path);
        }
    }
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("dictionary-packs.json");
    if dev.is_file() {
        return Ok(dev);
    }
    Err("The spelling dictionary catalog is missing.".to_string())
}

pub fn catalog(app: &AppHandle) -> Result<Vec<DictionaryPack>, String> {
    let source = std::fs::read_to_string(catalog_path(app)?)
        .map_err(|_| "The spelling dictionary catalog could not be read.".to_string())?;
    parse_catalog(&source)
}

fn parse_catalog(source: &str) -> Result<Vec<DictionaryPack>, String> {
    let packs: Vec<DictionaryPack> = serde_json::from_str(source)
        .map_err(|_| "The spelling dictionary catalog is not readable.".to_string())?;
    for pack in &packs {
        if !is_valid_id(&pack.id) {
            return Err("The spelling dictionary catalog has an unusable entry.".into());
        }
    }
    Ok(packs)
}

fn find_pack(app: &AppHandle, id: &str) -> Result<DictionaryPack, String> {
    if !is_valid_id(id) {
        return Err("That is not a spelling dictionary identifier.".into());
    }
    catalog(app)?
        .into_iter()
        .find(|pack| pack.id == id)
        .ok_or_else(|| "That spelling dictionary is not in the catalog.".to_string())
}

fn pack_dir(id: &str) -> Result<PathBuf, String> {
    if !is_valid_id(id) {
        return Err("That is not a spelling dictionary identifier.".into());
    }
    Ok(paths::assets_root()?.join("dictionaries").join(id))
}

fn pack_installed(pack: &DictionaryPack) -> bool {
    let Ok(dir) = pack_dir(&pack.id) else {
        return false;
    };
    !pack.files.is_empty() && pack.files.iter().all(|file| dir.join(&file.name).is_file())
}

fn state_for(pack: &DictionaryPack) -> String {
    if pack.bundled {
        return "bundled".to_string();
    }
    if pack_installed(pack) {
        return "installed".to_string();
    }
    if is_downloading(&pack.id) {
        return "downloading".to_string();
    }
    "available".to_string()
}

fn validate_url(url: &str) -> Result<(), String> {
    let parsed = reqwest::Url::parse(url).map_err(|_| UNREACHABLE.to_string())?;
    if parsed.scheme() != "https" {
        return Err("Spelling dictionaries are downloaded over HTTPS only.".into());
    }
    let host = parsed.host_str().unwrap_or_default().to_ascii_lowercase();
    if !ALLOWED_HOSTS.contains(&host.as_str()) {
        return Err("Spelling dictionaries are not downloaded from that address.".into());
    }
    Ok(())
}

fn redirect_refusal(url: &str, previous: usize) -> Option<&'static str> {
    if previous >= MAX_REDIRECTS {
        return Some("too many redirects");
    }
    if validate_url(url).is_err() {
        return Some("redirect target is outside the download allowlist");
    }
    None
}

fn client() -> Result<reqwest::Client, String> {
    let policy = reqwest::redirect::Policy::custom(|attempt| {
        match redirect_refusal(attempt.url().as_str(), attempt.previous().len()) {
            Some(reason) => attempt.error(reason),
            None => attempt.follow(),
        }
    });
    reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(DOWNLOAD_TIMEOUT)
        .user_agent("Oleafly-dictionaries")
        .redirect(policy)
        .build()
        .map_err(|_| UNREACHABLE.to_string())
}

fn verify_bytes(file: &DictionaryFile, received: u64, digest: &str) -> Result<(), String> {
    if file.bytes > 0 && received != file.bytes {
        return Err(CORRUPT.to_string());
    }
    if file.sha256.trim().is_empty() || !digest.eq_ignore_ascii_case(file.sha256.trim()) {
        return Err(CORRUPT.to_string());
    }
    Ok(())
}

struct DownloadSlot<'a> {
    pack: &'a DictionaryPack,
    file: &'a DictionaryFile,
    index: usize,
    total: usize,
}

async fn download_file(app: &AppHandle, slot: DownloadSlot<'_>) -> Result<(), String> {
    validate_url(&slot.file.url)?;
    let dir = pack_dir(&slot.pack.id)?;
    let dest = dir.join(&slot.file.name);
    if dest.is_file() {
        return Ok(());
    }
    let response = client()?
        .get(&slot.file.url)
        .send()
        .await
        .map_err(|_| UNREACHABLE.to_string())?;
    if !response.status().is_success() {
        return Err(UNREACHABLE.to_string());
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_FILE_BYTES)
    {
        return Err("That spelling dictionary is too large.".into());
    }
    let temporary = dir.join(format!("{}.part", slot.file.name));
    let mut out = tokio::fs::File::create(&temporary)
        .await
        .map_err(|_| "The download could not be written.".to_string())?;
    let mut hasher = Sha256::new();
    let mut received: u64 = 0;
    let mut stream = response.bytes_stream();
    let outcome = loop {
        let next = tokio::time::timeout(DOWNLOAD_TIMEOUT, stream.next()).await;
        let Ok(chunk) = next else {
            break Err("The spelling dictionary download timed out.".to_string());
        };
        let Some(chunk) = chunk else { break Ok(()) };
        let Ok(chunk) = chunk else {
            break Err(UNREACHABLE.to_string());
        };
        received += chunk.len() as u64;
        if received > MAX_FILE_BYTES {
            break Err("That spelling dictionary is too large.".to_string());
        }
        hasher.update(&chunk);
        if out.write_all(&chunk).await.is_err() {
            break Err("The download could not be written.".to_string());
        }
        emit_progress(app, &slot, received, slot.file.bytes);
    };
    let _ = out.flush().await;
    drop(out);
    let verified = outcome
        .and_then(|()| verify_bytes(slot.file, received, &format!("{:x}", hasher.finalize())));
    if verified.is_err() {
        let _ = tokio::fs::remove_file(&temporary).await;
        return verified;
    }
    tokio::fs::rename(&temporary, &dest)
        .await
        .map_err(|_| "The download could not be saved.".to_string())
}

fn emit_progress(app: &AppHandle, slot: &DownloadSlot<'_>, received: u64, total: u64) {
    let _ = app.emit(
        "asset-progress",
        AssetProgress {
            component: format!("dictionary:{}", slot.pack.id),
            label: label_for(slot.pack),
            file: slot.file.name.clone(),
            index: slot.index + 1,
            total: slot.total,
            received,
            file_total: (total > 0).then_some(total),
        },
    );
}

async fn download_pack(app: &AppHandle, pack: &DictionaryPack) -> Result<(), String> {
    let dir = pack_dir(&pack.id)?;
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|_| "The dictionary cache could not be created.".to_string())?;
    let total = pack.files.len();
    for (index, file) in pack.files.iter().enumerate() {
        download_file(
            app,
            DownloadSlot {
                pack,
                file,
                index,
                total,
            },
        )
        .await?;
    }
    Ok(())
}

fn frame(aff: Vec<u8>, dic: Vec<u8>) -> Vec<u8> {
    let mut framed = Vec::with_capacity(8 + aff.len() + dic.len());
    framed.extend_from_slice(&(aff.len() as u64).to_le_bytes());
    framed.extend_from_slice(&aff);
    framed.extend_from_slice(&dic);
    framed
}

#[tauri::command]
pub fn list_dictionaries(app: AppHandle) -> Result<Vec<DictionaryInfo>, String> {
    Ok(catalog(&app)?
        .into_iter()
        .map(|pack| DictionaryInfo {
            state: state_for(&pack),
            bytes: pack.files.iter().map(|file| file.bytes).sum(),
            id: pack.id,
            language: pack.language,
            region: pack.region,
            license: pack.license,
        })
        .collect())
}

#[tauri::command]
pub async fn install_dictionary(app: AppHandle, id: String) -> Result<(), String> {
    let pack = find_pack(&app, &id)?;
    if pack.bundled || pack_installed(&pack) {
        return Ok(());
    }
    let _guard = DownloadGuard::acquire(&pack.id)?;
    download_pack(&app, &pack).await
}

#[tauri::command]
pub fn remove_dictionary(id: String) -> Result<(), String> {
    let dir = pack_dir(&id)?;
    if dir.exists() {
        std::fs::remove_dir_all(&dir)
            .map_err(|_| "That spelling dictionary could not be removed.".to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn read_dictionary(app: AppHandle, id: String) -> Result<tauri::ipc::Response, String> {
    let pack = find_pack(&app, &id)?;
    if pack.bundled {
        return Err("That spelling dictionary ships with the app.".into());
    }
    let dir = pack_dir(&pack.id)?;
    let names: Vec<PathBuf> = pack.files.iter().map(|file| dir.join(&file.name)).collect();
    let bytes = tauri::async_runtime::spawn_blocking(move || -> Result<Vec<u8>, String> {
        let mut parts = Vec::new();
        for path in names {
            parts.push(
                std::fs::read(&path)
                    .map_err(|_| "That spelling dictionary is not installed.".to_string())?,
            );
        }
        let mut drain = parts.into_iter();
        let aff = drain.next().unwrap_or_default();
        let dic = drain.next().unwrap_or_default();
        if aff.is_empty() || dic.is_empty() {
            return Err("That spelling dictionary is not installed.".into());
        }
        Ok(frame(aff, dic))
    })
    .await
    .map_err(|_| "That spelling dictionary could not be read.".to_string())??;
    Ok(tauri::ipc::Response::new(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo_catalog() -> Vec<DictionaryPack> {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("dictionary-packs.json");
        parse_catalog(&std::fs::read_to_string(path).unwrap()).unwrap()
    }

    fn file_for(bytes: &[u8]) -> DictionaryFile {
        DictionaryFile {
            name: "es_ES.dic".to_string(),
            url: "https://cdn.jsdelivr.net/npm/dictionary-es@4.0.0/index.dic".to_string(),
            sha256: format!("{:x}", Sha256::digest(bytes)),
            bytes: bytes.len() as u64,
        }
    }

    #[test]
    fn the_catalog_parses_and_every_entry_is_downloadable() {
        let packs = repo_catalog();
        assert!(packs.len() >= 60);
        let mut seen = BTreeSet::new();
        for pack in &packs {
            assert!(is_valid_id(&pack.id), "safe id: {}", pack.id);
            assert!(seen.insert(pack.id.clone()), "unique id: {}", pack.id);
            assert_eq!(pack.files.len(), 2, "{} has both files", pack.id);
            for file in &pack.files {
                assert!(
                    validate_url(&file.url).is_ok(),
                    "allowed host: {}",
                    file.url
                );
                assert_eq!(file.sha256.len(), 64, "{} checksum", pack.id);
                assert!(file.bytes > 0, "{} size", pack.id);
                assert!(file.bytes <= MAX_FILE_BYTES, "{} fits the cap", pack.id);
                assert!(
                    file.name.starts_with(&pack.id) && !file.name.contains('/'),
                    "{} file name",
                    pack.id
                );
            }
            assert!(!pack.license.id.is_empty(), "{} license", pack.id);
        }
        for bundled in ["de_DE", "en_AU", "en_GB", "en_US", "fr_FR"] {
            let pack = packs.iter().find(|pack| pack.id == bundled).unwrap();
            assert!(pack.bundled, "{bundled} is marked bundled");
        }
    }

    #[test]
    fn an_identifier_can_never_leave_the_cache_directory() {
        assert!(is_valid_id("en_US"));
        assert!(is_valid_id("sr_Latn"));
        assert!(is_valid_id("eo"));
        assert!(!is_valid_id("../etc"));
        assert!(!is_valid_id("en/US"));
        assert!(!is_valid_id("en\\US"));
        assert!(!is_valid_id(".."));
        assert!(!is_valid_id(""));
        assert!(!is_valid_id("en_US.dic"));
        assert!(!is_valid_id("english_US"));
        assert!(pack_dir("../evil").is_err());
    }

    #[test]
    fn a_changed_payload_fails_verification() {
        let file = file_for(b"hunspell");
        let good = format!("{:x}", Sha256::digest(b"hunspell"));
        let other = format!("{:x}", Sha256::digest(b"tampered"));
        assert!(verify_bytes(&file, 8, &good).is_ok());
        assert!(verify_bytes(&file, 8, &other).is_err());
        assert!(verify_bytes(&file, 9, &good).is_err());
        let mut unpublished = file_for(b"hunspell");
        unpublished.sha256 = String::new();
        assert!(verify_bytes(&unpublished, 8, &good).is_err());
    }

    #[test]
    fn only_the_publishing_hosts_are_reachable() {
        assert!(validate_url("https://cdn.jsdelivr.net/npm/dictionary-es@4.0.0/index.dic").is_ok());
        assert!(validate_url("https://cdn.oleafly.com/dictionaries/es_ES.dic").is_ok());
        assert!(validate_url("http://cdn.jsdelivr.net/npm/dictionary-es/index.dic").is_err());
        assert!(validate_url("https://attacker.example/index.dic").is_err());
        assert!(redirect_refusal("https://cdn.jsdelivr.net/npm/a", 0).is_none());
        assert!(redirect_refusal("https://attacker.example/a", 0).is_some());
        assert!(redirect_refusal("https://cdn.jsdelivr.net/npm/a", MAX_REDIRECTS).is_some());
    }

    #[test]
    fn state_reflects_bundling_and_the_download_queue() {
        let packs = repo_catalog();
        let bundled = packs.iter().find(|pack| pack.id == "en_US").unwrap();
        assert_eq!(state_for(bundled), "bundled");
        let downloadable = packs.iter().find(|pack| pack.id == "es_ES").unwrap();
        assert!(matches!(
            state_for(downloadable).as_str(),
            "available" | "installed"
        ));
        let guard = DownloadGuard::acquire("zz_ZZ").unwrap();
        assert!(is_downloading("zz_ZZ"));
        assert!(DownloadGuard::acquire("zz_ZZ").is_err());
        drop(guard);
        assert!(!is_downloading("zz_ZZ"));
    }

    #[test]
    fn the_reader_frames_both_files_in_one_payload() {
        let framed = frame(b"AFF".to_vec(), b"DICTIONARY".to_vec());
        let length = u64::from_le_bytes(framed[..8].try_into().unwrap()) as usize;
        assert_eq!(length, 3);
        assert_eq!(&framed[8..8 + length], b"AFF");
        assert_eq!(&framed[8 + length..], b"DICTIONARY");
    }
}
