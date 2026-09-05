use super::*;
use std::io::{Cursor, Write};

fn binary_definition() -> AgentDefinition {
    AgentDefinition {
        id: "catalog-fixture".into(),
        name: "Catalog fixture".into(),
        version: "1.2.3".into(),
        description: String::new(),
        builtin: false,
        distribution: Distribution {
            binary: BTreeMap::from([(
                platform(),
                BinaryDistribution {
                    archive: "https://127.0.0.1:1/agent.zip".into(),
                    cmd: "oleafly-catalog-fixture-agent.exe".into(),
                    sha256: Some("0".repeat(64)),
                    args: vec!["--acp".into()],
                    env: BTreeMap::new(),
                },
            )]),
            ..Distribution::default()
        },
    }
}

fn binary_mut(definition: &mut AgentDefinition) -> &mut BinaryDistribution {
    definition.distribution.binary.get_mut(&platform()).unwrap()
}

fn native_file(path: &Path) {
    std::fs::write(path, b"local executable fixture").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700)).unwrap();
    }
}

fn installed_fixture(root: &Path, definition: &AgentDefinition, node: bool) -> PathBuf {
    let destination = receipt_dir(root, definition);
    std::fs::create_dir_all(destination.join("bin")).unwrap();
    let relative = PathBuf::from(if node {
        "bin/agent.js"
    } else {
        "bin/agent.exe"
    });
    native_file(&destination.join(&relative));
    write_receipt(&destination, &definition.version, relative.clone(), node).unwrap();
    destination.join(relative).canonicalize().unwrap()
}

fn zip_bytes(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let options = zip::write::SimpleFileOptions::default().unix_permissions(0o600);
    for (name, bytes) in entries {
        if name.ends_with('/') {
            writer.add_directory(*name, options).unwrap();
        } else {
            writer.start_file(*name, options).unwrap();
            writer.write_all(bytes).unwrap();
        }
    }
    writer.finish().unwrap().into_inner()
}

fn tar_header(path: &str, size: u64, kind: tar::EntryType) -> tar::Header {
    let mut header = tar::Header::new_gnu();
    header.set_mode(0o600);
    header.set_size(size);
    header.set_entry_type(kind);
    header.as_mut_bytes()[..path.len()].copy_from_slice(path.as_bytes());
    header.set_cksum();
    header
}

fn gzip(bytes: &[u8]) -> Vec<u8> {
    let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
    encoder.write_all(bytes).unwrap();
    encoder.finish().unwrap()
}

fn tar_bytes(entries: &[(&str, &[u8], tar::EntryType)]) -> Vec<u8> {
    let mut builder = tar::Builder::new(Vec::new());
    for (path, bytes, kind) in entries {
        builder
            .append(&tar_header(path, bytes.len() as u64, *kind), *bytes)
            .unwrap();
    }
    gzip(&builder.into_inner().unwrap())
}

#[test]
fn npm_pins_require_three_numeric_release_components() {
    for version in [
        "0.0.0",
        "1.2.3",
        "1.2.3-alpha.1",
        "1.2.3-rc.0+build.001",
        "1.2.3+linux-x64",
    ] {
        assert_eq!(
            package_parts(&format!("@scope/agent@{version}"), true).unwrap(),
            ("@scope/agent", version)
        );
    }
    for version in [
        "1",
        "1.2",
        "1.2.x",
        "1.2.X",
        "1.x.3",
        "1.2.*",
        "*",
        "latest",
        "^1.2.3",
        "~1.2.3",
        ">=1.2.3",
        "1.2.3 || 2.0.0",
        "1.2.3 - 2.0.0",
        "01.2.3",
        "1.02.3",
        "1.2.03",
        "1.2.3-01",
        "1.2.3-rc..1",
        "1.2.3-",
        "1.2.3+",
        "1.2.3+a+b",
        "v1.2.3",
        "1.2.3\n",
        "1.2.3.4",
    ] {
        assert!(
            package_parts(&format!("agent@{version}"), true).is_err(),
            "{version}"
        );
    }
}

#[test]
fn python_pins_accept_exact_release_and_qualified_versions() {
    for version in [
        "1",
        "1.2",
        "1.2.3",
        "1!2.3",
        "v1.2",
        "01.02",
        "1.2rc1",
        "1.2.RC-2",
        "1.2alpha",
        "1.2preview3",
        "1.2-1",
        "1.2.post2",
        "1.2rev3",
        "1.2r4",
        "1.2.dev1",
        "1.2a1.post2.dev3",
        "1.2+linux.x86_64",
        "1.2+build-001",
    ] {
        assert_eq!(
            package_parts(&format!("agent=={version}"), false).unwrap(),
            ("agent", version)
        );
    }
    for version in [
        "",
        "1.2.*",
        "1.2.x",
        "^1.2",
        "~=1.2",
        "1.2,!=1.2.1",
        "1.2;python_version",
        "1.2+",
        "1.2++linux",
        "1.2+linux..x64",
        "1.2rc1a2",
        "1.2.dev1.post2",
        "1!!2",
        "a!1.2",
        "1.2unknown",
        "1.2-",
        "1.2.",
        "1.2 ",
        "1.2\n",
    ] {
        assert!(
            package_parts(&format!("agent=={version}"), false).is_err(),
            "{version:?}"
        );
    }
    assert!(package_parts("agent>=1.2", false).is_err());
    assert!(package_parts("agent===1.2", false).is_err());
}

