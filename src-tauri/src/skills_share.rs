use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use serde::Serialize;

use crate::skills::{SkillRecord, SkillValidation};

const AGENTS: [(&str, &str, &str); 5] = [
    ("claude", "Claude Code", ".claude"),
    ("codex", "Codex", ".codex"),
    ("agents", "Agents", ".agents"),
    ("cursor", "Cursor", ".cursor"),
    ("gemini", "Gemini", ".gemini"),
];

static LAST_SYNCED: Mutex<Option<BTreeSet<String>>> = Mutex::new(None);
static LAST_SUPPORTED: Mutex<BTreeMap<String, bool>> = Mutex::new(BTreeMap::new());

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareTarget {
    pub agent: String,
    pub label: String,
    pub root: String,
    pub detected: bool,
    pub linked: u32,
    pub total: u32,
    pub supported: bool,
    pub enabled: bool,
}

fn is_real_dir(path: &Path) -> bool {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) => {
            metadata.is_dir()
                && !metadata.file_type().is_symlink()
                && !crate::skills::is_reparse_point(&metadata)
        }
        Err(_) => false,
    }
}

fn symlink_dir(target: &Path, link: &Path) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(target, link)
    }
    #[cfg(windows)]
    {
        std::os::windows::fs::symlink_dir(target, link)
    }
}

fn remove_link(path: &Path) -> bool {
    std::fs::remove_file(path)
        .or_else(|_| std::fs::remove_dir(path))
        .is_ok()
}

fn symlinks_supported() -> bool {
    static PROBE: OnceLock<bool> = OnceLock::new();
    *PROBE.get_or_init(|| {
        let base =
            std::env::temp_dir().join(format!("oleafly-link-probe-{:016x}", rand::random::<u64>()));
        let target = base.join("target");
        if std::fs::create_dir_all(&target).is_err() {
            return true;
        }
        let supported = symlink_dir(&target, &base.join("link")).is_ok();
        let _ = std::fs::remove_dir_all(&base);
        supported
    })
}

fn link_points_into(link: &Path, skills: &Path) -> bool {
    let Ok(metadata) = std::fs::symlink_metadata(link) else {
        return false;
    };
    if !metadata.file_type().is_symlink() && !crate::skills::is_reparse_point(&metadata) {
        return false;
    }
    if let Ok(target) = std::fs::read_link(link) {
        if target.is_absolute() {
            return target.starts_with(skills);
        }
        if let Some(parent) = link.parent() {
            if let Ok(joined) = parent.join(&target).canonicalize() {
                return joined.starts_with(skills);
            }
        }
    }
    link.canonicalize()
        .map(|resolved| resolved.starts_with(skills))
        .unwrap_or(false)
}

pub(crate) fn shareable_ids(records: &[SkillRecord]) -> BTreeSet<String> {
    records
        .iter()
        .filter(|record| matches!(record.validation, SkillValidation::Valid))
        .filter(|record| crate::skills::validate_skill_id(&record.id).is_ok())
        .map(|record| record.id.clone())
        .collect()
}

struct TargetOutcome {
    linked: u32,
    supported: bool,
}

fn link_target(root: &Path, skills: &Path, ids: &BTreeSet<String>) -> TargetOutcome {
    let mut outcome = TargetOutcome {
        linked: 0,
        supported: true,
    };
    let folder = root.join("skills");
    if !is_real_dir(&folder) {
        if std::fs::symlink_metadata(&folder).is_ok() {
            return TargetOutcome {
                linked: 0,
                supported: false,
            };
        }
        if std::fs::create_dir_all(&folder).is_err() {
            return TargetOutcome {
                linked: 0,
                supported: false,
            };
        }
    }
    for id in ids {
        let link = folder.join(id);
        if std::fs::symlink_metadata(&link).is_ok() {
            if link_points_into(&link, skills) {
                outcome.linked += 1;
            }
            continue;
        }
        match symlink_dir(&skills.join(id), &link) {
            Ok(()) => outcome.linked += 1,
            Err(_) => outcome.supported = false,
        }
    }
    prune_links(&folder, skills, ids);
    outcome
}

fn prune_links(folder: &Path, skills: &Path, ids: &BTreeSet<String>) {
    let Ok(entries) = std::fs::read_dir(folder) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if ids.contains(&name) {
            continue;
        }
        let path = entry.path();
        if link_points_into(&path, skills) {
            let _ = remove_link(&path);
        }
    }
}

