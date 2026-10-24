//! What the Windows sandbox grants for one command, as data: the access
//! entries `prepare` writes, in the order it writes them. Platform-neutral so
//! the rules (which paths a grant already covers, what is protected or
//! hidden, which folders get traverse entries) are tested everywhere.
use std::collections::HashSet;
use std::path::{Path, PathBuf};

use crate::ledger::{GrantAccess, GrantRecord, GrantScope};
use crate::ResolvedSpec;

/// The SIDs a command runs with, as SDDL text.
pub(crate) struct Sids<'a> {
    /// The task's own AppContainer profile.
    pub package: &'a str,
    /// The capability every task carries (interpreters, agents, skills).
    pub runtime: &'a str,
    /// The project's capability (its linked data folders).
    pub project: Option<&'a str>,
}

/// One access entry to write.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Step {
    pub record: GrantRecord,
    /// The traverse entries on the ancestors of one read root share a number:
    /// a folder that refuses one ends that root's climb.
    pub chain: Option<usize>,
}

struct Plan<'a> {
    owner: &'a str,
    steps: Vec<Step>,
    chains: usize,
}

impl Plan<'_> {
    fn push(&mut self, path: &Path, sid: &str, scope: GrantScope, access: GrantAccess) {
        self.push_in(path, sid, scope, access, None);
    }

    fn push_in(
        &mut self,
        path: &Path,
        sid: &str,
        scope: GrantScope,
        access: GrantAccess,
        chain: Option<usize>,
    ) {
        self.steps.push(Step {
            record: GrantRecord {
                path: path.to_path_buf(),
                sid: sid.to_owned(),
                scope,
                access,
                applied: false,
                original: None,
            },
            chain,
        });
    }

    fn task(&self) -> GrantScope {
        GrantScope::Task {
            owner: self.owner.to_owned(),
        }
    }

    /// Traverse entries for `sid` on the ancestors of `root`, nearest first,
    /// up to (not including) the top. The caller stops at the first folder
    /// whose access list the user cannot change.
    fn traverse_ancestors(&mut self, root: &Path, sid: &str) {
        let chain = self.chains;
        self.chains += 1;
        let mut current = root.parent();
        while let Some(folder) = current {
            if folder.parent().is_none() {
                break;
            }
            self.push_in(
                folder,
                sid,
                GrantScope::Runtimes,
                GrantAccess::Traverse,
                Some(chain),
            );
            current = folder.parent();
        }
    }
}

/// A write grant on a file whose folder is granted already adds nothing.
/// `writes` holds every write grant; checking the folder's ancestors against
/// a set keeps this linear however many grants there are.
fn covered_by_folder(path: &Path, writes: &HashSet<&Path>) -> bool {
    path.is_file()
        && path
            .parent()
            .is_some_and(|parent| parent.ancestors().any(|folder| writes.contains(folder)))
}

