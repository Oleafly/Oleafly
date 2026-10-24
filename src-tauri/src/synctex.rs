//! SyncTeX for the app: the parsing and search live in
//! `oleafly_doctools::synctex`; this module finds a project's build folder
//! and serves the commands.
use oleafly_doctools::synctex::{forward_hit, inverse, map_source_line, parse};
pub use oleafly_doctools::synctex::{SynctexForwardHit, SynctexHit, SynctexRect};

use crate::paths;

fn read_synctex_text(project_id: &str, _main_doc: &str) -> Result<String, String> {
    let build = paths::existing_build_dir(project_id)?
        .ok_or_else(|| "failed to read synctex: this project has not been compiled".to_string())?;
    oleafly_doctools::synctex::read_synctex(&build).map_err(|error| match error.code {
        // The folder is named for the log, as 0.4.7 named the file.
        "synctex.not_compiled" => format!(
            "failed to read synctex in {}: this project has not been compiled",
            build.display()
        ),
        _ => error.message,
    })
}

fn project_roots(project_id: &str) -> Vec<String> {
    let Ok(dir) = paths::project_dir(project_id) else {
        return Vec::new();
    };
    oleafly_doctools::synctex::project_roots(&dir)
}

#[tauri::command]
pub async fn synctex_forward(
    project_id: String,
    main_doc: String,
    file: String,
    line: i32,
) -> Result<Option<SynctexForwardHit>, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<Option<SynctexForwardHit>, String> {
        let text = read_synctex_text(&project_id, &main_doc)?;
        let doc = parse(&text);
        Ok(forward_hit(&doc, &file, line, &project_roots(&project_id)))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn synctex_inverse(
    project_id: String,
    main_doc: String,
    page: i32,
    x: f64,
    y: f64,
) -> Result<Option<SynctexHit>, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<Option<SynctexHit>, String> {
        let text = read_synctex_text(&project_id, &main_doc)?;
        let doc = parse(&text);
        Ok(inverse(&doc, page, x, y, &project_roots(&project_id)))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn synctex_map_line(
    compiled_source: String,
    current_source: String,
    line: usize,
    current_to_compiled: bool,
) -> Result<Option<usize>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        map_source_line(&compiled_source, &current_source, line, current_to_compiled)
            .map(|mapped| mapped.line)
    })
    .await
    .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use oleafly_doctools::synctex::{tag_for_file, SP_TO_BP};
    use unicode_normalization::UnicodeNormalization;
    #[test]
    fn reading_synctex_for_an_uncompiled_project_creates_nothing() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());
        let project = crate::paths::create_project_dir("fresh").unwrap();

        assert!(read_synctex_text("fresh", "main.tex").is_err());
        assert!(!project.join(".oleafly").exists());

        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn linked_folders_map_synctex_inputs_from_the_central_build() {
        use std::io::Write as _;
        let _env_guard = crate::paths::data_dir_env_lock();
        let data = tempfile::tempdir().unwrap();
        let folders = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", data.path());
        let decomposed = String::from_utf8(vec![b'T', b'h', b'e', 0xcc, 0x80, b's', b'e']).unwrap();
        let folder = folders.path().join(format!("Bob's {decomposed}, v2"));
        std::fs::create_dir_all(folder.join("chapters")).unwrap();
        let record = crate::linked_registry::register_folder_for_test(&folder);
        let root = crate::paths::project_dir(&record.id).unwrap();
        let build = crate::paths::build_dir(&record.id).unwrap();
        let composed_root: String = root.display().to_string().nfc().collect();
        let text = format!(
            "SyncTeX Version:1\nInput:1:{}/_oleafly_entry.tex\nInput:2:{}/./main.tex\nInput:3:{composed_root}/chapters/one.tex\nContent:\n{{1\n[3,5:4736286,9736286:22609920,655360,0\n}}1\n",
            build.display(),
            root.display(),
        );
        let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        encoder.write_all(text.as_bytes()).unwrap();
        std::fs::write(
            build.join(format!("{}.synctex.gz", paths::ENTRY_STEM)),
            encoder.finish().unwrap(),
        )
        .unwrap();
        let doc = parse(&read_synctex_text(&record.id, "main.tex").unwrap());
        let roots = project_roots(&record.id);
        let hit = inverse(&doc, 1, 100.0, 9_736_286.0 * SP_TO_BP - 5.0, &roots).unwrap();
        assert_eq!(hit.file, "chapters/one.tex");
        assert_eq!(hit.line, 5);
        assert_eq!(tag_for_file(&doc, "main.tex", &roots), Some(2));
        assert!(!folder.join(".oleafly").exists());
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }
}