fn unlink_target(root: &Path, skills: &Path) -> TargetOutcome {
    let folder = root.join("skills");
    if !is_real_dir(&folder) {
        return TargetOutcome {
            linked: 0,
            supported: true,
        };
    }
    let Ok(entries) = std::fs::read_dir(&folder) else {
        return TargetOutcome {
            linked: 0,
            supported: true,
        };
    };
    let mut remaining = 0u32;
    for entry in entries.flatten() {
        let path = entry.path();
        if !link_points_into(&path, skills) {
            continue;
        }
        if !remove_link(&path) {
            remaining += 1;
        }
    }
    TargetOutcome {
        linked: remaining,
        supported: true,
    }
}

fn count_links(root: &Path, skills: &Path, ids: &BTreeSet<String>) -> u32 {
    let folder = root.join("skills");
    if !is_real_dir(&folder) {
        return 0;
    }
    ids.iter()
        .filter(|id| link_points_into(&folder.join(id), skills))
        .count() as u32
}

pub(crate) fn targets_in(
    home: &Path,
    skills: &Path,
    ids: &BTreeSet<String>,
    enabled: bool,
) -> Vec<ShareTarget> {
    let total = ids.len() as u32;
    AGENTS
        .iter()
        .map(|(agent, label, folder)| {
            let root = home.join(folder);
            let detected = is_real_dir(&root);
            ShareTarget {
                agent: (*agent).to_string(),
                label: (*label).to_string(),
                root: root.to_string_lossy().to_string(),
                detected,
                linked: if detected {
                    count_links(&root, skills, ids)
                } else {
                    0
                },
                total,
                supported: symlinks_supported(),
                enabled,
            }
        })
        .collect()
}

fn remember_supported(targets: &[ShareTarget]) {
    if let Ok(mut last) = LAST_SUPPORTED.lock() {
        for target in targets {
            if target.detected {
                last.insert(target.agent.clone(), target.supported);
            }
        }
    }
}

fn apply_remembered_supported(targets: &mut [ShareTarget]) {
    let Ok(last) = LAST_SUPPORTED.lock() else {
        return;
    };
    for target in targets.iter_mut() {
        if let Some(supported) = last.get(&target.agent) {
            target.supported = *supported;
        }
    }
}

pub(crate) fn sync_in(
    home: &Path,
    skills: &Path,
    ids: &BTreeSet<String>,
    enabled: bool,
) -> Vec<ShareTarget> {
    let total = ids.len() as u32;
    AGENTS
        .iter()
        .map(|(agent, label, folder)| {
            let root = home.join(folder);
            let detected = is_real_dir(&root);
            let outcome = if !detected {
                TargetOutcome {
                    linked: 0,
                    supported: true,
                }
            } else if enabled {
                link_target(&root, skills, ids)
            } else {
                unlink_target(&root, skills)
            };
            ShareTarget {
                agent: (*agent).to_string(),
                label: (*label).to_string(),
                root: root.to_string_lossy().to_string(),
                detected,
                linked: outcome.linked,
                total,
                supported: outcome.supported,
                enabled,
            }
        })
        .collect()
}

fn share_enabled() -> bool {
    crate::config::read_config()
        .map(|config| config.skills_share_with_agents)
        .unwrap_or(true)
}

fn share_home() -> Result<PathBuf, String> {
    if let Some(dir) = std::env::var_os("OLEAFLY_SHARE_HOME") {
        if !dir.is_empty() {
            return Ok(PathBuf::from(dir));
        }
    }
    if throwaway_data_dir() {
        return crate::paths::oleafly_root();
    }
    crate::paths::home_dir()
}

fn resolved_roots() -> Result<(PathBuf, PathBuf), String> {
    let home = share_home()?;
    let skills = crate::skills::managed_skills_root(&crate::paths::oleafly_root()?)?;
    Ok((home, skills))
}

fn remember(ids: &BTreeSet<String>) {
    if let Ok(mut last) = LAST_SYNCED.lock() {
        *last = Some(ids.clone());
    }
}

fn forget() {
    if let Ok(mut last) = LAST_SYNCED.lock() {
        *last = None;
    }
    if let Ok(mut last) = LAST_SUPPORTED.lock() {
        last.clear();
    }
}

fn changed_since_last_sync(ids: &BTreeSet<String>) -> bool {
    match LAST_SYNCED.lock() {
        Ok(last) => last.as_ref() != Some(ids),
        Err(_) => true,
    }
}

fn throwaway_data_dir() -> bool {
    std::env::var_os("OLEAFLY_DATA_DIR").is_some_and(|dir| !dir.is_empty())
}

