use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Map, Value};

use crate::project_location::ProjectLocation;

const STATE_FILE: &str = "pdf-annotations.json";
const VERSION: u32 = 1;
const MAX_FILE_BYTES: u64 = 16 * 1024 * 1024;
const MAX_COMMENT: usize = 4000;
const MAX_QUOTE: usize = 2000;
const MAX_CONTEXT: usize = 32;
const MAX_EXCERPT: usize = 6000;
const MAX_BOXES: usize = 400;
const MAX_PATH_BYTES: usize = 1024;
const MAX_BUILD_BYTES: usize = 256;
const MAX_UPDATES: usize = 2000;
const MAX_IDS: usize = 10_000;
const MAX_COORDINATE: f64 = 1_000_000.0;

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
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PdfAnnotationPlacement {
    #[default]
    Placed,
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
    #[serde(default)]
    placement: PdfAnnotationPlacement,
    created_at: i64,
    updated_at: i64,
    #[serde(flatten)]
    extra: Map<String, Value>,
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
    expected_updated_at: Option<i64>,
    #[serde(default)]
    comment: Option<String>,
    #[serde(default)]
    kind: Option<PdfAnnotationKind>,
    #[serde(default)]
    status: Option<PdfAnnotationStatus>,
    #[serde(default)]
    placement: Option<PdfAnnotationPlacement>,
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

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfAnnotationList {
    items: Vec<PdfAnnotation>,
    read_only: bool,
    set_aside: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct Store {
    version: u32,
    #[serde(default)]
    next_number: u64,
    #[serde(default)]
    items: Vec<PdfAnnotation>,
    #[serde(flatten)]
    extra: Map<String, Value>,
}

impl Default for Store {
    fn default() -> Self {
        Self {
            version: VERSION,
            next_number: 1,
            items: Vec::new(),
            extra: Map::new(),
        }
    }
}

struct Loaded {
    store: Store,
    read_only: bool,
    set_aside: bool,
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
        self
    }

    fn add(&mut self, annotation: NewPdfAnnotation) -> Result<PdfAnnotation, String> {
        check_new(&annotation)?;
        let now = now_ms();
        let number = self.next_number;
        self.next_number = number
            .checked_add(1)
            .ok_or("PDF annotation numbers are exhausted")?;
        let created = PdfAnnotation {
            id: oleafly_core::ids::random_uuid(),
            number,
            kind: annotation.kind,
            comment: annotation.comment,
            quote: clamp_quote(annotation.quote),
            page: annotation.page,
            source: annotation.source.map(clamp_source),
            boxes: clamp_boxes(annotation.boxes),
            build: annotation.build,
            origin: annotation.origin,
            status: PdfAnnotationStatus::Draft,
            placement: PdfAnnotationPlacement::Placed,
            created_at: now,
            updated_at: now,
            extra: Map::new(),
        };
        self.items.push(created.clone());
        Ok(created)
    }

    fn update(&mut self, updates: Vec<PdfAnnotationUpdate>) -> Result<(), String> {
        if updates.len() > MAX_UPDATES {
            return Err("Too many PDF annotation changes at once".to_owned());
        }
        for update in &updates {
            check_update(update)?;
        }
        let now = now_ms();
        let index: HashMap<String, usize> = self
            .items
            .iter()
            .enumerate()
            .map(|(position, item)| (item.id.clone(), position))
            .collect();
        for update in updates {
            let Some(&position) = index.get(&update.id) else {
                continue;
            };
            let item = &mut self.items[position];
            if update
                .expected_updated_at
                .is_some_and(|expected| expected != item.updated_at)
            {
                continue;
            }
            item.apply(update, now);
        }
        Ok(())
    }

    fn delete(&mut self, ids: &[String]) -> Result<(), String> {
        if ids.len() > MAX_IDS {
            return Err("Too many PDF annotations to delete at once".to_owned());
        }
        let ids: HashSet<&str> = ids.iter().map(String::as_str).collect();
        self.items.retain(|item| !ids.contains(item.id.as_str()));
        Ok(())
    }
}

impl PdfAnnotation {
    fn apply(&mut self, update: PdfAnnotationUpdate, now: i64) {
        if let Some(comment) = update.comment {
            self.comment = comment;
        }
        if let Some(kind) = update.kind {
            self.kind = kind;
        }
        if let Some(status) = update.status {
            self.status = status;
        }
        if let Some(placement) = update.placement {
            self.placement = placement;
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
        self.updated_at = now.max(self.updated_at.saturating_add(1));
    }
}

fn present<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

fn check_comment(comment: &str) -> Result<(), String> {
    if comment.chars().count() > MAX_COMMENT {
        return Err(format!(
            "A PDF annotation comment can be at most {MAX_COMMENT} characters"
        ));
    }
    Ok(())
}

fn check_page(page: u32) -> Result<(), String> {
    if page == 0 {
        return Err("PDF annotation pages start at 1".to_owned());
    }
    Ok(())
}

fn check_source(source: &PdfAnnotationSource) -> Result<(), String> {
    if source.path.is_empty() || source.path.len() > MAX_PATH_BYTES || source.path.contains('\0') {
        return Err("A PDF annotation source path is not valid".to_owned());
    }
    if source.start_line == 0 || source.end_line < source.start_line {
        return Err("A PDF annotation source line range is not valid".to_owned());
    }
    Ok(())
}

fn check_build(build: Option<&String>) -> Result<(), String> {
    if build.is_some_and(|build| build.len() > MAX_BUILD_BYTES) {
        return Err("A PDF annotation build name is too long".to_owned());
    }
    Ok(())
}

fn check_boxes(boxes: &[PdfAnnotationBox]) -> Result<(), String> {
    let valid = |value: f64| value.is_finite() && value.abs() <= MAX_COORDINATE;
    let bad = boxes.iter().any(|item| {
        item.page == 0
            || ![item.x, item.y, item.width, item.height]
                .into_iter()
                .all(valid)
            || item.width < 0.0
            || item.height < 0.0
    });
    if bad {
        return Err("A PDF annotation box is not valid".to_owned());
    }
    Ok(())
}

fn check_new(annotation: &NewPdfAnnotation) -> Result<(), String> {
    check_comment(&annotation.comment)?;
    check_page(annotation.page)?;
    if let Some(source) = &annotation.source {
        check_source(source)?;
    }
    check_build(annotation.build.as_ref())?;
    check_boxes(&annotation.boxes)
}

fn check_update(update: &PdfAnnotationUpdate) -> Result<(), String> {
    if let Some(comment) = &update.comment {
        check_comment(comment)?;
    }
    if let Some(page) = update.page {
        check_page(page)?;
    }
    if let Some(Some(source)) = &update.source {
        check_source(source)?;
    }
    if let Some(build) = &update.build {
        check_build(build.as_ref())?;
    }
    if let Some(boxes) = &update.boxes {
        check_boxes(boxes)?;
    }
    Ok(())
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

fn lock_store() -> MutexGuard<'static, ()> {
    STORE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn stored_version(bytes: &[u8]) -> Option<u64> {
    serde_json::from_slice::<Value>(bytes)
        .ok()?
        .get("version")?
        .as_u64()
}

fn load_store(location: &ProjectLocation) -> Result<Loaded, String> {
    let path = location.private_state_dir().join(STATE_FILE);
    let fresh = |set_aside| Loaded {
        store: Store::default(),
        read_only: false,
        set_aside,
    };
    let too_big = std::fs::metadata(&path).is_ok_and(|metadata| metadata.len() > MAX_FILE_BYTES);
    let bytes = match std::fs::read(&path) {
        Ok(_) if too_big => {
            crate::cloud::state::set_aside(&path);
            return Ok(fresh(true));
        }
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(fresh(false)),
        Err(error) => return Err(format!("Could not read the PDF annotations: {error}")),
    };
    let newer = stored_version(&bytes).is_some_and(|version| version > u64::from(VERSION));
    match serde_json::from_slice::<Store>(&bytes) {
        Ok(store) => Ok(Loaded {
            store: store.settled(),
            read_only: newer,
            set_aside: false,
        }),
        Err(_) if newer => Err(
            "These PDF annotations were saved by a newer version of Oleafly. Update Oleafly to open them."
                .to_owned(),
        ),
        Err(_) => {
            crate::cloud::state::set_aside(&path);
            Ok(fresh(true))
        }
    }
}

fn write_store(location: &ProjectLocation, store: &Store) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(store).map_err(|error| error.to_string())?;
    let path = crate::paths::private_state_file(location, STATE_FILE)?;
    crate::sandbox::atomic_write(&path, &bytes)
        .map_err(|error| format!("Could not save the PDF annotations: {error}"))
}

fn list(project_id: &str) -> Result<PdfAnnotationList, String> {
    let location = crate::project_location::locate(project_id)?;
    let _guard = lock_store();
    let loaded = load_store(&location)?;
    Ok(PdfAnnotationList {
        items: loaded.store.items,
        read_only: loaded.read_only,
        set_aside: loaded.set_aside,
    })
}

fn change<T>(
    project_id: &str,
    edit: impl FnOnce(&mut Store) -> Result<T, String>,
) -> Result<T, String> {
    let location = crate::project_location::locate(project_id)?;
    let _guard = lock_store();
    let Loaded {
        mut store,
        read_only,
        ..
    } = load_store(&location)?;
    if read_only {
        return Err(
            "These PDF annotations were saved by a newer version of Oleafly, so they can't be changed here."
                .to_owned(),
        );
    }
    let outcome = edit(&mut store)?;
    store.version = VERSION;
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
        store.update(updates)?;
        Ok(store.items.clone())
    })
}

