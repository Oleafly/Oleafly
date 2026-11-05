use std::collections::{HashMap, HashSet};

use super::*;

const MIRROR: &str = "https://mirrors.oleafly.com/binaries/tinytex/v2026.08/TinyTeX-v2026.08.zip";
const GITHUB: &str =
    "https://github.com/rstudio/tinytex-releases/releases/download/v2026.08/TinyTeX-v2026.08.zip";

fn none() -> HashSet<String> {
    HashSet::new()
}

fn failed(hosts: &[&str]) -> HashSet<String> {
    hosts.iter().map(|host| host.to_string()).collect()
}

fn environment(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
    let values: HashMap<String, String> = pairs
        .iter()
        .map(|(name, value)| (name.to_string(), value.to_string()))
        .collect();
    move |name| values.get(name).cloned()
}

#[test]
fn automatic_tries_the_oleafly_mirror_before_the_original_host() {
    let settings = DownloadSettings::default();
    assert_eq!(
        settings.arrange(&[GITHUB, MIRROR], &none()),
        [MIRROR, GITHUB]
    );
    assert_eq!(
        settings.arrange(&[MIRROR, GITHUB], &none()),
        [MIRROR, GITHUB]
    );
}

#[test]
fn original_drops_the_mirror_unless_it_is_the_only_source() {
    let settings = DownloadSettings {
        source: DownloadSource::Original,
        tex_repository: None,
    };
    assert_eq!(settings.arrange(&[MIRROR, GITHUB], &none()), [GITHUB]);
    assert_eq!(settings.arrange(&[MIRROR], &none()), [MIRROR]);
}

#[test]
fn a_custom_mirror_serves_the_same_path_first_and_keeps_the_others_behind_it() {
    let settings = DownloadSettings::from_parts(
        Some("custom"),
        Some("https://Mirror.Example.edu/oleafly/"),
        None,
    );
    assert_eq!(
        settings.arrange(&[GITHUB, MIRROR], &none()),
        [
            "https://Mirror.Example.edu/oleafly/binaries/tinytex/v2026.08/TinyTeX-v2026.08.zip",
            MIRROR,
            GITHUB,
        ]
    );
    assert_eq!(
        settings.mirror_host().as_deref(),
        Some("mirror.example.edu")
    );
}

#[test]
fn a_custom_mirror_cannot_stand_in_for_a_file_the_oleafly_mirror_does_not_carry() {
    let settings =
        DownloadSettings::from_parts(Some("custom"), Some("https://mirror.example.edu"), None);
    assert_eq!(settings.arrange(&[GITHUB], &none()), [GITHUB]);
}

#[test]
fn hosts_that_failed_recently_move_to_the_back_in_their_original_order() {
    let settings = DownloadSettings::default();
    assert_eq!(
        settings.arrange(&[MIRROR, GITHUB], &failed(&["mirrors.oleafly.com"])),
        [GITHUB, MIRROR]
    );
    assert_eq!(
        settings.arrange(
            &[MIRROR, GITHUB],
            &failed(&["mirrors.oleafly.com", "github.com"])
        ),
        [MIRROR, GITHUB]
    );
}

#[test]
fn duplicate_addresses_are_tried_once() {
    let settings = DownloadSettings::default();
    assert_eq!(
        settings.arrange(&[MIRROR, GITHUB, MIRROR], &none()),
        [MIRROR, GITHUB]
    );
}

#[test]
fn an_unusable_custom_mirror_falls_back_to_automatic() {
    for raw in [
        "",
        "http://mirror.example.edu",
        "https://user:pw@mirror.example.edu",
        "ftp://x",
    ] {
        assert_eq!(
            DownloadSettings::from_parts(Some("custom"), Some(raw), None).source,
            DownloadSource::Automatic,
            "{raw}"
        );
    }
    assert_eq!(
        DownloadSettings::from_parts(Some("custom"), None, None).source,
        DownloadSource::Automatic
    );
    assert_eq!(
        DownloadSettings::from_parts(Some("anything else"), None, None).source,
        DownloadSource::Automatic
    );
}