#[test]
fn definition_validation_checks_every_distribution() {
    for definition in builtins().into_iter().chain([binary_definition()]) {
        validate(&definition).unwrap();
    }
    let mut definition = binary_definition();
    definition.distribution = Distribution::default();
    assert!(validate(&definition).unwrap_err().contains("distribution"));
    definition.distribution.uvx = Some(PackageDistribution {
        package: "agent==1.2rc1".into(),
        cmd: Some("agent".into()),
        args: vec!["--acp".into()],
        node_major: None,
        env: BTreeMap::new(),
    });
    definition.version = "1.2rc1".into();
    validate(&definition).unwrap();
    definition
        .distribution
        .uvx
        .as_mut()
        .unwrap()
        .env
        .insert("TOKEN".into(), "fixture".into());
    assert!(validate(&definition).unwrap_err().contains("Environment"));
    let mut definition = builtins().remove(0);
    definition.distribution.npx.as_mut().unwrap().cmd = Some("../agent".into());
    assert!(validate(&definition)
        .unwrap_err()
        .contains("simple executable"));
    definition.distribution.npx.as_mut().unwrap().cmd = Some("agent".into());
    definition.distribution.npx.as_mut().unwrap().package = "agent@1.2".into();
    assert!(validate(&definition).unwrap_err().contains("exact version"));
}

#[test]
fn definition_metadata_and_argument_bounds_are_enforced() {
    for (field, invalid) in [
        ("id", "Uppercase".into()),
        ("id", "x".repeat(81)),
        ("name", " ".into()),
        ("name", "x".repeat(121)),
        ("description", "x".repeat(4001)),
        ("version", "latest".into()),
    ] {
        let mut value = serde_json::to_value(binary_definition()).unwrap();
        value[field] = Value::String(invalid);
        assert!(
            validate(&serde_json::from_value(value).unwrap()).is_err(),
            "{field}"
        );
    }
    for args in [
        vec!["x".into(); 65],
        vec!["x".repeat(4097)],
        vec!["x\0y".into()],
        vec!["x\ny".into()],
        vec!["x\ry".into()],
    ] {
        assert!(validate_args(&args).is_err());
    }
    validate_args(&vec!["x".repeat(4096); 64]).unwrap();
    for flag in [
        "--yolo",
        "--skip-trust",
        "--dangerously-skip-permissions",
        "--dangerously-bypass-approvals-and-sandbox",
        "--api-key",
        "--password",
        "--access-token",
        "--token",
    ] {
        for value in [
            flag.into(),
            format!("{}=fixture", flag.to_ascii_uppercase()),
        ] {
            assert!(validate_args(&[value]).is_err(), "{flag}");
        }
    }
    validate_args(&["--token-limit=4096".into(), "--acp".into()]).unwrap();
}

#[test]
fn binaries_reject_unsafe_urls_commands_hashes_and_environment() {
    for archive in [
        "http://example.com/agent.zip",
        "https://user@example.com/agent.zip",
        "https://user:fixture@example.com/agent.zip",
        "file:///agent.zip",
        "not a URL",
    ] {
        let mut definition = binary_definition();
        binary_mut(&mut definition).archive = archive.into();
        assert!(validate(&definition).is_err(), "{archive}");
    }
    for cmd in [
        "",
        "../agent",
        "/agent",
        "bin/../../agent",
        "C:\\agent",
        "bin\\agent",
    ] {
        let mut definition = binary_definition();
        binary_mut(&mut definition).cmd = cmd.into();
        assert!(validate(&definition).is_err(), "{cmd}");
    }
    for hash in ["f".repeat(63), "g".repeat(64), "f".repeat(65)] {
        let mut definition = binary_definition();
        binary_mut(&mut definition).sha256 = Some(hash);
        assert!(validate(&definition).is_err());
    }
    let mut definition = binary_definition();
    binary_mut(&mut definition).sha256 = Some("ABCDEF01".repeat(8));
    validate(&definition).unwrap();
    binary_mut(&mut definition)
        .env
        .insert("TOKEN".into(), "fixture".into());
    assert!(validate(&definition).is_err());
    let binary = binary_definition()
        .distribution
        .binary
        .into_values()
        .next()
        .unwrap();
    definition.distribution.binary = (0..13)
        .map(|index| (format!("platform-{index}"), binary.clone()))
        .collect();
    assert!(validate(&definition)
        .unwrap_err()
        .contains("too many platforms"));
}