fn delete(project_id: &str, ids: &[String]) -> Result<Vec<PdfAnnotation>, String> {
    change(project_id, |store| {
        store.delete(ids)?;
        Ok(store.items.clone())
    })
}

#[tauri::command]
pub async fn pdf_annotations_list(project_id: String) -> Result<PdfAnnotationList, String> {
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
    use crate::project_location::ProjectKind;
    use std::path::PathBuf;

    struct Fixture {
        id: &'static str,
        root: PathBuf,
        _library: crate::collab::testing::TempLibrary,
    }

    impl Fixture {
        fn new(id: &'static str) -> Self {
            let library = crate::collab::testing::TempLibrary::new();
            let root = library.project(
                id,
                &[(
                    "project.json",
                    r#"{"name":"Thesis","main_doc":"main.tex","engine":"latexmk"}"#,
                )],
            );
            Self {
                id,
                root,
                _library: library,
            }
        }

        fn state_file(&self) -> PathBuf {
            self.root.join(".oleafly").join(STATE_FILE)
        }

        fn items(&self) -> Vec<PdfAnnotation> {
            list(self.id).unwrap().items
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

    fn updates(value: serde_json::Value) -> Vec<PdfAnnotationUpdate> {
        serde_json::from_value(value).unwrap()
    }

    #[test]
    fn numbers_only_go_up_even_after_the_highest_is_deleted() {
        let project = Fixture::new("pdf-annotations-numbers");
        assert!(project.items().is_empty());
        assert!(!project.state_file().exists());

        let first = add(project.id, note("one")).unwrap();
        let second = add(project.id, note("two")).unwrap();
        assert_eq!((first.number, second.number), (1, 2));
        assert_ne!(first.id, second.id);
        assert_eq!(first.status, PdfAnnotationStatus::Draft);
        assert_eq!(first.placement, PdfAnnotationPlacement::Placed);
        assert_eq!(first.created_at, first.updated_at);

        let left = delete(project.id, &[second.id]).unwrap();
        assert_eq!(numbers(&left), vec![1]);
        assert_eq!(add(project.id, note("three")).unwrap().number, 3);

        let reloaded = project.items();
        assert_eq!(numbers(&reloaded), vec![1, 3]);
        let highest = reloaded.last().unwrap().id.clone();
        delete(project.id, &[highest]).unwrap();
        assert_eq!(add(project.id, note("four")).unwrap().number, 4);
    }

    #[test]
    fn a_stale_counter_is_raised_past_the_stored_numbers() {
        let project = Fixture::new("pdf-annotations-counter");
        let first = add(project.id, note("one")).unwrap();
        let mut stored: Value =
            serde_json::from_slice(&std::fs::read(project.state_file()).unwrap()).unwrap();
        stored["nextNumber"] = 1.into();
        stored["items"][0]["number"] = 7.into();
        std::fs::write(project.state_file(), stored.to_string()).unwrap();
        assert_eq!(add(project.id, note("two")).unwrap().number, 8);
        assert_eq!(numbers(&project.items()), vec![7, 8]);
        assert_eq!(project.items()[0].id, first.id);
    }

    #[test]
    fn an_update_changes_only_the_fields_it_names() {
        let project = Fixture::new("pdf-annotations-update");
        let first = add(project.id, note("one")).unwrap();
        let second = add(project.id, note("two")).unwrap();

        let items = update(
            project.id,
            updates(serde_json::json!([
                { "id": first.id, "status": "sent", "comment": "changed", "build": null },
                { "id": "missing", "comment": "ignored" },
            ])),
        )
        .unwrap();
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
        assert!(changed.updated_at > first.updated_at);
        assert_eq!(items[1], second);

        let moved = vec![PdfAnnotationUpdate {
            id: first.id.clone(),
            page: Some(5),
            boxes: Some(Vec::new()),
            placement: Some(PdfAnnotationPlacement::NeedsPlacing),
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
        assert_eq!(items[0].placement, PdfAnnotationPlacement::NeedsPlacing);
        assert_eq!(items[0].status, PdfAnnotationStatus::Sent);
        assert_eq!(items[0].comment, "changed");
        assert_eq!(project.items(), items);
    }

    #[test]
    fn an_update_made_against_an_older_copy_is_skipped() {
        let project = Fixture::new("pdf-annotations-stale");
        let first = add(project.id, note("one")).unwrap();
        let resolved = update(
            project.id,
            updates(serde_json::json!([{ "id": first.id, "status": "resolved" }])),
        )
        .unwrap();
        let late = update(
            project.id,
            updates(serde_json::json!([{
                "id": first.id,
                "expectedUpdatedAt": first.updated_at,
                "placement": "needsPlacing",
                "boxes": [],
            }])),
        )
        .unwrap();
        assert_eq!(late, resolved);
        assert_eq!(late[0].status, PdfAnnotationStatus::Resolved);
        assert_eq!(late[0].placement, PdfAnnotationPlacement::Placed);

        let current = update(
            project.id,
            updates(serde_json::json!([{
                "id": first.id,
                "expectedUpdatedAt": resolved[0].updated_at,
                "page": 9,
            }])),
        )
        .unwrap();
        assert_eq!(current[0].page, 9);
    }

    #[test]
    fn delete_removes_only_the_named_annotations() {
        let project = Fixture::new("pdf-annotations-delete");
        let first = add(project.id, note("one")).unwrap();
        let second = add(project.id, note("two")).unwrap();
        let third = add(project.id, note("three")).unwrap();
        let left = delete(project.id, &[first.id, third.id, "missing".to_owned()]).unwrap();
        assert_eq!(left, vec![second]);
        assert_eq!(project.items(), left);
    }

    #[test]
    fn derived_text_is_clamped_by_characters_but_a_long_comment_is_refused() {
        let project = Fixture::new("pdf-annotations-clamp");
        let mut big = note("short");
        big.quote = PdfAnnotationQuote {
            text: "字".repeat(MAX_QUOTE + 1),
            before: format!("{}{}", "a".repeat(40), "é".repeat(MAX_CONTEXT)),
            after: format!("{}{}", "ü".repeat(MAX_CONTEXT), "z".repeat(40)),
        };
        big.source.as_mut().unwrap().excerpt = "😀".repeat(MAX_EXCERPT + 5);
        big.boxes = vec![big.boxes[0].clone(); MAX_BOXES + 3];

        let stored = add(project.id, big).unwrap();
        assert_eq!(stored.quote.text, "字".repeat(MAX_QUOTE));
        assert_eq!(stored.quote.before, "é".repeat(MAX_CONTEXT));
        assert_eq!(stored.quote.after, "ü".repeat(MAX_CONTEXT));
        assert_eq!(
            stored.source.as_ref().unwrap().excerpt,
            "😀".repeat(MAX_EXCERPT)
        );
        assert_eq!(stored.boxes.len(), MAX_BOXES);

        assert!(add(project.id, note(&"é".repeat(MAX_COMMENT + 1))).is_err());
        let exact = add(project.id, note(&"é".repeat(MAX_COMMENT))).unwrap();
        assert_eq!(exact.comment.chars().count(), MAX_COMMENT);
        let too_long = vec![PdfAnnotationUpdate {
            id: exact.id.clone(),
            comment: Some("ß".repeat(MAX_COMMENT + 1)),
            ..PdfAnnotationUpdate::default()
        }];
        assert!(update(project.id, too_long).is_err());
        assert_eq!(project.items()[1].comment, exact.comment);
    }

    #[test]
    fn malformed_input_from_the_window_is_refused() {
        let project = Fixture::new("pdf-annotations-input");
        let mut long_build = note("one");
        long_build.build = Some("b".repeat(MAX_BUILD_BYTES + 1));
        assert!(add(project.id, long_build).is_err());

        let mut long_path = note("one");
        long_path.source.as_mut().unwrap().path = "a/".repeat(MAX_PATH_BYTES);
        assert!(add(project.id, long_path).is_err());

        let mut backwards = note("one");
        let source = backwards.source.as_mut().unwrap();
        source.start_line = 9;
        source.end_line = 3;
        assert!(add(project.id, backwards).is_err());

        let mut page_zero = note("one");
        page_zero.page = 0;
        assert!(add(project.id, page_zero).is_err());

        let mut bad_box = note("one");
        bad_box.boxes[0].width = f64::NAN;
        assert!(add(project.id, bad_box).is_err());

        let first = add(project.id, note("one")).unwrap();
        let many = (0..=MAX_UPDATES)
            .map(|_| PdfAnnotationUpdate {
                id: first.id.clone(),
                ..PdfAnnotationUpdate::default()
            })
            .collect();
        assert!(update(project.id, many).is_err());
        assert_eq!(numbers(&project.items()), vec![1]);
    }

    #[test]
    fn a_damaged_file_is_set_aside_and_a_new_one_started() {
        let project = Fixture::new("pdf-annotations-corrupt");
        add(project.id, note("one")).unwrap();
        std::fs::write(project.state_file(), b"{ not json").unwrap();

        let listed = list(project.id).unwrap();
        assert!(listed.set_aside);
        assert!(listed.items.is_empty());
        assert!(!project.state_file().exists());
        let aside: Vec<_> = std::fs::read_dir(project.state_file().parent().unwrap())
            .unwrap()
            .filter_map(Result::ok)
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|name| name.starts_with("pdf-annotations.json.unreadable-"))
            .collect();
        assert_eq!(aside.len(), 1);
        let kept = std::fs::read(project.state_file().with_file_name(&aside[0])).unwrap();
        assert_eq!(kept, b"{ not json");

        assert_eq!(add(project.id, note("two")).unwrap().number, 1);
        assert!(!list(project.id).unwrap().set_aside);
    }

    #[test]
    fn a_file_from_a_newer_version_is_read_only_and_keeps_its_fields() {
        let project = Fixture::new("pdf-annotations-newer");
        add(project.id, note("one")).unwrap();
        let mut stored: Value =
            serde_json::from_slice(&std::fs::read(project.state_file()).unwrap()).unwrap();
        stored["version"] = 2.into();
        stored["items"][0]["colour"] = "teal".into();
        let bytes = stored.to_string();
        std::fs::write(project.state_file(), &bytes).unwrap();

        let listed = list(project.id).unwrap();
        assert!(listed.read_only);
        assert_eq!(listed.items[0].extra["colour"], "teal");
        assert!(add(project.id, note("two")).is_err());
        assert_eq!(
            std::fs::read_to_string(project.state_file()).unwrap(),
            bytes
        );

        stored["items"][0]["status"] = "archived".into();
        std::fs::write(project.state_file(), stored.to_string()).unwrap();
        assert!(list(project.id).unwrap_err().contains("newer version"));
        assert!(project.state_file().exists());
    }

    #[test]
    fn unknown_fields_survive_a_save_from_this_version() {
        let project = Fixture::new("pdf-annotations-extra");
        let first = add(project.id, note("one")).unwrap();
        let mut stored: Value =
            serde_json::from_slice(&std::fs::read(project.state_file()).unwrap()).unwrap();
        stored["items"][0]["reviewRound"] = 3.into();
        stored["sharedWith"] = "nobody".into();
        std::fs::write(project.state_file(), stored.to_string()).unwrap();

        update(
            project.id,
            updates(serde_json::json!([{ "id": first.id, "comment": "edited" }])),
        )
        .unwrap();
        let saved: Value =
            serde_json::from_slice(&std::fs::read(project.state_file()).unwrap()).unwrap();
        assert_eq!(saved["items"][0]["reviewRound"], 3);
        assert_eq!(saved["sharedWith"], "nobody");
        assert_eq!(saved["items"][0]["comment"], "edited");
    }

    #[test]
    fn a_library_project_keeps_annotations_in_its_private_state_folder() {
        let project = Fixture::new("pdf-annotations-library");
        add(project.id, note("one")).unwrap();
        let saved: Value =
            serde_json::from_slice(&std::fs::read(project.state_file()).unwrap()).unwrap();
        assert_eq!(saved["version"], 1);
        assert_eq!(saved["nextNumber"], 2);
        assert_eq!(saved["items"][0]["origin"], "pdf");
        assert_eq!(saved["items"][0]["placement"], "placed");
        assert_eq!(saved["items"][0]["source"]["startLine"], 4);
        assert!(!project.root.join(STATE_FILE).exists());
    }

    #[cfg(unix)]
    #[test]
    fn a_symlinked_state_folder_is_refused() {
        let project = Fixture::new("pdf-annotations-symlink");
        let outside = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), project.root.join(".oleafly")).unwrap();
        assert!(add(project.id, note("one")).is_err());
        assert!(!outside.path().join(STATE_FILE).exists());
    }

    #[test]
    fn a_linked_project_keeps_annotations_out_of_its_folder() {
        let fixture = crate::trust::testing::LinkedFixture::new();
        let (linked, folder) = fixture.link("thesis");
        assert!(list(&linked).unwrap().items.is_empty());

        add(&linked, note("one")).unwrap();
        let location = crate::project_location::locate(&linked).unwrap();
        assert_eq!(location.kind, ProjectKind::Linked);
        assert!(location.private_state_dir().join(STATE_FILE).is_file());
        assert!(!folder.join(".oleafly").exists());
        assert!(!folder.join(STATE_FILE).exists());
        assert_eq!(numbers(&list(&linked).unwrap().items), vec![1]);
    }
}