#[test]
fn the_environment_overrides_the_saved_choice() {
    let saved = DownloadSettings::from_parts(
        Some("custom"),
        Some("https://saved.example.edu"),
        Some("https://ctan.example.edu/tlnet"),
    );
    let lab = saved.clone().with_environment(environment(&[
        (MIRROR_VARIABLE, "https://lab.example.gov/mirror"),
        (TEX_REPOSITORY_VARIABLE, "https://lab.example.gov/tlnet/"),
    ]));
    assert_eq!(
        lab.source,
        DownloadSource::Mirror("https://lab.example.gov/mirror".into())
    );
    assert_eq!(
        lab.tex_repository.as_deref(),
        Some("https://lab.example.gov/tlnet")
    );
    let original = saved
        .clone()
        .with_environment(environment(&[(MIRROR_VARIABLE, "Original")]));
    assert_eq!(original.source, DownloadSource::Original);
    let ignored = saved.clone().with_environment(environment(&[
        (MIRROR_VARIABLE, "http://plain.example"),
        (TEX_REPOSITORY_VARIABLE, " "),
    ]));
    assert_eq!(ignored, saved);
}

#[test]
fn the_managed_tinytex_always_gets_a_repository_and_other_tex_only_an_explicit_one() {
    let automatic = DownloadSettings::default();
    assert_eq!(
        automatic.tex_repository_for(true).as_deref(),
        Some(AUTOMATIC_TEX_REPOSITORY)
    );
    assert_eq!(automatic.tex_repository_for(false), None);
    let chosen = DownloadSettings::from_parts(
        None,
        None,
        Some("https://mirrors.tuna.tsinghua.edu.cn/CTAN/systems/texlive/tlnet/"),
    );
    let expected = Some("https://mirrors.tuna.tsinghua.edu.cn/CTAN/systems/texlive/tlnet");
    assert_eq!(chosen.tex_repository_for(true).as_deref(), expected);
    assert_eq!(chosen.tex_repository_for(false).as_deref(), expected);
}

#[test]
fn settings_read_back_from_the_config_file() {
    let config = serde_json::json!({
        "download_source": "custom",
        "download_mirror_url": "https://mirror.example.edu/oleafly",
        "tex_package_repository": "https://ctan.example.edu/tlnet",
        "ui_locale": "en"
    });
    let settings = DownloadSettings::from_config(config.as_object().unwrap());
    assert_eq!(
        settings.source,
        DownloadSource::Mirror("https://mirror.example.edu/oleafly".into())
    );
    assert_eq!(settings.source.name(), "custom");
    assert_eq!(
        settings.tex_repository.as_deref(),
        Some("https://ctan.example.edu/tlnet")
    );
    let empty = serde_json::json!({});
    assert_eq!(
        DownloadSettings::from_config(empty.as_object().unwrap()),
        DownloadSettings::default()
    );
}

#[test]
fn https_base_names_what_is_wrong() {
    assert_eq!(https_base("  "), Err(UrlProblem::Empty));
    assert_eq!(https_base("http://example.edu"), Err(UrlProblem::NotHttps));
    assert_eq!(https_base("https://"), Err(UrlProblem::NoHost));
    assert_eq!(
        https_base("https://a@example.edu"),
        Err(UrlProblem::Credentials)
    );
    assert_eq!(
        https_base("https://example.edu/x?y=1"),
        Err(UrlProblem::QueryOrFragment)
    );
    assert_eq!(
        https_base("https://example.edu/a b"),
        Err(UrlProblem::Whitespace)
    );
    assert_eq!(
        https_base(&format!(
            "https://example.edu/{}",
            "a".repeat(MAX_URL_BYTES)
        )),
        Err(UrlProblem::TooLong)
    );
    assert_eq!(
        https_base("HTTPS://example.edu:8443/mirror///").as_deref(),
        Ok("https://example.edu:8443/mirror")
    );
}

#[test]
fn hosts_are_read_without_port_or_credentials() {
    assert_eq!(
        host_of("https://Mirrors.Oleafly.com/x").as_deref(),
        Some("mirrors.oleafly.com")
    );
    assert_eq!(
        host_of("https://example.edu:8443").as_deref(),
        Some("example.edu")
    );
    assert_eq!(
        host_of("http://u@127.0.0.1:9/x").as_deref(),
        Some("127.0.0.1")
    );
    assert_eq!(host_of("https://[::1]:9/x").as_deref(), Some("[::1]"));
    assert_eq!(host_of("ftp://example.edu"), None);
    assert_eq!(host_of("https:///x"), None);
}

#[test]
fn only_files_under_the_oleafly_mirror_have_a_mirror_path() {
    assert_eq!(
        oleafly_mirror_path(MIRROR),
        Some("/binaries/tinytex/v2026.08/TinyTeX-v2026.08.zip")
    );
    assert_eq!(oleafly_mirror_path("https://mirrors.oleafly.com/"), None);
    assert_eq!(
        oleafly_mirror_path("https://mirrors.oleafly.com.evil.example/x"),
        None
    );
    assert_eq!(oleafly_mirror_path(GITHUB), None);
}
