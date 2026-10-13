use std::io::Read;
use std::path::Path;

use serde::Serialize;
use tauri_plugin_dialog::DialogExt;

const MAX_SETTINGS_BYTES: u64 = 1024 * 1024;

#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PickedSettingsFile {
    pub name: String,
    pub text: String,
}

pub(crate) fn read_settings_file(path: &Path) -> Result<PickedSettingsFile, String> {
    let file = std::fs::File::open(path).map_err(|error| error.to_string())?;
    let metadata = file.metadata().map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err("The chosen item is not a file.".into());
    }
    if metadata.len() > MAX_SETTINGS_BYTES {
        return Err("The settings file is larger than 1 MB.".into());
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(MAX_SETTINGS_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() as u64 > MAX_SETTINGS_BYTES {
        return Err("The settings file is larger than 1 MB.".into());
    }
    let text =
        String::from_utf8(bytes).map_err(|_| "The settings file is not UTF-8 text.".to_string())?;
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    Ok(PickedSettingsFile { name, text })
}

#[tauri::command]
pub async fn pick_settings_file(
    app: tauri::AppHandle,
    title: String,
    filter: String,
) -> Result<Option<PickedSettingsFile>, String> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title(title)
        .add_filter(filter, &["json"])
        .pick_file(move |selection| {
            let _ = sender.send(selection);
        });
    let Some(selection) = receiver
        .await
        .map_err(|_| "The file picker closed unexpectedly.".to_string())?
    else {
        return Ok(None);
    };
    let path = selection
        .into_path()
        .map_err(|_| "That location is not a file Oleafly can read.".to_string())?;
    tauri::async_runtime::spawn_blocking(move || read_settings_file(&path))
        .await
        .map_err(|error| error.to_string())?
        .map(Some)
}

#[cfg(test)]
mod tests {
    use super::read_settings_file;

    #[test]
    fn reads_small_utf8_files_and_refuses_the_rest() {
        let dir = tempfile::tempdir().unwrap();
        let good = dir.path().join("class.oleafly-settings.json");
        std::fs::write(&good, "{\"editor\":{}}").unwrap();
        let read = read_settings_file(&good).unwrap();
        assert_eq!(read.name, "class.oleafly-settings.json");
        assert_eq!(read.text, "{\"editor\":{}}");

        let large = dir.path().join("large.json");
        std::fs::write(&large, vec![b' '; 1024 * 1024 + 1]).unwrap();
        assert!(read_settings_file(&large).unwrap_err().contains("1 MB"));

        let binary = dir.path().join("binary.json");
        std::fs::write(&binary, [0xff, 0xfe, 0x00]).unwrap();
        assert!(read_settings_file(&binary).unwrap_err().contains("UTF-8"));

        assert!(read_settings_file(dir.path()).is_err());
        assert!(read_settings_file(&dir.path().join("missing.json")).is_err());
    }
}
