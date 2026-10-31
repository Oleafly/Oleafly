use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use super::runtimes::{RuntimeInstall, RuntimeKind, RuntimeSource};
use super::{LinkedFolder, RunProfile};

const SEPARATOR: &str = if cfg!(windows) { ";" } else { ":" };
const MAX_DATA_NAME: usize = 40;

const NETWORK_VARS: [&str; 19] = [
    "HTTP_PROXY",
    "http_proxy",
    "HTTPS_PROXY",
    "https_proxy",
    "NO_PROXY",
    "no_proxy",
    "ALL_PROXY",
    "all_proxy",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "REQUESTS_CA_BUNDLE",
    "CURL_CA_BUNDLE",
    "PIP_INDEX_URL",
    "PIP_EXTRA_INDEX_URL",
    "PIP_TRUSTED_HOST",
    "UV_INDEX_URL",
    "UV_DEFAULT_INDEX",
    "CONDA_SSL_VERIFY",
    "NODE_EXTRA_CA_CERTS",
];

const URL_VARS: [&str; 10] = [
    "HTTP_PROXY",
    "http_proxy",
    "HTTPS_PROXY",
    "https_proxy",
    "ALL_PROXY",
    "all_proxy",
    "PIP_INDEX_URL",
    "PIP_EXTRA_INDEX_URL",
    "UV_INDEX_URL",
    "UV_DEFAULT_INDEX",
];

pub const FORWARD_URL_LOGINS: &str = "OLEAFLY_SANDBOX_FORWARD_URL_LOGINS";

pub const CA_VARS: [&str; 5] = [
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "REQUESTS_CA_BUNDLE",
    "CURL_CA_BUNDLE",
    "NODE_EXTRA_CA_CERTS",
];

fn without_url_logins(value: &str) -> String {
    let mut result = String::with_capacity(value.len());
    let mut rest = value;
    while !rest.is_empty() {
        let end = rest.find(char::is_whitespace).unwrap_or(rest.len());
        let (word, after) = rest.split_at(end);
        result.push_str(&without_login(word));
        let spaces = after.len() - after.trim_start().len();
        result.push_str(&after[..spaces]);
        rest = &after[spaces..];
    }
    result
}

fn without_login(url: &str) -> String {
    let authority_start = url.find("://").map_or(0, |at| at + 3);
    let authority_end = url[authority_start..]
        .find(['/', '?', '#'])
        .map_or(url.len(), |at| authority_start + at);
    match url[authority_start..authority_end].rfind('@') {
        Some(at) => format!(
            "{}{}",
            &url[..authority_start],
            &url[authority_start + at + 1..]
        ),
        None => url.to_string(),
    }
}

