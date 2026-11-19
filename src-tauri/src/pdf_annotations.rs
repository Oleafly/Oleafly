use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Deserializer, Serialize};

use crate::project_location::{ProjectKind, ProjectLocation};

const STATE_FILE: &str = "pdf-annotations.json";
const VERSION: u32 = 1;
const MAX_COMMENT: usize = 4000;
const MAX_QUOTE: usize = 2000;
const MAX_CONTEXT: usize = 32;
const MAX_EXCERPT: usize = 6000;
const MAX_BOXES: usize = 400;

static STORE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PdfAnnotationKind {
    Comment,
    Delete,
    Replace,
    Insert,
    Region,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PdfAnnotationOrigin {
    Pdf,
    Review,
    AiReview,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PdfAnnotationStatus {
    Draft,
    Sent,
    Addressed,
    Resolved,
    NeedsPlacing,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct PdfAnnotationQuote {
    text: String,
    before: String,
    after: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfAnnotationSource {
    path: String,
    start_line: u32,
    end_line: u32,
    excerpt: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfAnnotationBox {
    page: u32,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfAnnotation {
    id: String,
    number: u64,
    kind: PdfAnnotationKind,
    comment: String,
    #[serde(default)]
    quote: PdfAnnotationQuote,
    page: u32,
    source: Option<PdfAnnotationSource>,
    boxes: Vec<PdfAnnotationBox>,
    build: Option<String>,
    origin: PdfAnnotationOrigin,
    status: PdfAnnotationStatus,
    created_at: i64,
    updated_at: i64,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NewPdfAnnotation {
    kind: PdfAnnotationKind,
    comment: String,
    #[serde(default)]
    quote: PdfAnnotationQuote,
    page: u32,
    #[serde(default)]
    source: Option<PdfAnnotationSource>,
    #[serde(default)]
    boxes: Vec<PdfAnnotationBox>,
    #[serde(default)]
    build: Option<String>,
    origin: PdfAnnotationOrigin,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PdfAnnotationUpdate {
    id: String,
    #[serde(default)]
    comment: Option<String>,
    #[serde(default)]
    kind: Option<PdfAnnotationKind>,
    #[serde(default)]
    status: Option<PdfAnnotationStatus>,
    #[serde(default)]
    quote: Option<PdfAnnotationQuote>,
    #[serde(default)]
    page: Option<u32>,
    #[serde(default, deserialize_with = "present")]
    source: Option<Option<PdfAnnotationSource>>,
    #[serde(default)]
    boxes: Option<Vec<PdfAnnotationBox>>,
    #[serde(default, deserialize_with = "present")]
    build: Option<Option<String>>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct Store {
    version: u32,
    #[serde(default)]
    next_number: u64,
    #[serde(default)]
    items: Vec<PdfAnnotation>,
}

impl Default for Store {
    fn default() -> Self {
        Self {
            version: VERSION,
            next_number: 1,
            items: Vec::new(),
        }
    }
}

impl Store {
    fn settled(mut self) -> Self {
        let after_items = self
            .items
            .iter()
            .map(|item| item.number.saturating_add(1))
            .max()
            .unwrap_or(1);
        self.next_number = self.next_number.max(after_items);
        self.version = VERSION;
        self
    }

    fn add(&mut self, annotation: NewPdfAnnotation) -> PdfAnnotation {
        let now = now_ms();
        let number = self.next_number;
        self.next_number += 1;
        let created = PdfAnnotation {
            id: new_id(),
            number,
            kind: annotation.kind,
            comment: clamp_front(annotation.comment, MAX_COMMENT),
            quote: clamp_quote(annotation.quote),
            page: annotation.page,
            source: annotation.source.map(clamp_source),
            boxes: clamp_boxes(annotation.boxes),
            build: annotation.build,
            origin: annotation.origin,
            status: PdfAnnotationStatus::Draft,
            created_at: now,
            updated_at: now,
        };
        self.items.push(created.clone());
        created
    }

    fn update(&mut self, updates: Vec<PdfAnnotationUpdate>) {
        let now = now_ms();
        for update in updates {
            if let Some(item) = self.items.iter_mut().find(|item| item.id == update.id) {
                item.apply(update, now);
            }
        }
    }

    fn delete(&mut self, ids: &[String]) {
        self.items.retain(|item| !ids.contains(&item.id));
    }
}

impl PdfAnnotation {
    fn apply(&mut self, update: PdfAnnotationUpdate, now: i64) {
        if let Some(comment) = update.comment {
            self.comment = clamp_front(comment, MAX_COMMENT);
        }
        if let Some(kind) = update.kind {
            self.kind = kind;
        }
        if let Some(status) = update.status {
            self.status = status;
        }
        if let Some(quote) = update.quote {
            self.quote = clamp_quote(quote);
        }
        if let Some(page) = update.page {
            self.page = page;
        }
        if let Some(source) = update.source {
            self.source = source.map(clamp_source);
        }
        if let Some(boxes) = update.boxes {
            self.boxes = clamp_boxes(boxes);
        }
        if let Some(build) = update.build {
            self.build = build;
        }
        self.updated_at = now;
    }
}

fn present<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

fn clamp_front(mut text: String, max: usize) -> String {
    if let Some((end, _)) = text.char_indices().nth(max) {
        text.truncate(end);
    }
    text
}

fn clamp_back(mut text: String, max: usize) -> String {
    let extra = text.chars().count().saturating_sub(max);
    if let Some((start, _)) = text.char_indices().nth(extra).filter(|_| extra > 0) {
        text.drain(..start);
    }
    text
}

fn clamp_quote(quote: PdfAnnotationQuote) -> PdfAnnotationQuote {
    PdfAnnotationQuote {
        text: clamp_front(quote.text, MAX_QUOTE),
        before: clamp_back(quote.before, MAX_CONTEXT),
        after: clamp_front(quote.after, MAX_CONTEXT),
    }
}

fn clamp_source(source: PdfAnnotationSource) -> PdfAnnotationSource {
    PdfAnnotationSource {
        excerpt: clamp_front(source.excerpt, MAX_EXCERPT),
        ..source
    }
}

fn clamp_boxes(mut boxes: Vec<PdfAnnotationBox>) -> Vec<PdfAnnotationBox> {
    boxes.truncate(MAX_BOXES);
    boxes
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| {
            i64::try_from(elapsed.as_millis()).unwrap_or(i64::MAX)
        })
}

fn new_id() -> String {
    format!("{:032x}", rand::random::<u128>())
}

fn lock_store() -> MutexGuard<'static, ()> {
    STORE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn state_path(location: &ProjectLocation) -> Result<PathBuf, String> {
    let directory = location.private_state_dir();
    let directory = match location.kind {
        ProjectKind::Linked => location.ensure_linked_state(&directory)?,
        ProjectKind::Library => {
            std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
            directory
        }
    };
    Ok(directory.join(STATE_FILE))
}

fn read_store(location: &ProjectLocation) -> Result<Store, String> {
    let bytes = match std::fs::read(location.private_state_dir().join(STATE_FILE)) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Store::default()),
        Err(error) => return Err(format!("Could not read the PDF annotations: {error}")),
    };
    serde_json::from_slice::<Store>(&bytes)
        .map(Store::settled)
        .map_err(|error| {
            format!("The PDF annotations file is damaged, so it was left as it is: {error}")
        })
}

fn write_store(location: &ProjectLocation, store: &Store) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(store).map_err(|error| error.to_string())?;
    crate::sandbox::atomic_write(&state_path(location)?, &bytes)
        .map_err(|error| format!("Could not save the PDF annotations: {error}"))
}

fn list(project_id: &str) -> Result<Vec<PdfAnnotation>, String> {
    let location = crate::project_location::locate(project_id)?;
    Ok(read_store(&location)?.items)
}

fn change<T>(project_id: &str, edit: impl FnOnce(&mut Store) -> T) -> Result<T, String> {
    let _guard = lock_store();
    let location = crate::project_location::locate(project_id)?;
    let mut store = read_store(&location)?;
    let outcome = edit(&mut store);
    write_store(&location, &store)?;
    Ok(outcome)
}

fn add(project_id: &str, annotation: NewPdfAnnotation) -> Result<PdfAnnotation, String> {
    change(project_id, |store| store.add(annotation))
}

fn update(
    project_id: &str,
    updates: Vec<PdfAnnotationUpdate>,
) -> Result<Vec<PdfAnnotation>, String> {
    change(project_id, |store| {
        store.update(updates);
        store.items.clone()
    })
}

fn delete(project_id: &str, ids: &[String]) -> Result<Vec<PdfAnnotation>, String> {
    change(project_id, |store| {
        store.delete(ids);
        store.items.clone()
    })
}

#[tauri::command]
pub async fn pdf_annotations_list(project_id: String) -> Result<Vec<PdfAnnotation>, String> {
    tauri::async_runtime::spawn_blocking(move || list(&project_id))
        .await
        .map_err(|error| format!("PDF annotations task failed: {error}"))?
}

#[tauri::command]
pub async fn pdf_annotations_add(
    project_id: String,
    annotation: NewPdfAnnotation,
) -> Result<PdfAnnotation, String> {
    tauri::async_runtime::spawn_blocking(move || add(&project_id, annotation))
        .await
        .map_err(|error| format!("PDF annotations task failed: {error}"))?
}

#[tauri::command]
pub async fn pdf_annotations_update(
    project_id: String,
    updates: Vec<PdfAnnotationUpdate>,
) -> Result<Vec<PdfAnnotation>, String> {
    tauri::async_runtime::spawn_blocking(move || update(&project_id, updates))
        .await
        .map_err(|error| format!("PDF annotations task failed: {error}"))?
}

#[tauri::command]
pub async fn pdf_annotations_delete(
    project_id: String,
    ids: Vec<String>,
) -> Result<Vec<PdfAnnotation>, String> {
    tauri::async_runtime::spawn_blocking(move || delete(&project_id, &ids))
        .await
        .map_err(|error| format!("PDF annotations task failed: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture {
        id: &'static str,
        root: PathBuf,
        _data: tempfile::TempDir,
    }

    impl Fixture {
        fn new(id: &'static str) -> Self {
            let data = tempfile::tempdir().unwrap();
            std::env::set_var("OLEAFLY_DATA_DIR", data.path());
            let root = crate::paths::create_project_dir(id).unwrap();
            std::fs::write(
                root.join("project.json"),
                r#"{"name":"Thesis","main_doc":"main.tex","engine":"latexmk"}"#,
            )
            .unwrap();
            Self {
                id,
                root,
                _data: data,
            }
        }

        fn state_file(&self) -> PathBuf {
            self.root.join(".oleafly").join(STATE_FILE)
        }
    }

    fn note(comment: &str) -> NewPdfAnnotation {
        NewPdfAnnotation {
            kind: PdfAnnotationKind::Comment,
            comment: comment.to_owned(),
            quote: PdfAnnotationQuote {
                text: "the quoted words".to_owned(),
                before: "words before ".to_owned(),
                after: " words after".to_owned(),
            },
            page: 2,
            source: Some(PdfAnnotationSource {
                path: "main.tex".to_owned(),
                start_line: 4,
                end_line: 5,
                excerpt: "the quoted words".to_owned(),
            }),
            boxes: vec![PdfAnnotationBox {
                page: 2,
                x: 0.1,
                y: 0.2,
                width: 0.3,
                height: 0.04,
            }],
            build: Some("pdf-v1:1:aa".to_owned()),
            origin: PdfAnnotationOrigin::Pdf,
        }
    }

    fn numbers(items: &[PdfAnnotation]) -> Vec<u64> {
        items.iter().map(|item| item.number).collect()
    }

    #[test]
    fn numbers_only_go_up_even_after_the_highest_is_deleted() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let project = Fixture::new("pdf-annotations-numbers");
        assert!(list(project.id).unwrap().is_empty());
        assert!(!project.state_file().exists());

        let first = add(project.id, note("one")).unwrap();
        let second = add(project.id, note("two")).unwrap();
        assert_eq!((first.number, second.number), (1, 2));
        assert_ne!(first.id, second.id);
        assert_eq!(first.status, PdfAnnotationStatus::Draft);
        assert_eq!(first.created_at, first.updated_at);

        let left = delete(project.id, &[second.id]).unwrap();
        assert_eq!(numbers(&left), vec![1]);
        assert_eq!(add(project.id, note("three")).unwrap().number, 3);

        let reloaded = list(project.id).unwrap();
        assert_eq!(numbers(&reloaded), vec![1, 3]);
        let highest = reloaded.last().unwrap().id.clone();
        delete(project.id, &[highest]).unwrap();
        assert_eq!(add(project.id, note("four")).unwrap().number, 4);
    }

    #[test]
    fn a_stale_counter_is_raised_past_the_stored_numbers() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let project = Fixture::new("pdf-annotations-counter");
        let first = add(project.id, note("one")).unwrap();
        let mut stored: serde_json::Value =
            serde_json::from_slice(&std::fs::read(project.state_file()).unwrap()).unwrap();
        stored["nextNumber"] = 1.into();
        stored["items"][0]["number"] = 7.into();
        std::fs::write(project.state_file(), stored.to_string()).unwrap();
        assert_eq!(add(project.id, note("two")).unwrap().number, 8);
        assert_eq!(numbers(&list(project.id).unwrap()), vec![7, 8]);
        assert_eq!(list(project.id).unwrap()[0].id, first.id);
    }

    #[test]
    fn an_update_changes_only_the_fields_it_names() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let project = Fixture::new("pdf-annotations-update");
        let first = add(project.id, note("one")).unwrap();
        let second = add(project.id, note("two")).unwrap();

        let updates: Vec<PdfAnnotationUpdate> = serde_json::from_value(serde_json::json!([
            { "id": first.id, "status": "sent", "comment": "changed", "build": null },
            { "id": "missing", "comment": "ignored" },
        ]))
        .unwrap();
        let items = update(project.id, updates).unwrap();
        assert_eq!(items.len(), 2);
        let changed = &items[0];
        assert_eq!(changed.status, PdfAnnotationStatus::Sent);
        assert_eq!(changed.comment, "changed");
        assert_eq!(changed.build, None);
        assert_eq!(changed.source, first.source);
        assert_eq!(changed.boxes, first.boxes);
        assert_eq!(changed.kind, first.kind);
        assert_eq!(changed.page, first.page);
        assert_eq!(changed.created_at, first.created_at);
        assert!(changed.updated_at >= first.updated_at);
        assert_eq!(items[1], second);

        let moved = vec![PdfAnnotationUpdate {
            id: first.id.clone(),
            page: Some(5),
            boxes: Some(Vec::new()),
            status: Some(PdfAnnotationStatus::NeedsPlacing),
            quote: Some(PdfAnnotationQuote {
                text: "placed again".to_owned(),
                before: "x".repeat(MAX_CONTEXT + 4),
                after: String::new(),
            }),
            ..PdfAnnotationUpdate::default()
        }];
        let items = update(project.id, moved).unwrap();
        assert_eq!(items[0].quote.text, "placed again");
        assert_eq!(items[0].quote.before.chars().count(), MAX_CONTEXT);
        assert_eq!(items[0].page, 5);
        assert!(items[0].boxes.is_empty());
        assert_eq!(items[0].comment, "changed");
        assert_eq!(list(project.id).unwrap(), items);
    }

    #[test]
    fn delete_removes_only_the_named_annotations() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let project = Fixture::new("pdf-annotations-delete");
        let first = add(project.id, note("one")).unwrap();
        let second = add(project.id, note("two")).unwrap();
        let third = add(project.id, note("three")).unwrap();
        let left = delete(project.id, &[first.id, third.id, "missing".to_owned()]).unwrap();
        assert_eq!(left, vec![second]);
        assert_eq!(list(project.id).unwrap(), left);
    }

    #[test]
    fn oversized_fields_are_clamped_by_characters() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let project = Fixture::new("pdf-annotations-clamp");
        let mut big = note(&"é".repeat(MAX_COMMENT + 10));
        big.quote = PdfAnnotationQuote {
            text: "字".repeat(MAX_QUOTE + 1),
            before: format!("{}{}", "a".repeat(40), "é".repeat(MAX_CONTEXT)),
            after: format!("{}{}", "ü".repeat(MAX_CONTEXT), "z".repeat(40)),
        };
        big.source.as_mut().unwrap().excerpt = "😀".repeat(MAX_EXCERPT + 5);
        big.boxes = vec![big.boxes[0].clone(); MAX_BOXES + 3];

        let stored = add(project.id, big).unwrap();
        assert_eq!(stored.comment, "é".repeat(MAX_COMMENT));
        assert_eq!(stored.quote.text, "字".repeat(MAX_QUOTE));
        assert_eq!(stored.quote.before, "é".repeat(MAX_CONTEXT));
        assert_eq!(stored.quote.after, "ü".repeat(MAX_CONTEXT));
        assert_eq!(
            stored.source.as_ref().unwrap().excerpt,
            "😀".repeat(MAX_EXCERPT)
        );
        assert_eq!(stored.boxes.len(), MAX_BOXES);

        let short = add(project.id, note("short")).unwrap();
        assert_eq!(short.quote.before, "words before ");
        assert_eq!(short.quote.after, " words after");

        let updates = vec![PdfAnnotationUpdate {
            id: short.id,
            comment: Some("ß".repeat(MAX_COMMENT + 1)),
            ..PdfAnnotationUpdate::default()
        }];
        let items = update(project.id, updates).unwrap();
        assert_eq!(items[1].comment.chars().count(), MAX_COMMENT);
    }

    #[test]
    fn a_damaged_file_is_reported_and_left_untouched() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let project = Fixture::new("pdf-annotations-corrupt");
        add(project.id, note("one")).unwrap();
        std::fs::write(project.state_file(), b"{ not json").unwrap();

        assert!(list(project.id).unwrap_err().contains("damaged"));
        assert!(add(project.id, note("two")).is_err());
        assert!(delete(project.id, &[]).is_err());
        assert_eq!(std::fs::read(project.state_file()).unwrap(), b"{ not json");
    }

    #[test]
    fn a_library_project_keeps_annotations_in_its_private_state_folder() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let project = Fixture::new("pdf-annotations-library");
        add(project.id, note("one")).unwrap();
        let saved: serde_json::Value =
            serde_json::from_slice(&std::fs::read(project.state_file()).unwrap()).unwrap();
        assert_eq!(saved["version"], 1);
        assert_eq!(saved["nextNumber"], 2);
        assert_eq!(saved["items"][0]["origin"], "pdf");
        assert_eq!(saved["items"][0]["source"]["startLine"], 4);
        assert!(!project.root.join(STATE_FILE).exists());
    }

    #[test]
    fn a_linked_project_keeps_annotations_out_of_its_folder() {
        let fixture = crate::trust::testing::LinkedFixture::new();
        let (linked, folder) = fixture.link("thesis");
        assert!(list(&linked).unwrap().is_empty());

        add(&linked, note("one")).unwrap();
        let location = crate::project_location::locate(&linked).unwrap();
        assert_eq!(location.kind, ProjectKind::Linked);
        assert!(location.private_state_dir().join(STATE_FILE).is_file());
        assert!(!folder.join(".oleafly").exists());
        assert!(!folder.join(STATE_FILE).exists());
        assert_eq!(numbers(&list(&linked).unwrap()), vec![1]);
    }
}