pub(crate) fn sync_after_list(records: &[SkillRecord]) {
    if throwaway_data_dir() {
        return;
    }
    let ids = shareable_ids(records);
    if !changed_since_last_sync(&ids) {
        return;
    }
    if !share_enabled() {
        remember(&ids);
        return;
    }
    let Ok((home, skills)) = resolved_roots() else {
        return;
    };
    let targets = sync_in(&home, &skills, &ids, true);
    remember_supported(&targets);
    for target in &targets {
        if target.detected && !target.supported {
            eprintln!(
                "skills: could not link the shared skills folder for {}",
                target.agent
            );
        }
    }
    remember(&ids);
}

pub(crate) fn resync_now() {
    forget();
    if !share_enabled() {
        return;
    }
    let Ok(root) = crate::paths::oleafly_root() else {
        return;
    };
    let Ok(records) = crate::skills::list_with(
        &root,
        crate::skills_pack::cached_pack_root().as_deref(),
        None,
    ) else {
        return;
    };
    sync_after_list(&records);
}

#[tauri::command]
pub fn skills_share_targets() -> Result<Vec<ShareTarget>, String> {
    let (home, skills) = resolved_roots()?;
    let records = crate::skills::list_with(
        &crate::paths::oleafly_root()?,
        crate::skills_pack::cached_pack_root().as_deref(),
        None,
    )?;
    let ids = shareable_ids(&records);
    let mut targets = targets_in(&home, &skills, &ids, share_enabled());
    apply_remembered_supported(&mut targets);
    Ok(targets)
}