#[test]
fn command_distributions_reject_launchers_and_shell_syntax() {
    for executable in [
        "",
        "./agent",
        "agent --acp",
        "agent\nother",
        "agent\0other",
        "npm",
        "npx",
        "pnpm",
        "yarn",
        "uv",
        "uvx",
        "bunx",
    ] {
        let mut definition = binary_definition();
        definition.distribution = Distribution {
            command: Some(CommandDistribution {
                executable: executable.into(),
                args: vec![],
            }),
            ..Distribution::default()
        };
        assert!(validate(&definition).is_err(), "{executable}");
    }
}

#[test]
fn distribution_json_rejects_unknown_fields_at_each_boundary() {
    for pointer in ["", "/distribution", "/distribution/npx"] {
        let mut value = serde_json::to_value(builtins().remove(0)).unwrap();
        value
            .pointer_mut(pointer)
            .unwrap()
            .as_object_mut()
            .unwrap()
            .insert("unexpected".into(), json!(true));
        assert!(
            serde_json::from_value::<AgentDefinition>(value).is_err(),
            "{pointer}"
        );
    }
    let mut value = serde_json::to_value(binary_definition()).unwrap();
    value["distribution"]["binary"][platform()]["unexpected"] = json!(true);
    assert!(serde_json::from_value::<AgentDefinition>(value).is_err());
    assert!(serde_json::from_value::<CommandDistribution>(
        json!({"executable":"agent", "args":[], "shell":true})
    )
    .is_err());
}

#[test]
fn managed_receipts_preserve_the_pinned_version_and_arguments() {
    let temp = tempfile::tempdir().unwrap();
    let definition = binary_definition();
    let executable = installed_fixture(temp.path(), &definition, false);
    let launch = resolve(temp.path(), &definition).unwrap();
    assert_eq!(launch.executable, executable);
    assert_eq!(launch.args, ["--acp"]);
    assert_eq!(launch.version.as_deref(), Some("1.2.3"));
    assert!(launch.managed);
    let mut adjacent = definition.clone();
    adjacent.version = "1.2.4".into();
    assert!(read_receipt(temp.path(), &adjacent).is_none());
    assert!(resolve(temp.path(), &adjacent).is_err());
}

#[test]
fn managed_node_receipts_put_the_script_before_agent_arguments() {
    let temp = tempfile::tempdir().unwrap();
    let definition = builtins().remove(2);
    let script = installed_fixture(temp.path(), &definition, true);
    match discover("node") {
        Some(node) => {
            let launch = resolve(temp.path(), &definition).unwrap();
            assert_eq!(launch.executable, node);
            assert_eq!(
                launch.args,
                [script.to_string_lossy().into_owned(), "--acp".into()]
            );
            assert!(launch.managed);
            assert_eq!(launch.version, Some(definition.version));
        }
        None => assert!(resolve(temp.path(), &definition)
            .unwrap_err()
            .contains("Install Node.js")),
    }
}

#[test]
fn receipts_reject_missing_malformed_mismatched_and_escaped_executables() {
    let temp = tempfile::tempdir().unwrap();
    let definition = binary_definition();
    assert!(read_receipt(temp.path(), &definition).is_none());
    let executable = installed_fixture(temp.path(), &definition, false);
    let directory = receipt_dir(temp.path(), &definition);
    let receipt_file = directory.join("receipt.json");
    std::fs::write(&receipt_file, b"not JSON").unwrap();
    assert!(read_receipt(temp.path(), &definition).is_none());
    let outside = temp.path().join("outside.exe");
    native_file(&outside);
    for (version, target) in [
        ("9.9.9", executable.clone()),
        ("1.2.3", outside),
        ("1.2.3", directory.clone()),
        ("1.2.3", directory.join("missing.exe")),
    ] {
        std::fs::write(
            &receipt_file,
            serde_json::to_vec(&InstallReceipt {
                version: version.into(),
                executable: target,
                node: false,
            })
            .unwrap(),
        )
        .unwrap();
        assert!(
            read_receipt(temp.path(), &definition).is_none(),
            "{version}"
        );
    }
}

#[cfg(unix)]
#[test]
fn receipts_reject_executable_symlinks_outside_the_installation() {
    let temp = tempfile::tempdir().unwrap();
    let definition = binary_definition();
    let executable = installed_fixture(temp.path(), &definition, false);
    let outside = temp.path().join("outside.exe");
    native_file(&outside);
    std::fs::remove_file(&executable).unwrap();
    std::os::unix::fs::symlink(outside, executable).unwrap();
    assert!(read_receipt(temp.path(), &definition).is_none());
}

#[test]
fn discovery_requires_a_native_file_and_resolves_absolute_paths() {
    let temp = tempfile::tempdir().unwrap();
    let executable = temp.path().join("agent.exe");
    native_file(&executable);
    assert_eq!(
        discover(executable.to_str().unwrap()),
        Some(executable.canonicalize().unwrap())
    );
    assert!(discover(temp.path().to_str().unwrap()).is_none());
    assert!(discover(temp.path().join("missing.exe").to_str().unwrap()).is_none());
    for name in ["", ".hidden", "../agent", "agent --acp", "agent;other"] {
        assert!(discover(name).is_none(), "{name}");
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o600)).unwrap();
        assert!(discover(executable.to_str().unwrap()).is_none());
    }
    #[cfg(windows)]
    {
        let script = temp.path().join("agent.cmd");
        std::fs::write(&script, b"echo fixture").unwrap();
        assert!(discover(script.to_str().unwrap()).is_none());
    }
}