fn path_text(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn data_name(label: &str, id: &str) -> String {
    let mut name = String::new();
    let mut underscore = false;
    for character in label.chars() {
        if character.is_ascii_alphanumeric() {
            name.push(character.to_ascii_uppercase());
            underscore = false;
        } else if !underscore && !name.is_empty() {
            name.push('_');
            underscore = true;
        }
    }
    let mut name = name.trim_end_matches('_').to_string();
    if name.is_empty() {
        name = id
            .chars()
            .map(|character| {
                if character.is_ascii_alphanumeric() {
                    character.to_ascii_uppercase()
                } else {
                    '_'
                }
            })
            .collect();
    }
    name.truncate(MAX_DATA_NAME);
    name.trim_end_matches('_').to_string()
}

pub fn run_env(
    profile: RunProfile,
    home: &Path,
    runtimes: &[RuntimeInstall],
    linked: &[LinkedFolder],
    network: bool,
    host_env: &dyn Fn(&str) -> Option<String>,
) -> (BTreeMap<String, String>, Vec<PathBuf>) {
    let _ = profile;
    let mut env = BTreeMap::new();
    let cache = home.join(".cache");
    let mut set = |name: &str, value: String| {
        env.insert(name.to_string(), value);
    };
    set("PYTHONUNBUFFERED", "1".into());
    set("PYTHONUTF8", "1".into());
    set("PYTHONIOENCODING", "utf-8".into());
    set("PYTHONPYCACHEPREFIX", path_text(&cache.join("pycache")));
    set("PYTHONUSERBASE", path_text(&home.join("python-user")));
    set("PIP_CACHE_DIR", path_text(&cache.join("pip")));
    set("PIP_BREAK_SYSTEM_PACKAGES", "1".into());
    set("PIP_DISABLE_PIP_VERSION_CHECK", "1".into());
    set("MPLBACKEND", "Agg".into());
    set("MPLCONFIGDIR", path_text(&cache.join("matplotlib")));
    set("npm_config_cache", path_text(&cache.join("npm")));
    set("npm_config_prefix", path_text(&home.join("npm-global")));
    set("npm_config_update_notifier", "false".into());
    set("UV_CACHE_DIR", path_text(&cache.join("uv")));
    set("CONDA_PKGS_DIRS", path_text(&cache.join("conda-pkgs")));
    set("CONDA_ENVS_PATH", path_text(&home.join("conda-envs")));
    set("HF_HOME", path_text(&cache.join("huggingface")));
    set("TORCH_HOME", path_text(&cache.join("torch")));
    set("OLEAFLY_TASK_HOME", path_text(home));

    // pip into a venv cannot use --user; give it a target folder instead.
    let first_python = runtimes.iter().find(|install| {
        matches!(
            install.kind,
            RuntimeKind::Python | RuntimeKind::Venv | RuntimeKind::Conda | RuntimeKind::Uv
        )
    });
    if first_python.is_some_and(|install| install.kind == RuntimeKind::Venv) {
        let target = home.join("python-target");
        set("PIP_TARGET", path_text(&target));
        set("PYTHONPATH", path_text(&target));
    } else {
        set("PIP_USER", "1".into());
    }

    let r_library = home.join("R").join("library");
    let mut r_libs = vec![path_text(&r_library)];
    r_libs.extend(
        runtimes
            .iter()
            .filter(|install| {
                install.kind == RuntimeKind::R && install.source != RuntimeSource::Path
            })
            .map(|install| path_text(&install.prefix)),
    );
    set("R_LIBS_USER", path_text(&r_library));
    set("R_LIBS", r_libs.join(SEPARATOR));
    let mut depot = vec![path_text(&home.join("julia"))];
    depot.extend(
        runtimes
            .iter()
            .filter(|install| {
                install.kind == RuntimeKind::Julia && install.prefix.ends_with(".julia")
            })
            .map(|install| path_text(&install.prefix)),
    );
    // A trailing separator keeps Julia's bundled depot on the path.
    set(
        "JULIA_DEPOT_PATH",
        format!("{}{SEPARATOR}", depot.join(SEPARATOR)),
    );

    let mut used = BTreeMap::new();
    let mut listing = Vec::new();
    for folder in linked {
        let base = data_name(&folder.label, &folder.id);
        let count = used.entry(base.clone()).or_insert(0u32);
        *count += 1;
        let name = if *count == 1 {
            base
        } else {
            format!("{base}_{count}")
        };
        env.insert(format!("OLEAFLY_DATA_{name}"), path_text(&folder.path));
        listing.push(serde_json::json!({"id": folder.id, "label": folder.label, "path": path_text(&folder.path)}));
    }
    env.insert(
        "OLEAFLY_LINKED_FOLDERS".into(),
        serde_json::Value::Array(listing).to_string(),
    );

    if network {
        let forward_logins = host_env(FORWARD_URL_LOGINS).is_some_and(|value| value == "1");
        for name in NETWORK_VARS {
            if let Some(value) = host_env(name).filter(|value| !value.is_empty()) {
                let value = if !forward_logins && URL_VARS.contains(&name) {
                    without_url_logins(&value)
                } else {
                    value
                };
                env.insert(name.to_string(), value);
            }
        }
    }

    let mut path = Vec::new();
    let mut add = |folder: PathBuf| {
        if !path.contains(&folder) {
            path.push(folder);
        }
    };
    for install in runtimes
        .iter()
        .filter(|install| install.source == RuntimeSource::Project)
    {
        install.bin_dirs.iter().cloned().for_each(&mut add);
    }
    add(if cfg!(windows) {
        home.join("npm-global")
    } else {
        home.join("npm-global").join("bin")
    });
    for install in runtimes
        .iter()
        .filter(|install| install.source != RuntimeSource::Project)
    {
        install.bin_dirs.iter().cloned().for_each(&mut add);
    }
    (env, path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn venv(prefix: &str) -> RuntimeInstall {
        RuntimeInstall {
            kind: RuntimeKind::Venv,
            executable: PathBuf::from(prefix).join("bin/python3"),
            prefix: PathBuf::from(prefix),
            bin_dirs: vec![PathBuf::from(prefix).join("bin")],
            read_roots: vec![PathBuf::from(prefix)],
            source: RuntimeSource::Project,
            note: None,
        }
    }

    fn no_env(_: &str) -> Option<String> {
        None
    }

    #[test]
    fn run_env_points_every_cache_into_the_task_home() {
        let home = Path::new("/tasks/homes/t1");
        let (env, _) = run_env(RunProfile::Analysis, home, &[], &[], false, &no_env);
        for name in [
            "PIP_CACHE_DIR",
            "UV_CACHE_DIR",
            "npm_config_cache",
            "CONDA_PKGS_DIRS",
            "HF_HOME",
            "TORCH_HOME",
            "MPLCONFIGDIR",
            "PYTHONPYCACHEPREFIX",
        ] {
            assert!(
                env[name].starts_with("/tasks/homes/t1"),
                "{name} = {}",
                env[name]
            );
        }
    }

    #[test]
    fn run_env_streams_python_output_and_uses_agg() {
        let (env, _) = run_env(
            RunProfile::Training,
            Path::new("/h"),
            &[],
            &[],
            false,
            &no_env,
        );
        assert_eq!(env["PYTHONUNBUFFERED"], "1");
        assert_eq!(env["MPLBACKEND"], "Agg");
        assert_eq!(env["PYTHONUTF8"], "1");
    }

    #[test]
    fn venv_first_uses_pip_target_not_pip_user() {
        let (env, path) = run_env(
            RunProfile::Analysis,
            Path::new("/h"),
            &[venv("/p/.venv")],
            &[],
            false,
            &no_env,
        );
        assert!(env["PIP_TARGET"].starts_with("/h"));
        assert!(env["PYTHONPATH"].starts_with(&env["PIP_TARGET"]));
        assert!(!env.contains_key("PIP_USER"));
        assert_eq!(path[0], PathBuf::from("/p/.venv/bin"));
        let (plain, _) = run_env(
            RunProfile::Analysis,
            Path::new("/h"),
            &[],
            &[],
            false,
            &no_env,
        );
        assert_eq!(plain["PIP_USER"], "1");
    }

    #[test]
    fn proxy_env_is_passed_only_with_network() {
        let host = |name: &str| (name == "HTTPS_PROXY").then(|| "http://proxy:8080".to_string());
        let (offline, _) = run_env(
            RunProfile::Analysis,
            Path::new("/h"),
            &[],
            &[],
            false,
            &host,
        );
        assert!(!offline.contains_key("HTTPS_PROXY"));
        let (online, _) = run_env(RunProfile::Analysis, Path::new("/h"), &[], &[], true, &host);
        assert_eq!(online["HTTPS_PROXY"], "http://proxy:8080");
    }

    #[test]
    fn logins_in_proxy_and_index_urls_stay_out_of_the_task() {
        let host = |name: &str| {
            match name {
            "HTTPS_PROXY" => Some("http://u:p@proxy:8080".to_string()),
            "ALL_PROXY" => Some("user:pass@proxy:3128".to_string()),
            "PIP_INDEX_URL" => Some("https://__token__:pypi-AgEI@host.example/simple".to_string()),
            "PIP_EXTRA_INDEX_URL" => Some(
                "https://a:b@one.example/simple https://two.example/simple  https://c@three.example/x?y=a@b"
                    .to_string(),
            ),
            "NO_PROXY" => Some("localhost,10.0.0.0/8".to_string()),
            _ => None,
        }
        };
        let (online, _) = run_env(RunProfile::Analysis, Path::new("/h"), &[], &[], true, &host);
        assert_eq!(online["HTTPS_PROXY"], "http://proxy:8080");
        assert_eq!(online["ALL_PROXY"], "proxy:3128");
        assert_eq!(online["PIP_INDEX_URL"], "https://host.example/simple");
        assert_eq!(
            online["PIP_EXTRA_INDEX_URL"],
            "https://one.example/simple https://two.example/simple  https://three.example/x?y=a@b"
        );
        assert_eq!(online["NO_PROXY"], "localhost,10.0.0.0/8");
        for value in online.values() {
            assert!(
                !value.contains("pypi-AgEI") && !value.contains("u:p@"),
                "{value}"
            );
        }
    }

    #[test]
    fn logins_are_forwarded_only_when_the_user_opts_in() {
        let host = |name: &str| match name {
            "HTTPS_PROXY" => Some("http://u:p@proxy:8080".to_string()),
            FORWARD_URL_LOGINS => Some("1".to_string()),
            _ => None,
        };
        let (online, _) = run_env(RunProfile::Analysis, Path::new("/h"), &[], &[], true, &host);
        assert_eq!(online["HTTPS_PROXY"], "http://u:p@proxy:8080");
        let not_one = |name: &str| match name {
            "HTTPS_PROXY" => Some("http://u:p@proxy:8080".to_string()),
            FORWARD_URL_LOGINS => Some("0".to_string()),
            _ => None,
        };
        let (online, _) = run_env(
            RunProfile::Analysis,
            Path::new("/h"),
            &[],
            &[],
            true,
            &not_one,
        );
        assert_eq!(online["HTTPS_PROXY"], "http://proxy:8080");
    }

    #[test]
    fn linked_folders_get_stable_env_names() {
        let linked = vec![
            LinkedFolder {
                id: "a1".into(),
                label: "Survey 2024".into(),
                path: PathBuf::from("/d/a"),
            },
            LinkedFolder {
                id: "b2".into(),
                label: "survey-2024".into(),
                path: PathBuf::from("/d/b"),
            },
            LinkedFolder {
                id: "c3".into(),
                label: String::new(),
                path: PathBuf::from("/d/c"),
            },
        ];
        let (env, _) = run_env(
            RunProfile::Analysis,
            Path::new("/h"),
            &[],
            &linked,
            false,
            &no_env,
        );
        assert_eq!(env["OLEAFLY_DATA_SURVEY_2024"], "/d/a");
        assert_eq!(env["OLEAFLY_DATA_SURVEY_2024_2"], "/d/b");
        assert_eq!(env["OLEAFLY_DATA_C3"], "/d/c");
        let listing: serde_json::Value =
            serde_json::from_str(&env["OLEAFLY_LINKED_FOLDERS"]).unwrap();
        assert_eq!(listing.as_array().unwrap().len(), 3);
    }
}
