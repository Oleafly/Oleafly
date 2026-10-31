use std::path::{Component, Path, PathBuf};

use crate::contract::CliError;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Allow {
    Read,
    Write,
    Commands,
    Network,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct AllowSet {
    pub write: bool,
    pub commands: bool,
    pub network: bool,
}

impl AllowSet {
    pub fn parse(values: &[String]) -> Self {
        let mut set = Self::default();
        for value in values {
            match value.trim() {
                "write" => set.write = true,
                "commands" => set.commands = true,
                "network" => set.network = true,
                _ => {}
            }
        }
        set
    }

    pub fn allows(self, allow: Allow) -> bool {
        match allow {
            Allow::Read => true,
            Allow::Write => self.write,
            Allow::Commands => self.commands,
            Allow::Network => self.network,
        }
    }

    pub fn labels(self) -> Vec<&'static str> {
        let mut labels = vec!["read"];
        if self.write {
            labels.push("write");
        }
        if self.commands {
            labels.push("commands");
        }
        if self.network {
            labels.push("network");
        }
        labels
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum WriteMode {
    ReadOnly,
    Review { dir: PathBuf },
    Apply,
}

impl WriteMode {
    pub fn label(&self) -> &'static str {
        match self {
            Self::ReadOnly => "read",
            Self::Review { .. } => "review",
            Self::Apply => "apply",
        }
    }
}

#[derive(Clone, Debug)]
pub struct RunPolicy {
    pub allow: AllowSet,
    pub mode: WriteMode,
    pub question: bool,
}

pub struct PolicyRequest<'a> {
    pub project: &'a Path,
    pub linked_id: Option<&'a str>,
    pub data_root: &'a Path,
    pub allow: AllowSet,
    pub apply: bool,
    pub review_dir: Option<&'a Path>,
    pub question: bool,
    pub run_id: &'a str,
}

fn usage(message: impl Into<String>) -> CliError {
    CliError::usage(message)
}