/// The entries `spec` needs for a task whose SIDs are `sids`.
pub(crate) fn plan(spec: &ResolvedSpec, sids: &Sids<'_>) -> Vec<Step> {
    let mut plan = Plan {
        owner: &spec.owner,
        steps: Vec::new(),
        chains: 0,
    };
    plan.push(
        &spec.workspace,
        sids.package,
        plan.task(),
        GrantAccess::Read,
    );
    let mut writes: Vec<&PathBuf> = spec.read_write.iter().collect();
    writes.sort_by_key(|path| path.components().count());
    let write_set: HashSet<&Path> = writes.iter().map(|path| path.as_path()).collect();
    for path in &writes {
        if covered_by_folder(path, &write_set) {
            continue;
        }
        plan.push(path, sids.package, plan.task(), GrantAccess::ReadWrite);
    }
    plan.push(
        &spec.home,
        sids.package,
        plan.task(),
        GrantAccess::ReadWrite,
    );
    // Protected paths stay readable and can't be changed; hidden ones can't
    // be read either. A task with FILE_DELETE_CHILD on the folder that holds
    // one could remove it and put its own in its place, so that folder
    // refuses the right (when a write grant gives the task the folder at all).
    let in_a_write_grant = |folder: &Path| writes.iter().any(|write| folder.starts_with(write));
    let protected = spec.protected.iter().map(|path| {
        let access = if path.is_dir() {
            GrantAccess::DenyWrite
        } else {
            GrantAccess::Excluded
        };
        (path, access)
    });
    let hidden = spec.hidden.iter().map(|path| {
        let access = if path.is_dir() {
            GrantAccess::DenyAll
        } else {
            GrantAccess::Excluded
        };
        (path, access)
    });
    let mut guarded: HashSet<&Path> = HashSet::new();
    for (path, access) in protected.chain(hidden) {
        plan.push(path, sids.package, plan.task(), access);
        let folder = path.parent().filter(|folder| in_a_write_grant(folder));
        if let Some(folder) = folder.filter(|folder| guarded.insert(folder)) {
            plan.push(
                folder,
                sids.package,
                plan.task(),
                GrantAccess::DenyDeleteChild,
            );
        }
    }
    for root in &spec.read_only {
        plan.push(root, sids.runtime, GrantScope::Runtimes, GrantAccess::Read);
        plan.traverse_ancestors(root, sids.runtime);
    }
    if let (Some(project), Some(project_sid)) = (&spec.project, sids.project) {
        for root in &spec.project_read_only {
            plan.push(
                root,
                project_sid,
                GrantScope::Project {
                    project: project.clone(),
                },
                GrantAccess::Read,
            );
            plan.traverse_ancestors(root, sids.runtime);
        }
    }
    plan.steps
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    const PACKAGE: &str = "S-1-15-2-1";
    const RUNTIME: &str = "S-1-15-3-1024-1";
    const PROJECT: &str = "S-1-15-3-1024-2";

    fn spec(workspace: &Path, home: &Path) -> ResolvedSpec {
        ResolvedSpec {
            workspace: workspace.to_path_buf(),
            home: home.to_path_buf(),
            read_only: Vec::new(),
            project_read_only: Vec::new(),
            read_write: Vec::new(),
            protected: Vec::new(),
            missing_protected: Vec::new(),
            hidden: Vec::new(),
            network: false,
            gpu: false,
            child_processes: false,
            owner: "agent:run1".into(),
            project: Some("p1".into()),
            path_prepend: Vec::new(),
            env: BTreeMap::new(),
        }
    }

    fn sids() -> Sids<'static> {
        Sids {
            package: PACKAGE,
            runtime: RUNTIME,
            project: Some(PROJECT),
        }
    }

    fn entries(steps: &[Step]) -> Vec<(PathBuf, GrantAccess)> {
        steps
            .iter()
            .map(|step| (step.record.path.clone(), step.record.access))
            .collect()
    }

    struct Folders {
        root: tempfile::TempDir,
    }

    impl Folders {
        fn new() -> Self {
            let root = tempfile::tempdir().unwrap();
            let root = Self { root };
            for folder in ["work", "home", "work/src", "work/.git", "work/.private"] {
                std::fs::create_dir_all(root.path(folder)).unwrap();
            }
            std::fs::write(root.path("work/src/a.tex"), "a").unwrap();
            std::fs::write(root.path("work/.env"), "SECRET=1").unwrap();
            std::fs::write(root.path("work/.git/config"), "[core]").unwrap();
            root
        }

        fn path(&self, relative: &str) -> PathBuf {
            self.root.path().join(relative)
        }
    }

    #[test]
    fn a_task_gets_read_on_the_workspace_and_write_on_its_grants_and_home() {
        let folders = Folders::new();
        let mut spec = spec(&folders.path("work"), &folders.path("home"));
        spec.read_write = vec![folders.path("work/src/a.tex"), folders.path("work/src")];
        let steps = plan(&spec, &sids());
        assert_eq!(
            entries(&steps),
            vec![
                (folders.path("work"), GrantAccess::Read),
                // The folder first; the file inside it adds nothing.
                (folders.path("work/src"), GrantAccess::ReadWrite),
                (folders.path("home"), GrantAccess::ReadWrite),
            ]
        );
        assert!(steps.iter().all(|step| step.record.sid == PACKAGE
            && step.record.scope
                == GrantScope::Task {
                    owner: "agent:run1".into()
                }
            && !step.record.applied));
    }

    #[test]
    fn a_file_grant_alone_is_written() {
        let folders = Folders::new();
        let mut spec = spec(&folders.path("work"), &folders.path("home"));
        spec.read_write = vec![folders.path("work/src/a.tex")];
        let steps = entries(&plan(&spec, &sids()));
        assert!(steps.contains(&(folders.path("work/src/a.tex"), GrantAccess::ReadWrite)));
    }

    #[test]
    fn protected_and_hidden_paths_get_entries_and_their_folder_keeps_delete_child() {
        let folders = Folders::new();
        let work = folders.path("work");
        let mut spec = spec(&work, &folders.path("home"));
        spec.read_write = vec![work.clone()];
        spec.protected = vec![folders.path("work/.git")];
        spec.hidden = vec![folders.path("work/.private"), folders.path("work/.env")];
        let steps = entries(&plan(&spec, &sids()));
        let at = |path: &str, access| {
            steps
                .iter()
                .position(|step| step == &(folders.path(path), access))
                .unwrap_or_else(|| panic!("{path} {access:?} missing in {steps:?}"))
        };
        let write = at("work", GrantAccess::ReadWrite);
        // A folder: readable, not changeable. A file: no access.
        assert!(at("work/.git", GrantAccess::DenyWrite) > write);
        assert!(at("work/.private", GrantAccess::DenyAll) > write);
        assert!(at("work/.env", GrantAccess::Excluded) > write);
        // The workspace holds them all and is a write grant: one entry.
        let deletes = steps
            .iter()
            .filter(|step| **step == (work.clone(), GrantAccess::DenyDeleteChild))
            .count();
        assert_eq!(deletes, 1);
        assert!(at("work", GrantAccess::DenyDeleteChild) > write);
    }

    #[test]
    fn no_delete_child_entry_when_the_folder_is_not_a_write_grant() {
        let folders = Folders::new();
        let work = folders.path("work");
        let mut spec = spec(&work, &folders.path("home"));
        // The task writes in `src` only; `.git` sits beside it.
        spec.read_write = vec![folders.path("work/src")];
        spec.protected = vec![folders.path("work/.git")];
        let steps = entries(&plan(&spec, &sids()));
        assert!(!steps
            .iter()
            .any(|(_, access)| *access == GrantAccess::DenyDeleteChild));
        assert!(steps.contains(&(folders.path("work/.git"), GrantAccess::DenyWrite)));
    }

    #[test]
    fn read_roots_get_the_shared_capability_and_traverse_on_their_ancestors() {
        let folders = Folders::new();
        let mut spec = spec(&folders.path("work"), &folders.path("home"));
        let python = folders.path("tools/python");
        std::fs::create_dir_all(&python).unwrap();
        let data = folders.path("data/survey");
        std::fs::create_dir_all(&data).unwrap();
        spec.read_only = vec![python.clone()];
        spec.project_read_only = vec![data.clone()];
        let steps = plan(&spec, &sids());
        let step_for = |path: &Path, access| {
            steps
                .iter()
                .find(|step| step.record.path == path && step.record.access == access)
                .unwrap_or_else(|| panic!("{} {access:?} missing", path.display()))
        };
        let read = step_for(&python, GrantAccess::Read);
        assert_eq!(read.record.sid, RUNTIME);
        assert_eq!(read.record.scope, GrantScope::Runtimes);
        let project = step_for(&data, GrantAccess::Read);
        assert_eq!(project.record.sid, PROJECT);
        assert_eq!(
            project.record.scope,
            GrantScope::Project {
                project: "p1".into()
            }
        );
        // The parent of each root is walked, with the runtime capability, in
        // its own chain; the top of the tree is left alone.
        let parent = step_for(python.parent().unwrap(), GrantAccess::Traverse);
        assert_eq!(parent.record.sid, RUNTIME);
        let data_parent = step_for(data.parent().unwrap(), GrantAccess::Traverse);
        assert_eq!(data_parent.record.sid, RUNTIME);
        assert_ne!(parent.chain, data_parent.chain);
        assert!(parent.chain.is_some());
        assert!(steps.iter().all(|step| step.record.path.parent().is_some()));
        // Nearest ancestor first, so a refusal ends the climb above it.
        let first = steps
            .iter()
            .position(|step| step.chain == parent.chain)
            .unwrap();
        assert_eq!(steps[first].record.path, python.parent().unwrap());
    }

    #[test]
    fn linked_folders_without_a_project_capability_are_not_planned() {
        let folders = Folders::new();
        let mut spec = spec(&folders.path("work"), &folders.path("home"));
        let data = folders.path("data");
        std::fs::create_dir_all(&data).unwrap();
        spec.project_read_only = vec![data.clone()];
        let without = Sids {
            project: None,
            ..sids()
        };
        assert!(!entries(&plan(&spec, &without))
            .iter()
            .any(|(path, _)| path == &data));
    }

    #[test]
    fn a_thousand_file_grants_plan_quickly() {
        let folders = Folders::new();
        let work = folders.path("work");
        let mut spec = spec(&work, &folders.path("home"));
        std::fs::create_dir_all(work.join("data")).unwrap();
        spec.read_write = vec![work.join("data")];
        for index in 0..1000 {
            let file = work.join("data").join(format!("f{index}.csv"));
            std::fs::write(&file, "x").unwrap();
            spec.read_write.push(file);
        }
        let steps = plan(&spec, &sids());
        // Workspace, the folder, home: the files add nothing.
        assert_eq!(steps.len(), 3);
    }
}