#[tokio::test]
async fn installed_commands_report_unmanaged_status_without_running_the_file() {
    let temp = tempfile::tempdir().unwrap();
    let executable = temp.path().join("agent.exe");
    native_file(&executable);
    let mut definition = binary_definition();
    definition.distribution = Distribution {
        command: Some(CommandDistribution {
            executable: executable.to_string_lossy().into_owned(),
            args: vec!["--acp".into()],
        }),
        ..Distribution::default()
    };
    let current = status(temp.path(), definition.clone(), false).await;
    assert!(current.installed);
    assert!(!current.managed);
    assert!(!current.can_install);
    assert_eq!(current.installed_version, None);
    assert_eq!(
        current.executable,
        Some(
            executable
                .canonicalize()
                .unwrap()
                .to_string_lossy()
                .into_owned()
        )
    );
    std::fs::remove_file(executable).unwrap();
    let missing = status(temp.path(), definition, false).await;
    assert!(!missing.installed);
    assert!(missing.reason.unwrap().contains("not installed"));
}

#[tokio::test]
async fn install_rejects_unsupported_distributions_before_creating_files() {
    let temp = tempfile::tempdir().unwrap();
    let mut no_platform = binary_definition();
    let binary = no_platform.distribution.binary.remove(&platform()).unwrap();
    no_platform
        .distribution
        .binary
        .insert("unsupported-platform".into(), binary);
    let mut no_hash = binary_definition();
    binary_mut(&mut no_hash).sha256 = None;
    let mut no_archive = binary_definition();
    binary_mut(&mut no_archive).archive = "https://127.0.0.1:1/agent.exe".into();
    let mut invalid = binary_definition();
    invalid.id = "../escape".into();
    for (definition, reason) in [
        (no_platform, "No binary"),
        (no_hash, "checksum"),
        (no_archive, "Only ZIP"),
        (invalid, "lowercase ID"),
    ] {
        assert!(install(temp.path(), &definition)
            .await
            .unwrap_err()
            .contains(reason));
        assert_eq!(std::fs::read_dir(temp.path()).unwrap().count(), 0);
    }
    assert!(registry_search(&"x".repeat(201))
        .await
        .unwrap_err()
        .contains("too long"));
}

#[tokio::test]
async fn install_preserves_complete_and_incomplete_existing_versions() {
    let temp = tempfile::tempdir().unwrap();
    let definition = binary_definition();
    let executable = installed_fixture(temp.path(), &definition, false);
    let before = std::fs::read(&executable).unwrap();
    install(temp.path(), &definition).await.unwrap();
    assert_eq!(std::fs::read(executable).unwrap(), before);
    let receipt = receipt_dir(temp.path(), &definition).join("receipt.json");
    std::fs::remove_file(&receipt).unwrap();
    assert!(install(temp.path(), &definition)
        .await
        .unwrap_err()
        .contains("incomplete installation"));
    assert!(!receipt.exists());
    assert_eq!(
        std::fs::read_dir(temp.path().join("agents").join(definition.id))
            .unwrap()
            .count(),
        1
    );
}

#[test]
fn zip_and_tar_extract_nested_files_directories_and_empty_files() {
    let zip = zip_bytes(&[
        ("bin/", b""),
        ("bin/agent.exe", b"agent payload"),
        ("data/empty", b""),
    ]);
    let tar = tar_bytes(&[
        ("bin/", b"", tar::EntryType::Directory),
        ("bin/agent.exe", b"agent payload", tar::EntryType::Regular),
        ("data/empty", b"", tar::EntryType::Regular),
    ]);
    for (bytes, zip_format) in [(zip, true), (tar, false)] {
        let temp = tempfile::tempdir().unwrap();
        extract(&bytes, zip_format, temp.path()).unwrap();
        assert_eq!(
            std::fs::read(temp.path().join("bin/agent.exe")).unwrap(),
            b"agent payload"
        );
        assert_eq!(
            std::fs::metadata(temp.path().join("data/empty"))
                .unwrap()
                .len(),
            0
        );
    }
}

#[test]
fn archive_path_attacks_are_rejected_before_writing() {
    for path in [
        "../escape",
        "/escape",
        "bin/../../escape",
        "C:/escape",
        "C:\\escape",
        "\\\\server\\escape",
    ] {
        let zip = zip_bytes(&[(path, b"unexpected")]);
        let tar = tar_bytes(&[(path, b"unexpected", tar::EntryType::Regular)]);
        for (bytes, zip_format) in [(zip, true), (tar, false)] {
            let temp = tempfile::tempdir().unwrap();
            assert!(
                extract(&bytes, zip_format, temp.path())
                    .unwrap_err()
                    .contains("unsafe path"),
                "{path}"
            );
            assert_eq!(std::fs::read_dir(temp.path()).unwrap().count(), 0);
        }
    }
}