fn absolute(path: &Path) -> PathBuf {
    let base = if path.is_absolute() {
        PathBuf::new()
    } else {
        std::env::current_dir().unwrap_or_default()
    };
    let mut out = PathBuf::new();
    for component in base.join(path).components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

fn resolved(path: &Path) -> PathBuf {
    let path = absolute(path);
    let mut existing = path.clone();
    let mut rest = Vec::new();
    while !existing.exists() {
        match (
            existing.file_name().map(ToOwned::to_owned),
            existing.parent(),
        ) {
            (Some(name), Some(parent)) => {
                rest.push(name);
                existing = parent.to_path_buf();
            }
            _ => return path,
        }
    }
    let mut real = dunce::canonicalize(&existing).unwrap_or(existing);
    for name in rest.into_iter().rev() {
        real.push(name);
    }
    real
}

fn empty_or_missing(path: &Path) -> bool {
    match std::fs::read_dir(path) {
        Ok(mut entries) => entries.next().is_none(),
        Err(error) => error.kind() == std::io::ErrorKind::NotFound,
    }
}

pub fn policy(request: &PolicyRequest) -> Result<RunPolicy, CliError> {
    let mut allow = request.allow;
    if request.question {
        allow.write = false;
        allow.commands = false;
        return Ok(RunPolicy {
            allow,
            mode: WriteMode::ReadOnly,
            question: true,
        });
    }
    if !allow.write {
        if request.apply {
            return Err(usage("--apply needs --allow write."));
        }
        if request.review_dir.is_some() {
            return Err(usage("--review-dir needs --allow write."));
        }
        return Ok(RunPolicy {
            allow,
            mode: WriteMode::ReadOnly,
            question: false,
        });
    }
    if request.apply {
        if request.review_dir.is_some() {
            return Err(usage("Use --apply or --review-dir, not both."));
        }
        return Ok(RunPolicy {
            allow,
            mode: WriteMode::Apply,
            question: false,
        });
    }
    let project = resolved(request.project);
    let dir = match request.review_dir {
        Some(dir) => {
            let dir = resolved(dir);
            if dir.starts_with(&project) {
                if request.linked_id.is_some() {
                    return Err(usage(
                        "A review of a linked folder can't be saved inside it. Choose a folder outside it, or leave out --review-dir.",
                    ));
                }
                if !dir.starts_with(project.join(".oleafly")) {
                    return Err(usage(
                        "A review folder inside the project must be under its .oleafly folder.",
                    ));
                }
            }
            if !empty_or_missing(&dir) {
                return Err(usage(format!(
                    "The review folder {} isn't empty.",
                    dir.display()
                )));
            }
            dir
        }
        None => match request.linked_id {
            Some(id) => request
                .data_root
                .join("linked")
                .join(id)
                .join("agent-runs")
                .join(request.run_id),
            None => project
                .join(".oleafly")
                .join("agent-runs")
                .join(request.run_id),
        },
    };
    Ok(RunPolicy {
        allow,
        mode: WriteMode::Review { dir },
        question: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const RUN_ID: &str = "1792000000000-00ab";

    fn write() -> AllowSet {
        AllowSet {
            write: true,
            ..AllowSet::default()
        }
    }

    fn request<'a>(project: &'a Path, data: &'a Path) -> PolicyRequest<'a> {
        PolicyRequest {
            project,
            linked_id: None,
            data_root: data,
            allow: AllowSet::default(),
            apply: false,
            review_dir: None,
            question: false,
            run_id: RUN_ID,
        }
    }

    #[test]
    fn allow_lists_parse_and_read_is_implied() {
        let set = AllowSet::parse(&["write".into(), "network".into()]);
        assert!(set.allows(Allow::Read) && set.allows(Allow::Write) && set.allows(Allow::Network));
        assert!(!set.allows(Allow::Commands));
        assert_eq!(set.labels(), ["read", "write", "network"]);
    }

    #[test]
    fn review_dir_without_write_is_a_usage_error() {
        let project = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let review = project.path().join(".oleafly/review");
        let error = policy(&PolicyRequest {
            review_dir: Some(&review),
            ..request(project.path(), data.path())
        })
        .unwrap_err();
        assert_eq!(error.exit() as u8, 2);
        let error = policy(&PolicyRequest {
            apply: true,
            ..request(project.path(), data.path())
        })
        .unwrap_err();
        assert!(error.message.contains("--allow write"));
    }

    #[test]
    fn the_default_review_dir_is_dot_oleafly_agent_runs_run_id() {
        let project = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let policy = policy(&PolicyRequest {
            allow: write(),
            ..request(project.path(), data.path())
        })
        .unwrap();
        let real = dunce::canonicalize(project.path()).unwrap();
        assert_eq!(
            policy.mode,
            WriteMode::Review {
                dir: real.join(".oleafly").join("agent-runs").join(RUN_ID)
            }
        );
    }

    #[test]
    fn a_review_dir_inside_the_project_must_be_under_dot_oleafly() {
        let project = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let outside = project.path().join("review");
        assert!(policy(&PolicyRequest {
            allow: write(),
            review_dir: Some(&outside),
            ..request(project.path(), data.path())
        })
        .is_err());
        let inside = project.path().join(".oleafly").join("my-review");
        assert!(policy(&PolicyRequest {
            allow: write(),
            review_dir: Some(&inside),
            ..request(project.path(), data.path())
        })
        .is_ok());
        let elsewhere = data.path().join("reviews");
        assert!(policy(&PolicyRequest {
            allow: write(),
            review_dir: Some(&elsewhere),
            ..request(project.path(), data.path())
        })
        .is_ok());
        std::fs::create_dir_all(elsewhere.join("old")).unwrap();
        assert!(policy(&PolicyRequest {
            allow: write(),
            review_dir: Some(&elsewhere),
            ..request(project.path(), data.path())
        })
        .unwrap_err()
        .message
        .contains("isn't empty"));
    }

    #[test]
    fn a_linked_folder_saves_its_review_in_the_data_folder() {
        let folder = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let linked = PolicyRequest {
            linked_id: Some("lnk1"),
            allow: write(),
            ..request(folder.path(), data.path())
        };
        let p = policy(&linked).unwrap();
        assert_eq!(
            p.mode,
            WriteMode::Review {
                dir: data.path().join("linked/lnk1/agent-runs").join(RUN_ID)
            }
        );
        assert!(!folder.path().join(".oleafly").exists());
        let inside = folder.path().join("review");
        assert!(policy(&PolicyRequest {
            review_dir: Some(&inside),
            ..linked
        })
        .is_err());
    }

    #[test]
    fn ask_is_read_only_whatever_it_is_given() {
        let project = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let p = policy(&PolicyRequest {
            question: true,
            allow: AllowSet {
                write: true,
                commands: true,
                network: true,
            },
            ..request(project.path(), data.path())
        })
        .unwrap();
        assert_eq!(p.mode, WriteMode::ReadOnly);
        assert!(!p.allow.write && !p.allow.commands && p.allow.network);
    }
}
