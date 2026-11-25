use std::ffi::OsString;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitEnv {
    pub program: OsString,
    pub clear: &'static [&'static str],
    pub env: Vec<(&'static str, Option<OsString>)>,
}

pub const GIT_REPOSITORY_ENV: [&str; 16] = [
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_CONFIG",
    "GIT_CONFIG_PARAMETERS",
    "GIT_CONFIG_COUNT",
    "GIT_OBJECT_DIRECTORY",
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_IMPLICIT_WORK_TREE",
    "GIT_GRAFT_FILE",
    "GIT_INDEX_FILE",
    "GIT_NO_REPLACE_OBJECTS",
    "GIT_REPLACE_REF_BASE",
    "GIT_PREFIX",
    "GIT_SHALLOW_FILE",
    "GIT_COMMON_DIR",
    // Older Git, such as 2.34, still lists it in `rev-parse --local-env-vars`.
    "GIT_INTERNAL_SUPER_PREFIX",
];

pub fn default_git_env() -> Option<GitEnv> {
    let names: &[&str] = if cfg!(windows) {
        &["git.exe", "git.cmd"]
    } else {
        &["git"]
    };
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .flat_map(|folder| names.iter().map(move |name| folder.join(name)))
        .find(|candidate| candidate.is_file())
        .map(|program| GitEnv {
            program: program.into_os_string(),
            clear: &GIT_REPOSITORY_ENV,
            env: Vec::new(),
        })
}

pub trait ConnectorSecrets: Send + Sync {
    fn get(&self, name: &str) -> Option<zeroize::Zeroizing<String>>;
}

pub struct NoSecrets;

impl ConnectorSecrets for NoSecrets {
    fn get(&self, _name: &str) -> Option<zeroize::Zeroizing<String>> {
        None
    }
}