#[test]
fn zip_symlinks_and_tar_special_entries_are_rejected() {
    let temp = tempfile::tempdir().unwrap();
    let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
    writer
        .add_symlink(
            "link",
            "../outside",
            zip::write::SimpleFileOptions::default().unix_permissions(0o600),
        )
        .unwrap();
    let bytes = writer.finish().unwrap().into_inner();
    assert!(extract(&bytes, true, temp.path())
        .unwrap_err()
        .contains("symbolic links"));
    for kind in [
        tar::EntryType::Symlink,
        tar::EntryType::Link,
        tar::EntryType::Fifo,
        tar::EntryType::Char,
        tar::EntryType::Block,
    ] {
        let bytes = tar_bytes(&[("special", b"", kind)]);
        assert!(extract(&bytes, false, temp.path())
            .unwrap_err()
            .contains("special files"));
    }
    assert_eq!(std::fs::read_dir(temp.path()).unwrap().count(), 0);
}

#[test]
fn archive_extraction_never_overwrites_existing_files() {
    let zip = zip_bytes(&[("agent.exe", b"replacement")]);
    let tar = tar_bytes(&[("agent.exe", b"replacement", tar::EntryType::Regular)]);
    for (bytes, zip_format) in [(zip, true), (tar, false)] {
        let temp = tempfile::tempdir().unwrap();
        let executable = temp.path().join("agent.exe");
        std::fs::write(&executable, b"original").unwrap();
        assert!(extract(&bytes, zip_format, temp.path())
            .unwrap_err()
            .contains("duplicate"));
        assert_eq!(std::fs::read(executable).unwrap(), b"original");
    }
    let temp = tempfile::tempdir().unwrap();
    let bytes = tar_bytes(&[
        ("agent.exe", b"first", tar::EntryType::Regular),
        ("agent.exe", b"second", tar::EntryType::Regular),
    ]);
    assert!(extract(&bytes, false, temp.path())
        .unwrap_err()
        .contains("duplicate"));
    assert_eq!(
        std::fs::read(temp.path().join("agent.exe")).unwrap(),
        b"first"
    );
}

#[test]
fn tar_rejects_oversized_entries_without_allocating_the_declared_payload() {
    let temp = tempfile::tempdir().unwrap();
    let bytes = gzip(tar_header("huge", EXPANDED_LIMIT + 1, tar::EntryType::Regular).as_bytes());
    assert!(extract(&bytes, false, temp.path())
        .unwrap_err()
        .contains("extraction limits"));
    assert_eq!(std::fs::read_dir(temp.path()).unwrap().count(), 0);
}

#[test]
fn archive_entry_count_is_bounded_even_for_empty_directories() {
    let temp = tempfile::tempdir().unwrap();
    let header = tar_header("directory", 0, tar::EntryType::Directory);
    let mut bytes = Vec::with_capacity(20_001 * 512);
    for _ in 0..20_001 {
        bytes.extend_from_slice(header.as_bytes());
    }
    assert!(extract(&gzip(&bytes), false, temp.path())
        .unwrap_err()
        .contains("extraction limits"));
    assert!(temp.path().join("directory").is_dir());
}

#[test]
fn malformed_and_truncated_archives_fail() {
    let temp = tempfile::tempdir().unwrap();
    assert!(extract(b"not a zip", true, temp.path())
        .unwrap_err()
        .contains("ZIP archive"));
    assert!(extract(b"not gzip", false, temp.path()).is_err());
    let mut truncated = tar_header("truncated", 8, tar::EntryType::Regular)
        .as_bytes()
        .to_vec();
    truncated.extend_from_slice(b"abc");
    assert!(extract(&gzip(&truncated), false, temp.path()).is_err());
}

#[tokio::test]
async fn local_install_commands_bound_output_and_hide_failed_command_details() {
    let python = discover("python3").expect("Python 3 is required for ACP protocol fixtures");
    let mut command = tokio::process::Command::new(&python);
    command.args(["-c", "import sys; sys.stdout.write('x' * 100000)"]);
    let output = bounded_command(command, Duration::from_secs(5))
        .await
        .unwrap();
    assert_eq!(output, "x".repeat(64 * 1024));
    let mut command = tokio::process::Command::new(python);
    command.args([
        "-c",
        "import sys; sys.stderr.write('fixture private diagnostic'); sys.exit(2)",
    ]);
    let error = bounded_command(command, Duration::from_secs(5))
        .await
        .unwrap_err();
    assert!(error.contains("installation failed"));
    assert!(!error.contains("private diagnostic"));
}

