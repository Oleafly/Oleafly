use std::collections::BTreeMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LaunchSpec {
    pub program: PathBuf,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    #[serde(default)]
    pub env_remove: Vec<String>,
    pub cwd: PathBuf,
}

impl LaunchSpec {
    pub fn command(&self) -> tokio::process::Command {
        let mut command = tokio::process::Command::new(&self.program);
        command.args(&self.args);
        for name in &self.env_remove {
            command.env_remove(name);
        }
        for (name, value) in &self.env {
            command.env(name, value);
        }
        command.current_dir(&self.cwd);
        command
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec() -> LaunchSpec {
        LaunchSpec {
            program: PathBuf::from("/usr/local/bin/agent"),
            args: vec!["acp".into(), "--profile".into(), "thesis".into()],
            env: [("SET".to_string(), "value".to_string())]
                .into_iter()
                .collect(),
            env_remove: vec!["REMOVED".into()],
            cwd: PathBuf::from("/home/ada/paper"),
        }
    }

    #[test]
    fn launch_spec_round_trips_as_json() {
        let spec = spec();
        let json = serde_json::to_string(&spec).unwrap();
        assert_eq!(serde_json::from_str::<LaunchSpec>(&json).unwrap(), spec);
    }

    #[test]
    fn launch_spec_removes_then_sets_environment() {
        let mut spec = spec();
        spec.env_remove.push("SET".into());
        let command = spec.command();
        let envs: BTreeMap<String, Option<String>> = command
            .as_std()
            .get_envs()
            .map(|(name, value)| {
                (
                    name.to_string_lossy().into_owned(),
                    value.map(|value| value.to_string_lossy().into_owned()),
                )
            })
            .collect();
        assert_eq!(envs["REMOVED"], None);
        assert_eq!(envs["SET"].as_deref(), Some("value"));
        assert_eq!(
            command.as_std().get_current_dir(),
            Some(std::path::Path::new("/home/ada/paper"))
        );
    }

    #[cfg(windows)]
    #[test]
    fn launch_spec_keeps_a_program_path_with_spaces() {
        let spec = LaunchSpec {
            program: PathBuf::from(r"C:\Program Files\Hermes\hermes.exe"),
            cwd: PathBuf::from(r"C:\Users\Ada B\paper"),
            ..Default::default()
        };
        assert_eq!(
            spec.command().as_std().get_program(),
            r"C:\Program Files\Hermes\hermes.exe"
        );
    }
}
