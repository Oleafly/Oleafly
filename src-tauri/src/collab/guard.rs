use crate::folder_watch::FolderChange;
use oleafly_collab::file_ids::FileIdMap;
use oleafly_collab::mass_change::{evaluate, MassChangeThreshold, MassChangeVerdict};
use oleafly_collab::paths::CollabPaths;
use serde::Serialize;
use std::collections::BTreeSet;
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::SystemTime;

pub const SYNC_PAUSED_EVENT: &str = "collab-sync-paused";

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

pub(crate) trait SyncPauseHost: Send + Sync + 'static {
    fn sync_paused(&self, paused: &SyncPaused);
}

impl<R: tauri::Runtime> SyncPauseHost for tauri::AppHandle<R> {
    fn sync_paused(&self, paused: &SyncPaused) {
        use tauri::Emitter as _;
        let _ = self.emit(SYNC_PAUSED_EVENT, paused);
    }
}

pub(crate) struct MassChangeGuard {
    project_id: String,
    root: PathBuf,
    host: Arc<dyn SyncPauseHost>,
    threshold: MassChangeThreshold,
    baseline: Mutex<SystemTime>,
    root_lost: AtomicBool,
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
        }
    }

    pub(crate) fn inspect(&self, change: &FolderChange) -> MassChangeVerdict {
        let since = self.advance_baseline();
        let tracked = self.tracked();
        let tracked_total = tracked.as_ref().map_or(0, FileIdMap::len);
        if !self.root.is_dir() {
            return self.lose_root(tracked_total);
        }
        self.root_lost.store(false, Ordering::SeqCst);
        let direct = if change.rescan {
            None
        } else {
            direct_changes(&self.root, &change.paths, tracked.as_ref())
        };
        let present = if direct.is_some() && tracked_total > 0 {
            Vec::new()
        } else {
            present_files(&self.root)
        };
        let changed = match direct {
            Some(count) => count,
            None => {
                let (added, removed) = tracked_diff(tracked, &present);
                let files = if change.rescan {
                    rescan_changes(&self.root, &present, &added, &removed, since)
                } else {
                    expanded_changes(&self.root, &change.paths, &added, &removed)
                };
                files
                    .iter()
                    .filter(|file| !crate::folder_watch::is_own_write(&self.root.join(file)))
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
            self.root_lost.store(false, Ordering::SeqCst);
            return None;
        }
        let total = self.tracked().as_ref().map_or(0, FileIdMap::len);
        Some(self.lose_root(total))
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

    fn tracked(&self) -> Option<FileIdMap> {
        let file = CollabPaths::new(crate::paths::collab_root().ok()?)
            .file_ids_file(&self.project_id)
            .ok()?;
        if !file.is_file() {
            return None;
        }
        FileIdMap::load(&file).ok()
    }
}

fn direct_changes(root: &Path, paths: &[String], tracked: Option<&FileIdMap>) -> Option<usize> {
    let tracked = tracked?;
    paths.iter().try_fold(0, |count, path| {
        match std::fs::symlink_metadata(root.join(path)) {
            Ok(metadata) if metadata.is_dir() => None,
            Ok(_) => Some(count + 1),
            Err(_) if tracked.id_of(path).is_some() => Some(count + 1),
            Err(_) => None,
        }
    })
}

fn tracked_diff(
    tracked: Option<FileIdMap>,
    present: &[String],
) -> (BTreeSet<String>, BTreeSet<String>) {
    let Some(mut map) = tracked else {
        return (BTreeSet::new(), BTreeSet::new());
    };
    let report = map.reconcile(present);
    (
        report.added.into_iter().collect(),
        report.removed.into_iter().collect(),
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
        }
    }

    fn rescan(project_id: &str) -> FolderChange {
        FolderChange {
            project_id: project_id.to_owned(),
            paths: Vec::new(),
            rescan: true,
            structural: true,
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