#[tokio::test]
async fn local_install_commands_handle_spawn_failure_and_timeout() {
    let temp = tempfile::tempdir().unwrap();
    let command = tokio::process::Command::new(temp.path().join("missing-installer.exe"));
    assert!(bounded_command(command, Duration::from_secs(5))
        .await
        .unwrap_err()
        .contains("could not be started"));
    let python = discover("python3").expect("Python 3 is required for ACP protocol fixtures");
    let mut command = tokio::process::Command::new(python);
    command.args(["-c", "import time; time.sleep(30)"]);
    assert!(bounded_command(command, Duration::from_millis(100))
        .await
        .unwrap_err()
        .contains("timed out and was stopped"));
}

#[cfg(unix)]
mod managed_install {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    const FIXTURE_ROOT: &str = "OLEAFLY_CATALOG_INSTALL_FIXTURE";
    const INSTALLER: &str = r#"
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = process.env.OLEAFLY_CATALOG_INSTALL_FIXTURE;
const settings = JSON.parse(fs.readFileSync(path.join(root, 'settings.json')));
const args = process.argv.slice(2);
const npm = path.basename(process.argv[1]) === 'npm-cli.js';
fs.appendFileSync(path.join(root, 'invocations.jsonl'), JSON.stringify({npm, args}) + '\n');
if (npm) {
  assert.deepEqual(args.slice(0, 7), ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--save-exact', '--registry=https://registry.npmjs.org', '--prefix']);
  assert.equal(args[8], '@oleafly-fixture/agent@1.2.3');
  assert.equal(process.cwd(), fs.realpathSync(args[7]));
  assert.equal(process.env.npm_config_userconfig, path.join(args[7], 'empty-npmrc'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(args[7], 'package.json'))).private, true);
  const packageRoot = path.join(args[7], 'node_modules/@oleafly-fixture/agent');
  fs.mkdirSync(packageRoot, {recursive: true});
  if (settings.manifest !== null) fs.writeFileSync(path.join(packageRoot, 'package.json'), typeof settings.manifest === 'string' ? settings.manifest : JSON.stringify(settings.manifest));
  for (const [name, content] of Object.entries(settings.files || {})) {
    const target = path.join(packageRoot, name);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.writeFileSync(target, content);
  }
  if (settings.escape) fs.symlinkSync(path.join(root, 'outside'), path.join(packageRoot, 'escaped.js'));
} else {
  assert.deepEqual(args, ['tool', 'install', '--no-config', '--python-preference', 'only-system', 'oleafly-fixture-agent==1.2.3']);
  const tools = process.env.UV_TOOL_DIR;
  const bin = process.env.UV_TOOL_BIN_DIR;
  assert.equal(fs.realpathSync(process.cwd()), fs.realpathSync(path.dirname(tools)));
  assert.equal(path.dirname(tools), path.dirname(bin));
  fs.mkdirSync(bin, {recursive: true});
  fs.mkdirSync(path.join(tools, 'oleafly-fixture-agent/bin'), {recursive: true});
  const executable = path.join(tools, 'oleafly-fixture-agent/bin/catalog-agent');
  fs.writeFileSync(executable, '#!/bin/sh\nprintf "%s\\n" "$@"\n', {mode: 0o700});
  if (settings.layout !== 'missing') fs.symlinkSync(settings.layout === 'escaped' ? path.join(root, 'outside') : executable, path.join(bin, 'catalog-agent'));
}
if (settings.fail) process.exit(2);
"#;

    fn shell_quote(value: &Path) -> String {
        format!("'{}'", value.to_string_lossy().replace('\'', "'\\''"))
    }