#[tauri::command]
pub fn skills_share_sync(enabled: bool) -> Result<Vec<ShareTarget>, String> {
    crate::config::update_config(|config| {
        config.skills_share_with_agents = enabled;
        Ok(())
    })?;
    let (home, skills) = resolved_roots()?;
    let records = crate::skills::list_with(
        &crate::paths::oleafly_root()?,
        crate::skills_pack::cached_pack_root().as_deref(),
        None,
    )?;
    let ids = shareable_ids(&records);
    let targets = sync_in(&home, &skills, &ids, enabled);
    remember(&ids);
    remember_supported(&targets);
    Ok(targets)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(values: &[&str]) -> BTreeSet<String> {
        values.iter().map(|value| (*value).to_string()).collect()
    }

    fn managed(root: &Path, id: &str) -> PathBuf {
        let directory = root.join(id);
        std::fs::create_dir_all(&directory).unwrap();
        std::fs::write(directory.join("SKILL.md"), "---\n---\n").unwrap();
        directory
    }

    #[test]
    fn undetected_agents_are_reported_without_creating_anything() {
        let home = tempfile::tempdir().unwrap();
        let store = tempfile::tempdir().unwrap();
        managed(store.path(), "paper-lookup");

        let targets = sync_in(home.path(), store.path(), &ids(&["paper-lookup"]), true);

        assert_eq!(targets.len(), 5);
        assert!(targets.iter().all(|target| !target.detected));
        assert!(targets.iter().all(|target| target.linked == 0));
        assert!(targets.iter().all(|target| target.total == 1));
        assert!(!home.path().join(".claude").exists());
    }

    #[test]
    fn enabling_links_every_valid_skill_and_disabling_removes_only_our_links() {
        if !crate::paths::symlink_creation_is_permitted() {
            return;
        }
        let home = tempfile::tempdir().unwrap();
        let store = tempfile::tempdir().unwrap();
        managed(store.path(), "paper-lookup");
        managed(store.path(), "peer-review");
        std::fs::create_dir_all(home.path().join(".claude")).unwrap();
        let folder = home.path().join(".claude").join("skills");
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::create_dir_all(folder.join("mine")).unwrap();

        let wanted = ids(&["paper-lookup", "peer-review"]);
        let targets = sync_in(home.path(), store.path(), &wanted, true);
        let claude = targets
            .iter()
            .find(|target| target.agent == "claude")
            .unwrap();

        assert!(claude.detected);
        assert!(claude.supported);
        assert_eq!(claude.linked, 2);
        assert!(folder.join("paper-lookup").is_dir());
        assert!(folder.join("paper-lookup").join("SKILL.md").is_file());

        let counted = targets_in(home.path(), store.path(), &wanted, true);
        assert_eq!(
            counted
                .iter()
                .find(|target| target.agent == "claude")
                .unwrap()
                .linked,
            2
        );

        let removed = sync_in(home.path(), store.path(), &wanted, false);
        assert_eq!(
            removed
                .iter()
                .find(|target| target.agent == "claude")
                .unwrap()
                .linked,
            0
        );
        assert!(!folder.join("paper-lookup").exists());
        assert!(folder.join("mine").is_dir());
    }

    #[test]
    fn an_existing_user_folder_is_never_replaced() {
        if !crate::paths::symlink_creation_is_permitted() {
            return;
        }
        let home = tempfile::tempdir().unwrap();
        let store = tempfile::tempdir().unwrap();
        managed(store.path(), "paper-lookup");
        let folder = home.path().join(".codex").join("skills");
        std::fs::create_dir_all(folder.join("paper-lookup")).unwrap();
        std::fs::write(folder.join("paper-lookup").join("SKILL.md"), "mine").unwrap();

        let targets = sync_in(home.path(), store.path(), &ids(&["paper-lookup"]), true);
        let codex = targets
            .iter()
            .find(|target| target.agent == "codex")
            .unwrap();

        assert!(codex.detected);
        assert_eq!(codex.linked, 0);
        assert_eq!(
            std::fs::read_to_string(folder.join("paper-lookup").join("SKILL.md")).unwrap(),
            "mine"
        );

        sync_in(home.path(), store.path(), &ids(&["paper-lookup"]), false);
        assert!(folder.join("paper-lookup").join("SKILL.md").is_file());
    }

    #[test]
    fn sharing_is_on_unless_the_user_turns_it_off() {
        assert!(crate::config::AppConfig::default().skills_share_with_agents);
        let stored: crate::config::AppConfig = serde_json::from_str("{}").unwrap();
        assert!(stored.skills_share_with_agents);
        let off: crate::config::AppConfig =
            serde_json::from_str(r#"{ "skills_share_with_agents": false }"#).unwrap();
        assert!(!off.skills_share_with_agents);
    }

    fn target(agent: &str, supported: bool) -> ShareTarget {
        ShareTarget {
            agent: agent.to_string(),
            label: agent.to_string(),
            root: String::new(),
            detected: true,
            linked: 0,
            total: 2,
            supported,
            enabled: true,
        }
    }

    #[test]
    fn a_skill_that_is_gone_loses_its_link_on_the_next_sync() {
        if !crate::paths::symlink_creation_is_permitted() {
            return;
        }
        let home = tempfile::tempdir().unwrap();
        let store = tempfile::tempdir().unwrap();
        managed(store.path(), "paper-lookup");
        managed(store.path(), "dask");
        std::fs::create_dir_all(home.path().join(".claude")).unwrap();

        sync_in(
            home.path(),
            store.path(),
            &ids(&["paper-lookup", "dask"]),
            true,
        );
        let folder = home.path().join(".claude").join("skills");
        assert!(std::fs::symlink_metadata(folder.join("dask")).is_ok());
        std::fs::create_dir_all(folder.join("mine")).unwrap();
        std::fs::remove_dir_all(store.path().join("dask")).unwrap();

        let targets = sync_in(home.path(), store.path(), &ids(&["paper-lookup"]), true);
        let claude = targets
            .iter()
            .find(|target| target.agent == "claude")
            .unwrap();

        assert_eq!(claude.linked, 1);
        assert!(std::fs::symlink_metadata(folder.join("dask")).is_err());
        assert!(std::fs::symlink_metadata(folder.join("paper-lookup")).is_ok());
        assert!(folder.join("mine").is_dir());
    }

    #[test]
    fn a_target_that_could_not_be_linked_stays_unsupported_when_settings_reopen() {
        forget();
        remember_supported(&[target("claude", false), target("codex", true)]);
        let mut reloaded = vec![target("claude", true), target("codex", true)];

        apply_remembered_supported(&mut reloaded);

        assert!(!reloaded[0].supported);
        assert!(reloaded[1].supported);
        forget();
        let mut fresh = vec![target("claude", true)];
        apply_remembered_supported(&mut fresh);
        assert!(fresh[0].supported);
    }

    #[test]
    fn a_run_with_its_own_data_directory_never_shares_into_the_real_home() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());
        let redirected = share_home().unwrap();
        std::env::set_var("OLEAFLY_SHARE_HOME", directory.path().join("share-home"));
        let overridden = share_home().unwrap();
        std::env::remove_var("OLEAFLY_SHARE_HOME");
        std::env::remove_var("OLEAFLY_DATA_DIR");

        assert_eq!(redirected, directory.path());
        assert_eq!(overridden, directory.path().join("share-home"));
        assert_ne!(share_home().unwrap(), directory.path());
    }

    #[test]
    fn only_valid_skills_are_shared() {
        let home = tempfile::tempdir().unwrap();
        let store = tempfile::tempdir().unwrap();
        managed(store.path(), "paper-lookup");

        let targets = sync_in(home.path(), store.path(), &BTreeSet::new(), true);

        assert!(targets.iter().all(|target| target.total == 0));
        let _ = home;
    }
}
