use crate::folder_watch::FolderChange;
use oleafly_collab::mass_change::{evaluate, MassChangeThreshold, MassChangeVerdict};
use serde::Serialize;
use std::collections::BTreeSet;
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::SystemTime;

pub const SYNC_PAUSED_EVENT: &str = "collab-sync-paused";
pub const SYNC_RESUMED_EVENT: &str = "collab-sync-resumed";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PauseReason {
    MassChange,
    RootUnavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncPaused {
    pub project_id: String,
    pub changed: usize,
    pub total: usize,
    pub reason: PauseReason,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResumed {
    pub project_id: String,
}

pub(crate) trait SyncPauseHost: Send + Sync + 'static {
    fn sync_paused(&self, paused: &SyncPaused);
    fn sync_resumed(&self, resumed: &SyncResumed);
}

impl<R: tauri::Runtime> SyncPauseHost for tauri::AppHandle<R> {
    fn sync_paused(&self, paused: &SyncPaused) {
        use tauri::Emitter as _;
        let _ = self.emit(SYNC_PAUSED_EVENT, paused);
    }

    fn sync_resumed(&self, resumed: &SyncResumed) {
        use tauri::Emitter as _;
        let _ = self.emit(SYNC_RESUMED_EVENT, resumed);
    }
}

pub(crate) struct MassChangeGuard {
    project_id: String,
    root: PathBuf,
    host: Arc<dyn SyncPauseHost>,
    threshold: MassChangeThreshold,
    baseline: Mutex<SystemTime>,
    root_lost: AtomicBool,
    waiting: AtomicBool,
}

impl MassChangeGuard {
    pub(crate) fn new(project_id: &str, root: &Path, host: Arc<dyn SyncPauseHost>) -> Self {
        Self {
            project_id: project_id.to_owned(),
            root: root.to_path_buf(),
            host,
            threshold: MassChangeThreshold::default(),
            baseline: Mutex::new(SystemTime::now()),
            root_lost: AtomicBool::new(false),
            waiting: AtomicBool::new(false),
        }
    }

    pub(crate) fn inspect(&self, change: &FolderChange) -> MassChangeVerdict {
        let since = self.advance_baseline();
        let tracked = self.tracked();
        let tracked_total = tracked.as_ref().map_or(0, BTreeSet::len);
        if !self.root.is_dir() {
            return self.lose_root(tracked_total);
        }
        self.regain_root();
        let known = crate::collab::live::known_content(&self.project_id);
        let rules = crate::collab::disk::ShareRules::load(&self.root);
        let shared = |path: &str, is_dir: bool| {
            tracked
                .as_ref()
                .is_some_and(|tracked| tracked.contains(path))
                || !rules.leaves_out(path, is_dir)
        };
        let paths: Vec<String> = change
            .paths
            .iter()
            .filter(|path| shared(path, self.root.join(path).is_dir()))
            .cloned()
            .collect();
        let direct = if change.rescan {
            None
        } else {
            direct_changes(&self.root, &paths, tracked.as_ref(), &known)
        };
        let present: Vec<String> = if direct.is_some() && tracked_total > 0 {
            Vec::new()
        } else {
            present_files(&self.root)
                .into_iter()
                .filter(|path| shared(path, false))
                .collect()
        };
        let changed = match direct {
            Some(count) => count,
            None => {
                let (added, removed) = tracked_diff(tracked, &present);
                let files = if change.rescan {
                    rescan_changes(&self.root, &present, &added, &removed, since)
                } else {
                    expanded_changes(&self.root, &paths, &added, &removed)
                };
                files
                    .iter()
                    .filter(|file| !crate::folder_watch::is_own_write(&self.root.join(file)))
                    .filter(|file| !known.holds(&self.root, file))
                    .count()
            }
        };
        let total = if tracked_total > 0 {
            tracked_total
        } else {
            present.len()
        };
        let verdict = evaluate(changed, total, true, &self.threshold);
        if let MassChangeVerdict::Pause { changed, total } = &verdict {
            self.report(*changed, *total, PauseReason::MassChange);
        }
        verdict
    }

    pub(crate) fn root_changed(&self) -> Option<MassChangeVerdict> {
        if self.root.is_dir() {
            self.regain_root();
            return None;
        }
        let total = self.tracked().as_ref().map_or(0, BTreeSet::len);
        Some(self.lose_root(total))
    }

    pub(crate) fn begin_waiting(&self) -> bool {
        !self.waiting.swap(true, Ordering::SeqCst)
    }

    pub(crate) fn end_waiting(&self) {
        self.waiting.store(false, Ordering::SeqCst);
    }

    fn regain_root(&self) {
        if self.root_lost.swap(false, Ordering::SeqCst) {
            self.host.sync_resumed(&SyncResumed {
                project_id: self.project_id.clone(),
            });
        }
    }

    fn lose_root(&self, total: usize) -> MassChangeVerdict {
        if !self.root_lost.swap(true, Ordering::SeqCst) {
            self.report(0, total, PauseReason::RootUnavailable);
        }
        evaluate(0, total, false, &self.threshold)
    }

    fn report(&self, changed: usize, total: usize, reason: PauseReason) {
        self.host.sync_paused(&SyncPaused {
            project_id: self.project_id.clone(),
            changed,
            total,
            reason,
        });
    }

    fn advance_baseline(&self) -> SystemTime {
        let mut baseline = self.baseline.lock().unwrap_or_else(PoisonError::into_inner);
        std::mem::replace(&mut *baseline, SystemTime::now())
    }

    fn tracked(&self) -> Option<BTreeSet<String>> {
        let tracked: BTreeSet<String> = crate::collab::live::shared_files(&self.project_id)
            .into_iter()
            .filter(|path| {
                crate::folder_watch::relevant_path(&self.root, &self.root.join(path)).is_some()
            })
            .collect();
        (!tracked.is_empty()).then_some(tracked)
    }
}

fn direct_changes(
    root: &Path,
    paths: &[String],
    tracked: Option<&BTreeSet<String>>,
    known: &crate::collab::live::KnownContent,
) -> Option<usize> {
    let tracked = tracked?;
    paths.iter().try_fold(0, |count, path| {
        match std::fs::symlink_metadata(root.join(path)) {
            Ok(metadata) if metadata.is_dir() => None,
            Ok(_) if known.holds(root, path) => Some(count),
            Ok(_) => Some(count + 1),
            Err(_) if tracked.contains(path) => Some(count + 1),
            Err(_) => None,
        }
    })
}

fn tracked_diff(
    tracked: Option<BTreeSet<String>>,
    present: &[String],
) -> (BTreeSet<String>, BTreeSet<String>) {
    let Some(tracked) = tracked else {
        return (BTreeSet::new(), BTreeSet::new());
    };
    let present: BTreeSet<String> = present.iter().cloned().collect();
    (
        present.difference(&tracked).cloned().collect(),
        tracked.difference(&present).cloned().collect(),
    )
}

fn expanded_changes(
    root: &Path,
    paths: &[String],
    added: &BTreeSet<String>,
    removed: &BTreeSet<String>,
) -> BTreeSet<String> {
    let mut changed = BTreeSet::new();
    for path in paths {
        let prefix = format!("{path}/");
        match std::fs::symlink_metadata(root.join(path)) {
            Ok(metadata) if metadata.is_dir() => {
                changed.extend(
                    added
                        .iter()
                        .filter(|file| file.starts_with(&prefix))
                        .cloned(),
                );
            }
            Ok(_) => {
                changed.insert(path.clone());
            }
            Err(_) => {
                changed.extend(
                    removed
                        .iter()
                        .filter(|file| *file == path || file.starts_with(&prefix))
                        .cloned(),
                );
            }
        }
    }
    changed
}

fn rescan_changes(
    root: &Path,
    present: &[String],
    added: &BTreeSet<String>,
    removed: &BTreeSet<String>,
    since: SystemTime,
) -> BTreeSet<String> {
    let mut changed: BTreeSet<String> = added.union(removed).cloned().collect();
    changed.extend(
        present
            .iter()
            .filter(|file| modified_after(&root.join(file), since))
            .cloned(),
    );
    changed
}

fn modified_after(path: &Path, since: SystemTime) -> bool {
    std::fs::symlink_metadata(path)
        .and_then(|metadata| metadata.modified())
        .is_ok_and(|modified| modified > since)
}

fn present_files(root: &Path) -> Vec<String> {
    let mut files = Vec::new();
    let mut pending = vec![root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        let Ok(entries) = std::fs::read_dir(&directory) else {
            continue;
        };
        for entry in entries.flatten() {
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            let path = entry.path();
            if kind.is_dir() && descends(root, &directory, &entry.file_name()) {
                pending.push(path);
            } else if kind.is_file() {
                files.extend(crate::folder_watch::relevant_path(root, &path));
            }
        }
    }
    files.sort();
    files
}

fn descends(root: &Path, directory: &Path, name: &OsStr) -> bool {
    !oleafly_core::is_skipped_scan_directory(name)
        && !(directory == root && name == crate::typst_packages::VENDOR_DIR)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::collab::testing::{track, RecordedPauses, TempLibrary};
    use oleafly_collab::paths::CollabPaths;
    use std::time::Duration;

    fn paused(project_id: &str, changed: usize, total: usize, reason: PauseReason) -> SyncPaused {
        SyncPaused {
            project_id: project_id.to_owned(),
            changed,
            total,
            reason,
        }
    }

    #[test]
    fn the_app_emits_the_pause_with_the_payload_the_window_reads() {
        use tauri::Listener as _;
        let app = tauri::test::mock_app();
        let heard = Arc::new(Mutex::new(Vec::<serde_json::Value>::new()));
        let sink = Arc::clone(&heard);
        app.listen_any(SYNC_PAUSED_EVENT, move |event| {
            sink.lock()
                .unwrap()
                .push(serde_json::from_str(event.payload()).unwrap());
        });
        let host: &dyn SyncPauseHost = app.handle();

        host.sync_paused(&paused("paper", 40, 120, PauseReason::MassChange));
        host.sync_paused(&paused("paper", 0, 120, PauseReason::RootUnavailable));

        assert_eq!(SYNC_PAUSED_EVENT, "collab-sync-paused");
        assert_eq!(
            *heard.lock().unwrap(),
            [
                serde_json::json!({ "projectId": "paper", "changed": 40, "total": 120, "reason": "mass_change" }),
                serde_json::json!({ "projectId": "paper", "changed": 0, "total": 120, "reason": "root_unavailable" }),
            ]
        );
    }

    fn change(project_id: &str, paths: &[&str]) -> FolderChange {
        FolderChange {
            project_id: project_id.to_owned(),
            paths: paths.iter().map(|path| (*path).to_owned()).collect(),
            rescan: false,
            structural: false,
            renamed: Vec::new(),
            deleted: Vec::new(),
        }
    }

    fn rescan(project_id: &str) -> FolderChange {
        FolderChange {
            project_id: project_id.to_owned(),
            paths: Vec::new(),
            rescan: true,
            structural: true,
            renamed: Vec::new(),
            deleted: Vec::new(),
        }
    }

    fn set_modified(path: &Path, at: SystemTime) {
        std::fs::File::options()
            .write(true)
            .open(path)
            .unwrap()
            .set_modified(at)
            .unwrap();
    }

    const THREE: [(&str, &str); 3] = [("main.tex", "a"), ("refs.bib", "b"), ("intro.tex", "c")];

    #[test]
    fn one_save_in_a_three_file_project_never_pauses_and_three_saves_do() {
        let library = TempLibrary::new();
        let root = library.project("guard-three", &THREE);
        track("guard-three", &["main.tex", "refs.bib", "intro.tex"]);
        let pauses = Arc::new(RecordedPauses::default());
        let guard = MassChangeGuard::new("guard-three", &root, pauses.clone());

        let one = guard.inspect(&change("guard-three", &["main.tex"]));
        let two = guard.inspect(&change("guard-three", &["main.tex", "refs.bib"]));
        let quiet = pauses.taken();
        let three = guard.inspect(&change(
            "guard-three",
            &["intro.tex", "main.tex", "refs.bib"],
        ));

        assert!(matches!(one, MassChangeVerdict::Apply));
        assert!(matches!(two, MassChangeVerdict::Apply));
        assert!(quiet.is_empty(), "{quiet:?}");
        assert!(matches!(
            three,
            MassChangeVerdict::Pause {
                changed: 3,
                total: 3
            }
        ));
        assert_eq!(
            pauses.taken(),
            [paused("guard-three", 3, 3, PauseReason::MassChange)]
        );
    }

    #[test]
    fn ten_changed_files_pause_a_large_project_and_nine_do_not() {
        let library = TempLibrary::new();
        let names: Vec<String> = (0..100)
            .map(|index| format!("sections/s{index:02}.tex"))
            .collect();
        let files: Vec<(&str, &str)> = names.iter().map(|name| (name.as_str(), "x")).collect();
        let root = library.project("guard-large", &files);
        let tracked: Vec<&str> = names.iter().map(String::as_str).collect();
        track("guard-large", &tracked);
        let pauses = Arc::new(RecordedPauses::default());
        let guard = MassChangeGuard::new("guard-large", &root, pauses.clone());

        let nine = guard.inspect(&change("guard-large", &tracked[..9]));
        let ten = guard.inspect(&change("guard-large", &tracked[..10]));

        assert!(matches!(nine, MassChangeVerdict::Apply));
        assert!(matches!(
            ten,
            MassChangeVerdict::Pause {
                changed: 10,
                total: 100
            }
        ));
        assert_eq!(
            pauses.taken(),
            [paused("guard-large", 10, 100, PauseReason::MassChange)]
        );
    }

    #[test]
    fn folders_count_files_that_arrived_or_left_but_never_the_tracked_files_inside() {
        let library = TempLibrary::new();
        let names = [
            "main.tex",
            "chapters/one.tex",
            "chapters/two.tex",
            "chapters/three.tex",
            "chapters/four.tex",
        ];
        let files: Vec<(&str, &str)> = names.iter().map(|name| (*name, "x")).collect();
        let root = library.project("guard-folder", &files);
        track("guard-folder", &names);
        let pauses = Arc::new(RecordedPauses::default());
        let guard = MassChangeGuard::new("guard-folder", &root, pauses.clone());

        let parent_event =
            guard.inspect(&change("guard-folder", &["chapters", "chapters/one.tex"]));
        let quiet = pauses.taken();
        std::fs::create_dir(root.join("appendix")).unwrap();
        for name in ["a.tex", "b.tex", "c.tex"] {
            std::fs::write(root.join("appendix").join(name), "x").unwrap();
        }
        let moved_in = guard.inspect(&change("guard-folder", &["appendix"]));
        std::fs::remove_dir_all(root.join("chapters")).unwrap();
        let deleted = guard.inspect(&change("guard-folder", &["chapters"]));

        assert!(matches!(parent_event, MassChangeVerdict::Apply));
        assert!(quiet.is_empty(), "{quiet:?}");
        assert!(matches!(
            moved_in,
            MassChangeVerdict::Pause {
                changed: 3,
                total: 5
            }
        ));
        assert!(matches!(
            deleted,
            MassChangeVerdict::Pause {
                changed: 4,
                total: 5
            }
        ));
        assert_eq!(
            pauses.taken(),
            [
                paused("guard-folder", 3, 5, PauseReason::MassChange),
                paused("guard-folder", 4, 5, PauseReason::MassChange),
            ]
        );
    }

    #[test]
    fn a_rescan_counts_new_missing_and_freshly_written_files_but_not_oleaflys_own() {
        let library = TempLibrary::new();
        let names: Vec<String> = (0..12).map(|index| format!("f{index:02}.tex")).collect();
        let files: Vec<(&str, &str)> = names.iter().map(|name| (name.as_str(), "x")).collect();
        let root = library.project("guard-rescan", &files);
        let tracked: Vec<&str> = names.iter().map(String::as_str).collect();
        track("guard-rescan", &tracked);
        let past = SystemTime::now() - Duration::from_secs(60);
        for name in &names {
            set_modified(&root.join(name), past);
        }
        let pauses = Arc::new(RecordedPauses::default());
        let guard = MassChangeGuard::new("guard-rescan", &root, pauses.clone());
        let later = SystemTime::now() + Duration::from_secs(5);
        for name in ["f00.tex", "f01.tex", "f03.tex"] {
            std::fs::write(root.join(name), "edited elsewhere").unwrap();
            set_modified(&root.join(name), later);
        }
        crate::folder_watch::note_own_write(&root.join("f03.tex"));
        std::fs::remove_file(root.join("f02.tex")).unwrap();
        std::fs::write(root.join("new.tex"), "x").unwrap();

        let verdict = guard.inspect(&rescan("guard-rescan"));

        assert!(matches!(
            verdict,
            MassChangeVerdict::Pause {
                changed: 4,
                total: 12
            }
        ));
        assert_eq!(
            pauses.taken(),
            [paused("guard-rescan", 4, 12, PauseReason::MassChange)]
        );
    }

    fn index_of(project_id: &str) -> PathBuf {
        let index = CollabPaths::new(crate::paths::collab_root().unwrap())
            .materializer_index_file(project_id)
            .unwrap();
        std::fs::create_dir_all(index.parent().unwrap()).unwrap();
        index
    }

    fn remember_written(project_id: &str, files: &[(&str, &str)]) {
        let index = index_of(project_id);
        let mut written = crate::collab::disk::DiskState::load(&index);
        written.hashes = files
            .iter()
            .map(|(path, text)| {
                (
                    (*path).to_owned(),
                    crate::collab::disk::sha256_hex(text.as_bytes()),
                )
            })
            .collect();
        written.save(&index).unwrap();
    }

    fn as_a_session_left_it(project_id: &str, files: &[(&str, &str)]) {
        let mut doc = oleafly_collab::doc::ProjectDoc::create().unwrap();
        let mut folders = std::collections::BTreeMap::new();
        for (path, text) in files {
            let parent = path.rsplit_once('/').map(|(folder, _)| {
                folders
                    .entry(folder.to_owned())
                    .or_insert_with(|| {
                        doc.add_node(None, folder, oleafly_collab::doc::NodeKind::Dir, None, "")
                            .unwrap()
                    })
                    .clone()
            });
            let name = path.rsplit_once('/').map_or(*path, |(_, name)| name);
            doc.add_node(
                parent.as_deref(),
                name,
                oleafly_collab::doc::NodeKind::Text,
                None,
                text,
            )
            .unwrap();
        }
        let index = index_of(project_id);
        crate::collab::disk::DiskState {
            layout: oleafly_collab::materialize::layout(&doc.nodes().unwrap()),
            hashes: files
                .iter()
                .map(|(path, text)| {
                    (
                        (*path).to_owned(),
                        crate::collab::disk::sha256_hex(text.as_bytes()),
                    )
                })
                .collect(),
            owed: Default::default(),
        }
        .save(&index)
        .unwrap();
    }

    #[test]
    fn a_folder_deleted_while_live_pauses_with_only_the_index_a_session_keeps() {
        let library = TempLibrary::new();
        let files = [
            ("main.tex", "main"),
            ("chapters/one.tex", "one"),
            ("chapters/two.tex", "two"),
            ("chapters/three.tex", "three"),
            ("chapters/four.tex", "four"),
        ];
        let root = library.project("guard-session-folder", &files);
        as_a_session_left_it("guard-session-folder", &files);
        let pauses = Arc::new(RecordedPauses::default());
        let guard = MassChangeGuard::new("guard-session-folder", &root, pauses.clone());

        let saved = guard.inspect(&change("guard-session-folder", &["chapters/one.tex"]));
        std::fs::remove_dir_all(root.join("chapters")).unwrap();
        let deleted = guard.inspect(&change("guard-session-folder", &["chapters"]));

        assert!(matches!(saved, MassChangeVerdict::Apply), "{saved:?}");
        assert!(
            matches!(
                deleted,
                MassChangeVerdict::Pause {
                    changed: 4,
                    total: 5
                }
            ),
            "{deleted:?}"
        );
        assert_eq!(
            pauses.taken(),
            [paused(
                "guard-session-folder",
                4,
                5,
                PauseReason::MassChange
            )]
        );
    }

    #[test]
    fn a_rescan_while_live_counts_deleted_files_with_only_the_index_a_session_keeps() {
        let library = TempLibrary::new();
        let names: Vec<String> = (0..12).map(|index| format!("f{index:02}.tex")).collect();
        let files: Vec<(&str, &str)> = names.iter().map(|name| (name.as_str(), "x")).collect();
        let root = library.project("guard-session-rescan", &files);
        as_a_session_left_it("guard-session-rescan", &files);
        let past = SystemTime::now() - Duration::from_secs(60);
        for name in &names {
            set_modified(&root.join(name), past);
        }
        let pauses = Arc::new(RecordedPauses::default());
        let guard = MassChangeGuard::new("guard-session-rescan", &root, pauses.clone());
        for name in ["f00.tex", "f01.tex", "f02.tex", "f03.tex"] {
            std::fs::remove_file(root.join(name)).unwrap();
        }

        let verdict = guard.inspect(&rescan("guard-session-rescan"));

        assert!(
            matches!(
                verdict,
                MassChangeVerdict::Pause {
                    changed: 4,
                    total: 12
                }
            ),
            "{verdict:?}"
        );
    }

    #[test]
    fn a_restore_that_rewrites_every_file_counts_only_the_files_whose_content_changed() {
        let library = TempLibrary::new();
        let names: Vec<String> = (0..23)
            .map(|index| format!("chapters/c{index:02}.tex"))
            .collect();
        let texts: Vec<String> = names
            .iter()
            .map(|name| format!("text of {name}\n"))
            .collect();
        let files: Vec<(&str, &str)> = names
            .iter()
            .zip(&texts)
            .map(|(name, text)| (name.as_str(), text.as_str()))
            .collect();
        let root = library.project("guard-restore", &files);
        let tracked: Vec<&str> = names.iter().map(String::as_str).collect();
        track("guard-restore", &tracked);
        remember_written("guard-restore", &files);
        let pauses = Arc::new(RecordedPauses::default());
        let named = MassChangeGuard::new("guard-restore", &root, pauses.clone());
        let rescanned = MassChangeGuard::new("guard-restore", &root, pauses.clone());
        let later = SystemTime::now() + Duration::from_secs(5);
        for (name, text) in &files {
            std::fs::write(root.join(name), text).unwrap();
            set_modified(&root.join(name), later);
        }
        std::fs::write(root.join(names[4].as_str()), "the restored older text\n").unwrap();
        set_modified(&root.join(names[4].as_str()), later);

        let by_name = named.inspect(&change("guard-restore", &tracked));
        let by_rescan = rescanned.inspect(&rescan("guard-restore"));

        assert!(matches!(by_name, MassChangeVerdict::Apply), "{by_name:?}");
        assert!(
            matches!(by_rescan, MassChangeVerdict::Apply),
            "{by_rescan:?}"
        );
        assert!(pauses.taken().is_empty());
    }

    #[test]
    fn a_restore_that_really_changes_many_files_still_pauses() {
        let library = TempLibrary::new();
        let names: Vec<String> = (0..23)
            .map(|index| format!("chapters/c{index:02}.tex"))
            .collect();
        let texts: Vec<String> = names
            .iter()
            .map(|name| format!("text of {name}\n"))
            .collect();
        let files: Vec<(&str, &str)> = names
            .iter()
            .zip(&texts)
            .map(|(name, text)| (name.as_str(), text.as_str()))
            .collect();
        let root = library.project("guard-restore-many", &files);
        let tracked: Vec<&str> = names.iter().map(String::as_str).collect();
        track("guard-restore-many", &tracked);
        remember_written("guard-restore-many", &files);
        let pauses = Arc::new(RecordedPauses::default());
        let guard = MassChangeGuard::new("guard-restore-many", &root, pauses.clone());
        for name in &names[..12] {
            std::fs::write(root.join(name), "an older version\n").unwrap();
        }

        let verdict = guard.inspect(&change("guard-restore-many", &tracked));

        assert!(matches!(
            verdict,
            MassChangeVerdict::Pause {
                changed: 12,
                total: 23
            }
        ));
        assert_eq!(
            pauses.taken(),
            [paused(
                "guard-restore-many",
                12,
                23,
                PauseReason::MassChange
            )]
        );
    }

    #[test]
    fn a_vanished_root_is_reported_once_as_unavailable_and_never_as_deletions() {
        let library = TempLibrary::new();
        let root = library.project("guard-vanish", &THREE);
        track("guard-vanish", &["main.tex", "refs.bib", "intro.tex"]);
        let pauses = Arc::new(RecordedPauses::default());
        let guard = MassChangeGuard::new("guard-vanish", &root, pauses.clone());
        std::fs::remove_dir_all(&root).unwrap();
        let every_file = ["intro.tex", "main.tex", "refs.bib"];

        let first = guard.inspect(&change("guard-vanish", &every_file));
        let again = guard.inspect(&change("guard-vanish", &every_file));
        let from_root = guard.root_changed();
        let heard = pauses.taken();
        std::fs::create_dir(&root).unwrap();
        let back = guard.root_changed();

        assert!(matches!(first, MassChangeVerdict::RootUnavailable));
        assert!(matches!(again, MassChangeVerdict::RootUnavailable));
        assert!(matches!(
            from_root,
            Some(MassChangeVerdict::RootUnavailable)
        ));
        assert_eq!(
            heard,
            [paused("guard-vanish", 0, 3, PauseReason::RootUnavailable)]
        );
        assert!(back.is_none());
    }

    #[test]
    fn the_app_emits_the_resume_with_the_project_the_window_reads() {
        use tauri::Listener as _;
        let app = tauri::test::mock_app();
        let heard = Arc::new(Mutex::new(Vec::<serde_json::Value>::new()));
        let sink = Arc::clone(&heard);
        app.listen_any(SYNC_RESUMED_EVENT, move |event| {
            sink.lock()
                .unwrap()
                .push(serde_json::from_str(event.payload()).unwrap());
        });
        let host: &dyn SyncPauseHost = app.handle();

        host.sync_resumed(&SyncResumed {
            project_id: "paper".to_owned(),
        });

        assert_eq!(SYNC_RESUMED_EVENT, "collab-sync-resumed");
        assert_eq!(
            *heard.lock().unwrap(),
            [serde_json::json!({ "projectId": "paper" })]
        );
    }

    #[test]
    fn a_root_that_comes_back_is_reported_as_resumed_once() {
        let library = TempLibrary::new();
        let root = library.project("guard-back", &THREE);
        track("guard-back", &["main.tex", "refs.bib", "intro.tex"]);
        let pauses = Arc::new(RecordedPauses::default());
        let guard = MassChangeGuard::new("guard-back", &root, pauses.clone());
        let present = guard.root_changed();
        std::fs::remove_dir_all(&root).unwrap();
        let lost = guard.root_changed();
        let still_lost = guard.inspect(&change("guard-back", &["main.tex"]));
        let quiet = pauses.resumed();
        std::fs::create_dir(&root).unwrap();
        let back = guard.root_changed();
        let again = guard.root_changed();

        assert!(present.is_none());
        assert!(matches!(lost, Some(MassChangeVerdict::RootUnavailable)));
        assert!(matches!(still_lost, MassChangeVerdict::RootUnavailable));
        assert!(quiet.is_empty(), "{quiet:?}");
        assert!(back.is_none());
        assert!(again.is_none());
        assert_eq!(
            pauses.resumed(),
            [SyncResumed {
                project_id: "guard-back".to_owned()
            }]
        );
    }

    #[test]
    fn a_root_seen_again_by_an_inspection_is_reported_as_resumed() {
        let library = TempLibrary::new();
        let root = library.project("guard-seen", &THREE);
        track("guard-seen", &["main.tex", "refs.bib", "intro.tex"]);
        let pauses = Arc::new(RecordedPauses::default());
        let guard = MassChangeGuard::new("guard-seen", &root, pauses.clone());
        let parked = root.with_file_name("guard-seen-parked");
        std::fs::rename(&root, &parked).unwrap();
        let _ = guard.root_changed();
        std::fs::rename(&parked, &root).unwrap();

        let back = guard.inspect(&change("guard-seen", &["main.tex"]));

        assert!(matches!(back, MassChangeVerdict::Apply));
        assert_eq!(
            pauses.resumed(),
            [SyncResumed {
                project_id: "guard-seen".to_owned()
            }]
        );
    }

    #[test]
    fn only_the_first_caller_waits_for_a_lost_root() {
        let library = TempLibrary::new();
        let root = library.project("guard-wait", &THREE);
        let guard = MassChangeGuard::new("guard-wait", &root, Arc::new(RecordedPauses::default()));

        let first = guard.begin_waiting();
        let second = guard.begin_waiting();
        guard.end_waiting();
        let after = guard.begin_waiting();

        assert!(first);
        assert!(!second);
        assert!(after);
    }

    #[test]
    fn without_a_file_map_the_files_on_disk_are_the_total_and_build_output_is_not() {
        let library = TempLibrary::new();
        let root = library.project("guard-unmapped", &THREE);
        std::fs::create_dir_all(root.join(".oleafly/build")).unwrap();
        std::fs::write(root.join(".oleafly/build/main.pdf"), "pdf").unwrap();
        std::fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
        std::fs::write(root.join("node_modules/pkg/index.js"), "x").unwrap();
        let pauses = Arc::new(RecordedPauses::default());
        let guard = MassChangeGuard::new("guard-unmapped", &root, pauses.clone());

        let one = guard.inspect(&change("guard-unmapped", &["main.tex"]));
        let three = guard.inspect(&change(
            "guard-unmapped",
            &["intro.tex", "main.tex", "refs.bib"],
        ));

        assert!(matches!(one, MassChangeVerdict::Apply));
        assert!(matches!(
            three,
            MassChangeVerdict::Pause {
                changed: 3,
                total: 3
            }
        ));
        assert_eq!(
            pauses.taken(),
            [paused("guard-unmapped", 3, 3, PauseReason::MassChange)]
        );
    }
}