    fn executable(path: &Path, content: &str) {
        std::fs::write(path, content).unwrap();
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700)).unwrap();
    }

    async fn isolated(name: &str) -> Option<PathBuf> {
        if let Some(root) = std::env::var_os(FIXTURE_ROOT) {
            let root = PathBuf::from(root);
            assert_eq!(discover("node"), Some(root.join("bin/node")));
            assert_eq!(discover("uv"), Some(root.join("bin/uv")));
            assert_eq!(
                npm_cli(),
                Some(root.join("bin/node_modules/npm/bin/npm-cli.js"))
            );
            return Some(root);
        }
        let temporary = tempfile::Builder::new()
            .prefix("oleafly managed install ")
            .tempdir()
            .unwrap();
        let root = temporary.path().canonicalize().unwrap();
        let bin = root.join("bin");
        let npm = bin.join("node_modules/npm/bin");
        std::fs::create_dir_all(&npm).unwrap();
        let node = discover("node").expect("Node.js is required for managed install fixtures");
        executable(
            &bin.join("node"),
            &format!("#!/bin/sh\nexec {} \"$@\"\n", shell_quote(&node)),
        );
        executable(&npm.join("npm-cli.js"), INSTALLER);
        std::os::unix::fs::symlink(npm.join("npm-cli.js"), bin.join("npm")).unwrap();
        let uv = root.join("uv.js");
        std::fs::write(&uv, INSTALLER).unwrap();
        executable(
            &bin.join("uv"),
            &format!(
                "#!/bin/sh\nexec {} {} \"$@\"\n",
                shell_quote(&node),
                shell_quote(&uv),
            ),
        );
        std::fs::write(root.join("outside"), b"outside fixture must stay unchanged").unwrap();
        let output = tokio::time::timeout(
            Duration::from_secs(30),
            tokio::process::Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    &format!("acp::catalog::catalog_tests::managed_install::{name}"),
                    "--nocapture",
                ])
                .env("PATH", &bin)
                .env(FIXTURE_ROOT, &root)
                .kill_on_drop(true)
                .output(),
        )
        .await
        .expect("managed install fixture timed out")
        .unwrap();
        assert!(
            output.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(String::from_utf8_lossy(&output.stdout).contains("1 passed"));
        None
    }

    fn definition(npm: bool, cmd: Option<&str>) -> AgentDefinition {
        let mut definition = binary_definition();
        let package = PackageDistribution {
            package: if npm {
                "@oleafly-fixture/agent@1.2.3"
            } else {
                "oleafly-fixture-agent==1.2.3"
            }
            .into(),
            cmd: cmd.map(str::to_owned),
            args: vec!["--acp".into(), "argument with spaces".into()],
            node_major: npm.then_some(20),
            env: BTreeMap::new(),
        };
        definition.distribution = if npm {
            Distribution {
                npx: Some(package),
                ..Distribution::default()
            }
        } else {
            Distribution {
                uvx: Some(package),
                ..Distribution::default()
            }
        };
        definition
    }

    fn settings(root: &Path, value: Value) {
        std::fs::write(root.join("settings.json"), value.to_string()).unwrap();
    }

    fn node_package(bin: Value) -> Value {
        json!({
            "manifest": {"name": "@oleafly-fixture/agent", "version": "1.2.3", "bin": bin},
            "files": {"bin/agent.js": "process.stdout.write(JSON.stringify(process.argv.slice(2)));"}
        })
    }

    fn clean_failure(root: &Path, data: &Path, definition: &AgentDefinition) {
        assert!(read_receipt(data, definition).is_none());
        assert!(!receipt_dir(data, definition).exists());
        assert_eq!(
            std::fs::read_dir(data.join("agents").join(&definition.id))
                .unwrap()
                .count(),
            0
        );
        assert_eq!(
            std::fs::read(root.join("outside")).unwrap(),
            b"outside fixture must stay unchanged"
        );
    }

    async fn launch(data: &Path, definition: &AgentDefinition) -> (Launch, String) {
        let launch = resolve(data, definition).unwrap();
        assert!(launch.managed);
        assert_eq!(launch.version.as_deref(), Some("1.2.3"));
        let mut command = tokio::process::Command::new(&launch.executable);
        command.args(&launch.args);
        let output = bounded_command(command, Duration::from_secs(5))
            .await
            .unwrap();
        (launch, output)
    }

    #[tokio::test]
    async fn npm_installs_manifest_bin_forms_and_reuses_the_receipt() {
        let Some(root) = isolated("npm_installs_manifest_bin_forms_and_reuses_the_receipt").await
        else {
            return;
        };
        for (index, (bin, cmd)) in [
            (json!("bin/agent.js"), None),
            (json!({"only-command": "bin/agent.js"}), None),
            (
                json!({"other-command": "missing.js", "catalog-agent": "bin/agent.js"}),
                Some("catalog-agent"),
            ),
        ]
        .into_iter()
        .enumerate()
        {
            let data = root.join(format!("data-{index}"));
            let definition = definition(true, cmd);
            settings(&root, node_package(bin));
            install(&data, &definition).await.unwrap();
            let receipt = read_receipt(&data, &definition).unwrap();
            assert!(receipt.node);
            assert!(receipt
                .executable
                .ends_with("node_modules/@oleafly-fixture/agent/bin/agent.js"));
            let (resolved, output) = launch(&data, &definition).await;
            assert_eq!(resolved.executable, root.join("bin/node"));
            assert_eq!(output, "[\"--acp\",\"argument with spaces\"]");
            let calls = std::fs::read(root.join("invocations.jsonl")).unwrap();
            settings(&root, json!({"fail": true, "manifest": null}));
            install(&data, &definition).await.unwrap();
            assert_eq!(
                std::fs::read(root.join("invocations.jsonl")).unwrap(),
                calls
            );
            assert_eq!(
                std::fs::read_dir(data.join("agents").join(&definition.id))
                    .unwrap()
                    .count(),
                1
            );
        }
    }

    #[tokio::test]
    async fn npm_detects_node_shebangs_and_sets_native_executable_permissions() {
        let Some(root) =
            isolated("npm_detects_node_shebangs_and_sets_native_executable_permissions").await
        else {
            return;
        };
        for (index, (content, node, expected)) in [
            (
                "#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify(process.argv.slice(2)));",
                true,
                "[\"--acp\",\"argument with spaces\"]",
            ),
            (
                "#!/bin/sh\nprintf '%s\\n' \"$@\"\n",
                false,
                "--acp\nargument with spaces\n",
            ),
        ]
        .into_iter()
        .enumerate()
        {
            let data = root.join(format!("data-{index}"));
            let definition = definition(true, None);
            settings(
                &root,
                json!({"manifest": {"bin": "bin/agent"}, "files": {"bin/agent": content}}),
            );
            install(&data, &definition).await.unwrap();
            let receipt = read_receipt(&data, &definition).unwrap();
            assert_eq!(receipt.node, node);
            if !node {
                assert_eq!(
                    std::fs::metadata(&receipt.executable)
                        .unwrap()
                        .permissions()
                        .mode()
                        & 0o777,
                    0o700
                );
            }
            assert_eq!(launch(&data, &definition).await.1, expected);
        }
    }

    #[tokio::test]
    async fn npm_rejects_invalid_layouts_and_cleans_up_before_retry() {
        let Some(root) = isolated("npm_rejects_invalid_layouts_and_cleans_up_before_retry").await
        else {
            return;
        };
        for (index, (invalid, error)) in [
            (json!({"manifest": null}), "has no manifest"),
            (json!({"manifest": "{"}), "manifest is invalid"),
            (json!({"manifest": {}}), "several executables"),
            (
                json!({"manifest": {"bin": {"one": "one.js", "two": "two.js"}}}),
                "several executables",
            ),
            (
                json!({"manifest": {"bin": "missing.js"}}),
                "was not installed",
            ),
            (
                json!({"manifest": {"bin": "../outside.js"}}),
                "escapes its directory",
            ),
            (
                json!({"manifest": {"bin": "escaped.js"}, "escape": true}),
                "escapes its installation",
            ),
            (
                json!({"manifest": null, "fail": true}),
                "installation failed",
            ),
        ]
        .into_iter()
        .enumerate()
        {
            let data = root.join(format!("data-{index}"));
            let definition = definition(true, None);
            settings(&root, invalid);
            assert!(
                install(&data, &definition)
                    .await
                    .unwrap_err()
                    .contains(error),
                "{error}"
            );
            clean_failure(&root, &data, &definition);
            settings(&root, node_package(json!("bin/agent.js")));
            install(&data, &definition).await.unwrap();
            assert_eq!(
                launch(&data, &definition).await.1,
                "[\"--acp\",\"argument with spaces\"]"
            );
        }
    }

    #[tokio::test]
    async fn uv_installs_internal_links_and_launches_from_its_receipt() {
        let Some(root) = isolated("uv_installs_internal_links_and_launches_from_its_receipt").await
        else {
            return;
        };
        let data = root.join("data");
        let definition = definition(false, Some("catalog-agent"));
        settings(&root, json!({"layout": "valid"}));
        install(&data, &definition).await.unwrap();
        let receipt = read_receipt(&data, &definition).unwrap();
        assert!(!receipt.node);
        assert!(receipt
            .executable
            .ends_with("tools/oleafly-fixture-agent/bin/catalog-agent"));
        assert_eq!(
            launch(&data, &definition).await.1,
            "--acp\nargument with spaces\n"
        );
        let calls = std::fs::read(root.join("invocations.jsonl")).unwrap();
        settings(&root, json!({"fail": true}));
        install(&data, &definition).await.unwrap();
        assert_eq!(
            std::fs::read(root.join("invocations.jsonl")).unwrap(),
            calls
        );
        assert_eq!(
            std::fs::read_dir(data.join("agents").join(&definition.id))
                .unwrap()
                .count(),
            1
        );
        let before = std::fs::read(&receipt.executable).unwrap();
        std::fs::remove_file(receipt_dir(&data, &definition).join("receipt.json")).unwrap();
        assert!(install(&data, &definition)
            .await
            .unwrap_err()
            .contains("incomplete installation"));
        assert_eq!(std::fs::read(&receipt.executable).unwrap(), before);
        assert_eq!(
            std::fs::read(root.join("invocations.jsonl")).unwrap(),
            calls
        );
    }

    #[tokio::test]
    async fn uv_rejects_failed_or_incomplete_layouts_and_allows_retry() {
        let Some(root) = isolated("uv_rejects_failed_or_incomplete_layouts_and_allows_retry").await
        else {
            return;
        };
        for (index, (invalid, error)) in [
            (json!({"fail": true}), "installation failed"),
            (json!({"layout": "missing"}), "was not installed"),
            (json!({"layout": "escaped"}), "escapes its installation"),
        ]
        .into_iter()
        .enumerate()
        {
            let data = root.join(format!("data-{index}"));
            let definition = definition(false, Some("catalog-agent"));
            settings(&root, invalid);
            assert!(
                install(&data, &definition)
                    .await
                    .unwrap_err()
                    .contains(error),
                "{error}"
            );
            clean_failure(&root, &data, &definition);
            settings(&root, json!({"layout": "valid"}));
            install(&data, &definition).await.unwrap();
            assert_eq!(
                launch(&data, &definition).await.1,
                "--acp\nargument with spaces\n"
            );
        }
    }
}
