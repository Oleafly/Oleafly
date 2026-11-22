use super::simulated::{configure, fake_server, texlab, tinymist, write_fake_server};
use super::*;

fn version(value: &str) -> ToolchainVersion {
    ToolchainVersion::parse(value).unwrap()
}

fn refused(kind: LanguageServiceKind, value: impl Into<OsString>) -> String {
    let _configured = configure(kind, value);
    configured(kind).unwrap().unwrap_err()
}

#[test]
fn a_bad_setting_fails_instead_of_falling_back_to_a_download() {
    let directory = tempfile::tempdir().unwrap();
    let missing = directory.path().join("texlab-private-name");
    let cases = [
        (OsString::new(), "set but empty"),
        (OsString::from("bin/texlab"), "full path"),
        (missing.clone().into_os_string(), "doesn't exist"),
        (directory.path().as_os_str().to_owned(), "a folder"),
    ];
    for (value, expected) in cases {
        let _configured = configure(LanguageServiceKind::TexLab, value.clone());
        assert!(is_configured(LanguageServiceKind::TexLab));
        let message = configured(LanguageServiceKind::TexLab)
            .unwrap()
            .unwrap_err();
        assert!(message.contains("OLEAFLY_TEXLAB"), "{value:?}: {message}");
        assert!(message.contains(expected), "{value:?}: {message}");
        assert!(!message.contains("texlab-private-name"), "{message}");
    }
}

#[cfg(unix)]
#[test]
fn a_file_without_the_executable_bit_is_refused() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("texlab");
    std::fs::write(&path, "#!/bin/sh\necho texlab 5.26.0\n").unwrap();
    let message = refused(LanguageServiceKind::TexLab, path);
    assert!(message.contains("isn't executable"), "{message}");
}

#[test]
fn the_version_comes_from_the_program_itself() {
    let server = texlab("5.27.1");
    let _configured = configure(LanguageServiceKind::TexLab, &server.path);
    let resolved = configured(LanguageServiceKind::TexLab).unwrap().unwrap();
    assert_eq!(resolved.version, version("5.27.1"));
    assert_eq!(resolved.executable, server.path);
    assert!(resolved.check_typst(&version("0.11.1")).is_ok());
}

#[test]
fn a_program_that_is_not_the_server_is_refused() {
    let pandoc = fake_server("texlab", "echo 'pandoc 3.1.11'", "echo pandoc 3.1.11", "");
    let message = refused(LanguageServiceKind::TexLab, &pandoc.path);
    assert!(
        message.contains("didn't report a TexLab version"),
        "{message}"
    );

    let failing = fake_server(
        "texlab",
        "echo 'texlab 5.26.0'; exit 3",
        "echo texlab 5.26.0& exit /b 3",
        "",
    );
    let message = refused(LanguageServiceKind::TexLab, &failing.path);
    assert!(message.contains("`texlab --version` failed"), "{message}");

    let tinymist_as_texlab = tinymist("0.15.12", "0.15.0");
    let message = refused(LanguageServiceKind::TexLab, &tinymist_as_texlab.path);
    assert!(
        message.contains("didn't report a TexLab version"),
        "{message}"
    );
}

#[test]
fn tinymist_names_the_typst_line_it_was_built_for() {
    let server = tinymist("0.15.12", "0.15.0");
    let _configured = configure(LanguageServiceKind::Tinymist, &server.path);
    let resolved = configured(LanguageServiceKind::Tinymist).unwrap().unwrap();
    assert_eq!(resolved.version, version("0.15.12"));
    assert!(resolved.check_typst(&version("0.15.1")).is_ok());
    let message = resolved.check_typst(&version("0.13.1")).unwrap_err();
    assert!(message.contains("built for Typst 0.15"), "{message}");
    assert!(message.contains("uses Typst 0.13.1"), "{message}");
    assert!(message.contains("built for Typst 0.13."), "{message}");

    assert_eq!(
        tinymist_for(&version("0.15.0")),
        Some(Ok(version("0.15.12")))
    );
    assert!(tinymist_for(&version("0.12.0")).unwrap().is_err());
}

#[test]
fn a_tinymist_that_hides_its_typst_line_is_refused() {
    let server = fake_server(
        "tinymist",
        "echo 'tinymist 0.15.12'",
        "echo tinymist 0.15.12",
        "",
    );
    let message = refused(LanguageServiceKind::Tinymist, &server.path);
    assert!(message.contains("which Typst version"), "{message}");
}

fn probes(server: &super::simulated::FakeServer) -> usize {
    std::fs::read_to_string(server.path.with_file_name("probes"))
        .map(|text| text.lines().count())
        .unwrap_or(0)
}

#[test]
fn a_failed_probe_is_not_repeated_until_the_program_changes() {
    let server = fake_server(
        "texlab",
        "echo x >> \"$(dirname \"$0\")/probes\"; exit 3",
        "echo x>>\"%~dp0probes\"& exit /b 3",
        "",
    );
    let _configured = configure(LanguageServiceKind::TexLab, &server.path);
    for _ in 0..3 {
        assert!(configured(LanguageServiceKind::TexLab).unwrap().is_err());
    }
    assert_eq!(probes(&server), 1);

    write_fake_server(
        &server.path,
        "echo x >> \"$(dirname \"$0\")/probes\"; echo 'texlab 5.26.1'",
        "echo x>>\"%~dp0probes\"& echo texlab 5.26.1",
        "",
    );
    assert_eq!(
        configured(LanguageServiceKind::TexLab)
            .unwrap()
            .unwrap()
            .version,
        version("5.26.1")
    );
    assert_eq!(probes(&server), 2);
}

#[test]
fn a_hanging_probe_gives_up_and_is_not_retried_at_once() {
    let server = fake_server(
        "tinymist",
        "echo x >> \"$(dirname \"$0\")/probes\"; sleep 30",
        "echo x>>\"%~dp0probes\"& ping -n 30 127.0.0.1 >nul",
        "",
    );
    let timeout = std::time::Duration::from_secs(2);
    let message = resolve(
        LanguageServiceKind::Tinymist,
        server.path.as_os_str(),
        timeout,
    )
    .unwrap_err();
    assert!(
        message.contains("`tinymist -V` didn't finish within 2 seconds"),
        "{message}"
    );
    assert_eq!(
        resolve(
            LanguageServiceKind::Tinymist,
            server.path.as_os_str(),
            timeout
        )
        .unwrap_err(),
        message
    );
    assert_eq!(probes(&server), 1);
}
