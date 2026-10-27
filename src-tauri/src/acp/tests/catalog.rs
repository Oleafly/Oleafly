use super::*;
use crate::acp::types::BinaryDistribution;
use crate::program_locator::{Located, ProgramKind};
use crate::test_wait;
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
fn every_builtin_agent_has_a_vendor_cli_and_a_usable_acp_entry_point() {
    let definitions = builtins();
    assert!(definitions.len() >= 14);
    let mut ids = std::collections::BTreeSet::new();
    for definition in &definitions {
        assert!(
            ids.insert(definition.id.clone()),
            "duplicate id {}",
            definition.id
        );
        validate(definition).unwrap();
        let vendor =
            vendor_cli(definition).unwrap_or_else(|| panic!("{} has no vendor CLI", definition.id));
        assert!(!vendor.command.is_empty());
        assert!(!vendor.sign_in_command.is_empty());
        match (
            &definition.distribution.command,
            &definition.distribution.npx,
        ) {
            (Some(command), None) => {
                assert_eq!(command.executable, vendor.command);
                assert!(
                    !command.args.is_empty(),
                    "{} serves ACP with no arguments",
                    definition.id
                );
                assert!(vendor.shares_bridge, "{} runs its own CLI", definition.id);
                assert_eq!(
                    install_reason(definition).as_deref(),
                    Some("This definition uses an existing executable. Install it using the agent's instructions.")
                );
            }
            (None, Some(npx)) => {
                assert!(npx.package.contains('@'));
                assert!(npx.cmd.is_some());
                assert!(npx.node_major.is_some());
            }
            _ => panic!("{} needs exactly one distribution", definition.id),
        }
    }
    for (id, _) in VENDOR_CLIS {
        assert!(ids.contains(*id), "{id} has a vendor CLI but no definition");
    }
}

#[test]
fn sign_in_hints_name_the_vendor_command_and_stay_specific_for_api_key_agents() {
    let by_id = |id: &str| builtins().into_iter().find(|value| value.id == id).unwrap();
    let installed = |command: &str, sign_in: &str| CliStatus {
        command: command.into(),
        display_name: command.into(),
        path: Some(format!("/usr/local/bin/{command}")),
        version: None,
        sign_in_command: sign_in.into(),
        source: Some("auto".into()),
        rejected: Vec::new(),
    };
    assert_eq!(
        sign_in_hint(
            &by_id("opencode"),
            Some(&installed("opencode", "opencode auth login")),
            false
        ),
        "Run opencode auth login in your terminal, then reconnect."
    );
    assert_eq!(
        sign_in_hint(
            &by_id("pi"),
            Some(&installed("pi", r"& 'D:\Tools\Agents\Pi\pi.cmd'")),
            false
        ),
        r"Run & 'D:\Tools\Agents\Pi\pi.cmd' in your terminal and sign in with /login, then reconnect."
    );
    assert_eq!(
        sign_in_hint(&by_id("pi"), None, false),
        "Run pi in your terminal and sign in with /login, then reconnect."
    );
    assert_eq!(
        sign_in_hint(&by_id("kimi"), None, false),
        "Install Kimi Code, run kimi login in your terminal, then reconnect."
    );
    assert!(sign_in_hint(&by_id("deepseek"), None, false).contains("DEEPSEEK_API_KEY"));
    assert!(sign_in_hint(&by_id("pi"), None, false).contains("/login"));
    assert!(sign_in_hint(&by_id("gemini"), None, false).contains("workspace trust"));
}

#[test]
fn gemini_starts_in_the_acp_mode_its_own_cli_offers() {
    let gemini = builtins()
        .into_iter()
        .find(|value| value.id == "gemini")
        .unwrap();
    let args = gemini
        .distribution
        .npx
        .as_ref()
        .map(|npx| npx.args.clone())
        .unwrap_or_default();
    assert_eq!(args, ["--experimental-acp"]);
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
        "NPM",
        "npx.CMD",
        "Yarn.cmd",
        "uv.exe",
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
    assert_eq!(launch.executable, locator::child_path(&executable));
    assert!(!launch.executable.to_string_lossy().starts_with(r"\\?\"));
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
            let agent_args = definition
                .distribution
                .npx
                .as_ref()
                .map(|npx| npx.args.clone())
                .unwrap_or_default();
            assert!(!agent_args.is_empty());
            let expected: Vec<String> =
                std::iter::once(locator::child_path(&script).to_string_lossy().into_owned())
                    .chain(agent_args)
                    .collect();
            assert_eq!(launch.args, expected);
            assert_eq!(launch.entry, Some(locator::child_path(&script)));
            for part in std::iter::once(launch.executable.to_string_lossy().into_owned())
                .chain(launch.args.iter().cloned())
            {
                assert!(!part.starts_with(r"\\?\"), "{part}");
            }
            assert!(launch.managed);
            assert_eq!(launch.version, Some(definition.version));
        }
        None => assert!(crate::app_error::english_error(
            &resolve(temp.path(), &definition).unwrap_err()
        )
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
fn absolute_programs_keep_the_path_as_given_and_windows_scripts_count() {
    let temp = tempfile::tempdir().unwrap();
    let executable = temp.path().join("agent.exe");
    native_file(&executable);
    assert_eq!(
        discover(executable.to_str().unwrap()),
        Some(executable.clone())
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
        assert_eq!(
            locator::locate_path(&script),
            Ok(Located {
                path: script.clone(),
                kind: ProgramKind::Script
            })
        );
        let powershell = temp.path().join("agent.ps1");
        std::fs::write(&powershell, b"echo fixture").unwrap();
        assert_eq!(
            locator::locate_path(&powershell),
            Err(locator::RejectReason::PowerShellScript)
        );
        let canonical = executable.canonicalize().unwrap();
        assert!(!discover(canonical.to_str().unwrap())
            .unwrap()
            .to_string_lossy()
            .starts_with(r"\\?\"));
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
        Some(executable.to_string_lossy().into_owned())
    );
    assert_eq!(current.program_override, None);
    assert!(!current.cli_required);
    std::fs::remove_file(executable).unwrap();
    let missing = status(temp.path(), definition, false).await;
    assert!(!missing.installed);
    assert!(crate::app_error::english_error(&missing.reason.unwrap()).contains("isn't installed"));
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
async fn local_install_commands_bound_output_and_report_why_the_command_failed() {
    let python = crate::acp::tests::fixture_python();
    let mut command = tokio::process::Command::new(&python);
    command.args(["-c", "import sys; sys.stdout.write('x' * 100000)"]);
    let output = bounded_command(command, test_wait::CHILD_PATIENCE)
        .await
        .unwrap();
    assert_eq!(output, "x".repeat(64 * 1024));

    let mut command = tokio::process::Command::new(&python);
    command.args([
        "-c",
        "import sys; sys.stdout.write('npm notice line\\n'); sys.stderr.write('npm error code E404\\nnpm error 404 Not Found\\n'); sys.exit(2)",
    ]);
    let error = bounded_command(command, test_wait::CHILD_PATIENCE)
        .await
        .unwrap_err();
    assert_eq!(
        error.lines().collect::<Vec<_>>(),
        [
            "npm notice line",
            "npm error code E404",
            "npm error 404 Not Found"
        ]
    );

    let mut command = tokio::process::Command::new(python);
    command.args(["-c", "import sys; sys.exit(2)"]);
    let silent = bounded_command(command, test_wait::CHILD_PATIENCE)
        .await
        .unwrap_err();
    assert_eq!(silent, INSTALL_FAILED);
}

#[tokio::test]
async fn a_verbose_failure_still_reports_its_final_lines() {
    let python = crate::acp::tests::fixture_python();
    let mut command = tokio::process::Command::new(&python);
    command.args([
        "-c",
        "import sys\nfor n in range(4000): sys.stderr.write('npm warn deprecated package-%d\\n' % n)\nsys.stderr.write('npm error code EBADENGINE\\n')\nsys.stderr.write('npm error Unsupported engine for agent@1.0.0\\n')\nsys.exit(1)\n",
    ]);
    let error = bounded_command(command, Duration::from_secs(30))
        .await
        .unwrap_err();
    assert!(
        error.contains("npm error Unsupported engine for agent@1.0.0"),
        "{error}"
    );
    assert_eq!(error.lines().count(), 8);
}

#[tokio::test]
async fn local_install_commands_handle_spawn_failure_and_timeout() {
    let temp = tempfile::tempdir().unwrap();
    let command = tokio::process::Command::new(temp.path().join("missing-installer.exe"));
    assert!(bounded_command(command, Duration::from_secs(5))
        .await
        .unwrap_err()
        .contains("could not be started"));
    let python = crate::acp::tests::fixture_python();
    let mut command = tokio::process::Command::new(python);
    command.args(["-c", "import time; time.sleep(30)"]);
    assert!(bounded_command(command, Duration::from_millis(100))
        .await
        .unwrap_err()
        .contains("timed out and was stopped"));
}

/// A CLI stand-in for `--version` probes: a shell script on unix, a batch
/// file (started through cmd.exe, as a bridge would) on Windows.
fn version_probe_cli(folder: &Path, stem: &str, unix: &str, windows: &str) -> Located {
    #[cfg(windows)]
    {
        let _ = unix;
        let path = folder.join(format!("{stem}.cmd"));
        std::fs::write(&path, format!("@echo off\r\n{windows}\r\n")).unwrap();
        Located {
            path,
            kind: ProgramKind::Script,
        }
    }
    #[cfg(not(windows))]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = windows;
        let path = folder.join(stem);
        std::fs::write(
            &path,
            format!("#!/bin/sh\n[ \"$1\" = --warm-up ] && exit 0\n{unix}\n"),
        )
        .unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).unwrap();
        let warmed = std::process::Command::new(&path)
            .arg("--warm-up")
            .status()
            .unwrap();
        assert!(warmed.success());
        Located {
            path,
            kind: ProgramKind::Native,
        }
    }
}

#[tokio::test]
async fn a_failed_version_probe_describes_the_probe_rather_than_an_installation() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("acp");
    let env = locator::child_env(&[], &[]);
    let no_install_wording = |message: &str| {
        let lower = message.to_lowercase();
        assert!(
            !lower.contains("installation") && !lower.contains("installer"),
            "a --version probe reported installer wording: {message}"
        );
    };

    let silent = version_probe_cli(temp.path(), "silent-cli", "exit 3", "exit /b 3");
    let name = silent
        .path
        .file_name()
        .unwrap()
        .to_string_lossy()
        .into_owned();
    let error = program_version(
        &root,
        &silent,
        &["--version"],
        &env,
        Duration::from_secs(10),
    )
    .await
    .unwrap_err();
    no_install_wording(&error);
    assert!(error.contains(&format!("{name} --version")), "{error}");

    let slow = version_probe_cli(
        temp.path(),
        "slow-cli",
        "sleep 20",
        "ping -n 21 127.0.0.1 >nul",
    );
    let name = slow
        .path
        .file_name()
        .unwrap()
        .to_string_lossy()
        .into_owned();
    let error = program_version(
        &root,
        &slow,
        &["--version"],
        &env,
        Duration::from_millis(500),
    )
    .await
    .unwrap_err();
    no_install_wording(&error);
    assert!(error.contains(&format!("{name} --version")), "{error}");
    assert!(error.contains("in time"), "{error}");

    let missing = Located {
        path: temp.path().join(if cfg!(windows) {
            "missing-cli.exe"
        } else {
            "missing-cli"
        }),
        kind: ProgramKind::Native,
    };
    let error = program_version(
        &root,
        &missing,
        &["--version"],
        &env,
        Duration::from_secs(10),
    )
    .await
    .unwrap_err();
    no_install_wording(&error);
    assert!(error.contains("missing-cli"), "{error}");

    // What the CLI printed is still the detail when it printed anything.
    let loud = version_probe_cli(
        temp.path(),
        "loud-cli",
        "echo 'node: not found' >&2; exit 127",
        "echo 'node' is not recognized 1>&2\r\nexit /b 9009",
    );
    let error = program_version(&root, &loud, &["--version"], &env, Duration::from_secs(10))
        .await
        .unwrap_err();
    let printed = if cfg!(windows) {
        "'node' is not recognized"
    } else {
        "node: not found"
    };
    assert_eq!(error.trim(), printed);
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
  assert.deepEqual(args.slice(0, 10), ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--save-exact', '--fetch-retries=1', '--fetch-retry-mintimeout=2000', '--fetch-retry-maxtimeout=10000', '--fetch-timeout=60000', '--prefix']);
  assert.equal(args[11], '@oleafly-fixture/agent@1.2.3');
  assert.equal(process.cwd(), fs.realpathSync(args[10]));
  assert.equal(process.env.npm_config_userconfig, path.join(args[10], 'empty-npmrc'));
  assert.equal(process.env.npm_config_registry, 'https://registry.npmmirror.com/');
  assert.equal(process.env.npm_config_proxy, 'http://127.0.0.1:7890');
  assert.equal(process.env.npm_config_script_shell, undefined);
  assert.equal(JSON.parse(fs.readFileSync(path.join(args[10], 'package.json'))).private, true);
  const cache = process.env.npm_config_cache;
  fs.mkdirSync(path.join(cache, '_cacache'), {recursive: true});
  fs.writeFileSync(path.join(cache, '_cacache', 'tarball'), 'x'.repeat(1024));
  const packageRoot = path.join(args[10], 'node_modules/@oleafly-fixture/agent');
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
if (settings.stderr) fs.writeSync(2, settings.stderr);
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
        std::fs::write(
            root.join("user-npmrc"),
            "registry=https://registry.npmmirror.com/\nproxy=http://127.0.0.1:7890\nscript-shell=/bin/false\n",
        )
        .unwrap();
        let mut child = tokio::process::Command::new(std::env::current_exe().unwrap());
        for key in NPM_NETWORK_KEYS {
            let variable = format!("npm_config_{}", key.replace('-', "_"));
            child.env_remove(&variable);
            child.env_remove(variable.to_ascii_uppercase());
        }
        // The child test runs a whole fixture install, several Node processes
        // in turn.
        let output = tokio::time::timeout(
            test_wait::CHILD_PATIENCE * 4,
            child
                .args([
                    "--exact",
                    &format!("acp::catalog::catalog_tests::managed_install::{name}"),
                    "--nocapture",
                ])
                .env("PATH", &bin)
                .env(FIXTURE_ROOT, &root)
                .env("npm_config_userconfig", root.join("user-npmrc"))
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
        let output = bounded_command(command, test_wait::CHILD_PATIENCE)
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
            // npm's cache does not outlive the install.
            assert!(!data.join("npm-cache").exists());
            assert!(!receipt_dir(&data, &definition).join("npm-cache").exists());
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
            (
                json!({
                    "manifest": null,
                    "fail": true,
                    "stderr": "npm error code ECONNREFUSED\nnpm error A complete log of this run can be found in: /tmp/x/_logs/x-debug-0.log\n"
                }),
                "couldn't reach the npm registry at registry.npmmirror.com (ECONNREFUSED)",
            ),
        ]
        .into_iter()
        .enumerate()
        {
            let data = root.join(format!("data-{index}"));
            let definition = definition(true, None);
            settings(&root, invalid);
            assert!(
                crate::app_error::english_error(&install(&data, &definition).await.unwrap_err())
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

#[test]
fn cli_version_parses_vendor_output_shapes() {
    use super::super::catalog::parse_cli_version;
    assert_eq!(
        parse_cli_version("2.1.258 (Claude Code)").as_deref(),
        Some("2.1.258")
    );
    assert_eq!(
        parse_cli_version("codex-cli 0.104.0\n").as_deref(),
        Some("0.104.0")
    );
    assert_eq!(parse_cli_version("v0.19.4").as_deref(), Some("0.19.4"));
    assert_eq!(parse_cli_version("no version here"), None);
    assert_eq!(parse_cli_version(""), None);
}

#[test]
fn npm_global_roots_cover_the_real_prefix_layouts() {
    let roots = npm_roots_from(
        [PathBuf::from("/opt/tools/bin")],
        Some(PathBuf::from("/usr/local/nvm/v22/bin/node")),
        Some(PathBuf::from("/home/researcher")),
        Some(PathBuf::from("C:\\Users\\researcher\\AppData\\Roaming")),
    );
    for expected in [
        "/opt/tools/lib/node_modules",
        "/usr/local/nvm/v22/lib/node_modules",
        "/usr/local/nvm/v22/bin/node_modules",
        "/home/researcher/.npm-global/lib/node_modules",
        "/opt/homebrew/lib/node_modules",
        "/usr/local/lib/node_modules",
    ] {
        assert!(roots.contains(&PathBuf::from(expected)), "{expected}");
    }
    assert!(roots.contains(
        &PathBuf::from("C:\\Users\\researcher\\AppData\\Roaming")
            .join("npm")
            .join("node_modules")
    ));
    let deduplicated = npm_roots_from(
        [
            PathBuf::from("/opt/tools/bin"),
            PathBuf::from("/opt/tools/bin"),
        ],
        None,
        None,
        None,
    );
    assert_eq!(
        deduplicated
            .iter()
            .filter(|path| *path == &PathBuf::from("/opt/tools/lib/node_modules"))
            .count(),
        1
    );
}

#[tokio::test]
async fn an_agent_pinning_a_newer_node_cannot_be_installed() {
    let temp = tempfile::tempdir().unwrap();
    let mut definition = binary_definition();
    definition.distribution = Distribution {
        npx: Some(PackageDistribution {
            package: "@oleafly-fixture/agent@1.2.3".into(),
            cmd: Some("oleafly-fixture-agent".into()),
            args: Vec::new(),
            node_major: Some(999),
            env: BTreeMap::new(),
        }),
        ..Distribution::default()
    };
    let blocked = status(temp.path(), definition.clone(), false).await;
    assert!(!blocked.can_install);
    let reason = blocked.reason.unwrap();
    assert!(matches!(
        crate::app_error::code(&reason).as_deref(),
        Some("acp.start.node_missing" | "acp.start.node_outdated")
    ));
    assert!(crate::app_error::english_error(&reason).contains("Node.js 999"));
    definition.distribution.npx.as_mut().unwrap().node_major = Some(1);
    let allowed = status(temp.path(), definition, false).await;
    assert!(allowed.can_install);
}

#[test]
fn a_failed_install_reports_the_last_output_lines_and_falls_back_when_silent() {
    let message = command_failure_message(
        &trailing_lines("npm notice one\n\nnpm notice two\n"),
        &trailing_lines(
            "npm error code E404\nnpm error 404 Not Found - GET https://registry.npmjs.org/@nope%2fagent\n",
        ),
    );
    assert_eq!(
        message.lines().collect::<Vec<_>>(),
        [
            "npm notice one",
            "npm notice two",
            "npm error code E404",
            "npm error 404 Not Found - GET https://registry.npmjs.org/@nope%2fagent",
        ]
    );

    let long = (1..=9)
        .map(|n| format!("line {n}"))
        .collect::<Vec<_>>()
        .join("\n");
    let trimmed = command_failure_message(&trailing_lines(&long), &PipeCapture::default());
    assert_eq!(trimmed.lines().count(), 8);
    assert_eq!(trimmed.lines().next().unwrap(), "line 2");

    assert_eq!(
        command_failure_message(&trailing_lines(""), &trailing_lines("   \n\n")),
        INSTALL_FAILED
    );
    let wide = "x".repeat(4096);
    assert_eq!(
        command_failure_message(&PipeCapture::default(), &trailing_lines(&wide))
            .chars()
            .count(),
        REPORTED_LINE_CHARS
    );
}

#[test]
fn a_node_crash_report_keeps_the_error_line_the_tail_would_drop() {
    let crash = "node:fs:2710\n      binding.lstat(base, false, undefined, true);\n              ^\n\nError: EISDIR: illegal operation on a directory, lstat 'D:'\n    at Object.realpathSync (node:fs:2710:25)\n    at toRealPath (node:internal/modules/helpers:62:13)\n    at Module._findPath (node:internal/modules/cjs/loader:1)\n    at resolveMainPath (node:internal/modules/run_main:1)\n    at executeUserEntryPoint (node:internal/modules/run_main:2)\n    at node:internal/main/run_main_module:36:49 {\n  errno: -4068,\n  code: 'EISDIR',\n  syscall: 'lstat',\n  path: 'D:'\n}\n\nNode.js v25.2.1\n";
    let message = command_failure_message(&PipeCapture::default(), &trailing_lines(crash));
    let lines: Vec<&str> = message.lines().collect();
    assert_eq!(lines.len(), 8, "{message}");
    assert_eq!(
        lines[0],
        "Error: EISDIR: illegal operation on a directory, lstat 'D:'"
    );
    assert!(lines.contains(&"code: 'EISDIR',"));
    assert_eq!(lines.last(), Some(&"Node.js v25.2.1"));

    let npm = "npm error code E404\n".to_string()
        + &"npm error detail line\n".repeat(12)
        + "npm error A complete log of this run can be found in: x.log\n";
    let message = command_failure_message(&PipeCapture::default(), &trailing_lines(&npm));
    assert_eq!(message.lines().next(), Some("npm error code E404"));
    assert_eq!(message.lines().count(), 8);
    for (line, salient) in [
        ("TypeError: x is not a function", true),
        ("npm ERR! code ENOENT", true),
        ("Errors were found", false),
        ("ErrorBoundary ready", false),
    ] {
        assert_eq!(salient_line(line), salient, "{line}");
    }
}

fn npm_env(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<OsString> {
    let pairs: Vec<(String, String)> = pairs
        .iter()
        .map(|(name, value)| (name.to_string(), value.to_string()))
        .collect();
    move |name: &str| {
        pairs
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| OsString::from(value))
    }
}

fn npm_files(files: Vec<(PathBuf, &str)>) -> impl Fn(&Path) -> Option<String> {
    let files: Vec<(PathBuf, String)> = files
        .into_iter()
        .map(|(path, text)| (path, text.to_string()))
        .collect();
    move |path: &Path| {
        files
            .iter()
            .find(|(known, _)| known == path)
            .map(|(_, text)| text.clone())
    }
}

fn npm_setting<'a>(network: &'a NpmNetwork, name: &str) -> Option<&'a str> {
    network
        .env
        .iter()
        .find(|(key, _)| key == name)
        .map(|(_, value)| value.as_str())
}

#[test]
fn npm_installs_take_only_network_settings_from_the_users_npm_config() {
    let home = PathBuf::from("/home/r");
    let global = PathBuf::from("/opt/node/etc/npmrc");
    let read = npm_files(vec![
        (
            home.join(".npmrc"),
            "; a registry mirror\n\
             registry = \"https://registry.npmmirror.com/\"\n\
             proxy=http://127.0.0.1:7890 # clash\n\
             https-proxy=${CLASH_PROXY}\n\
             script-shell=/bin/evil\n\
             ignore-scripts=false\n\
             //registry.npmmirror.com/:_authToken=npm-secret-token\n\
             [section]\n\
             registry=https://ignored.example/\n",
        ),
        (
            global.clone(),
            "cafile=~/certs/ca.pem\nstrict-ssl=false\nregistry=https://global.example/\nnoproxy=corp.example\n",
        ),
    ]);
    let global_text = global.to_string_lossy().into_owned();
    let env = npm_env(&[
        ("CLASH_PROXY", "http://127.0.0.1:7891"),
        ("npm_config_globalconfig", &global_text),
    ]);
    let network = npm_network(&env, &read, Some(&home), None, None);
    assert_eq!(network.registry, "https://registry.npmmirror.com/");
    assert_eq!(network.host(), "registry.npmmirror.com");
    assert_eq!(
        npm_setting(&network, "npm_config_registry"),
        Some("https://registry.npmmirror.com/")
    );
    assert_eq!(
        npm_setting(&network, "npm_config_proxy"),
        Some("http://127.0.0.1:7890")
    );
    assert_eq!(
        npm_setting(&network, "npm_config_https_proxy"),
        Some("http://127.0.0.1:7891")
    );
    assert_eq!(
        npm_setting(&network, "npm_config_noproxy"),
        Some("corp.example,127.0.0.1,localhost,::1")
    );
    assert_eq!(
        npm_setting(&network, "npm_config_cafile").map(PathBuf::from),
        Some(home.join("certs").join("ca.pem"))
    );
    assert_eq!(
        npm_setting(&network, "npm_config_strict_ssl"),
        Some("false")
    );
    assert_eq!(network.env.len(), 6, "{:?}", network.env);
}

#[test]
fn npm_registries_must_be_https_or_loopback_http() {
    let home = PathBuf::from("/home/r");
    for (registry, accepted) in [
        ("https://registry.npmmirror.com", true),
        ("http://localhost:4873/", true),
        ("http://127.0.0.1:4873", true),
        ("http://[::1]:4873/", true),
        ("http://registry.npmmirror.com/", false),
        ("http://192.168.1.10:4873/", false),
        ("ftp://registry.npmjs.org/", false),
        ("registry.npmmirror.com", false),
        ("${UNSET_REGISTRY}", false),
    ] {
        let text = format!("registry={registry}\n");
        let read = npm_files(vec![(home.join(".npmrc"), text.as_str())]);
        let network = npm_network(&npm_env(&[]), &read, Some(&home), None, None);
        let expected = if accepted {
            registry
        } else {
            "https://registry.npmjs.org"
        };
        assert_eq!(network.registry, expected, "{registry}");
        assert_eq!(npm_setting(&network, "npm_config_registry"), Some(expected));
    }

    let empty = npm_network(&npm_env(&[]), &|_| None, Some(&home), None, None);
    assert_eq!(empty.registry, "https://registry.npmjs.org");
    assert_eq!(empty.host(), "registry.npmjs.org");
    assert_eq!(
        empty.env,
        [(
            "npm_config_registry".to_string(),
            "https://registry.npmjs.org".to_string()
        )]
    );

    let read = npm_files(vec![(
        home.join(".npmrc"),
        "registry=https://registry.npmmirror.com/\n",
    )]);
    let env = npm_env(&[("npm_config_registry", "https://env.example/")]);
    assert_eq!(
        npm_network(&env, &read, Some(&home), None, None).registry,
        "https://env.example/"
    );
    let custom = PathBuf::from("/elsewhere/npmrc");
    let custom_text = custom.to_string_lossy().into_owned();
    let read = npm_files(vec![(custom.clone(), "registry=https://custom.example/\n")]);
    let env = npm_env(&[("npm_config_userconfig", &custom_text)]);
    assert_eq!(
        npm_network(&env, &read, Some(&home), None, None).registry,
        "https://custom.example/"
    );
}

#[cfg(unix)]
#[test]
fn the_global_and_builtin_npmrc_files_follow_npms_own_layout() {
    let read = npm_files(vec![
        (
            PathBuf::from("/usr/local/lib/node_modules/npm/npmrc"),
            "prefix=/opt/brew\n",
        ),
        (
            PathBuf::from("/opt/brew/etc/npmrc"),
            "registry=https://from-global.example/\n",
        ),
        (
            PathBuf::from("/opt/node/etc/npmrc"),
            "registry=https://default-prefix.example/\n",
        ),
    ]);
    let network = npm_network(
        &npm_env(&[]),
        &read,
        None,
        Some(Path::new("/opt/node/bin/node")),
        Some(Path::new("/usr/local/lib/node_modules/npm/bin/npm-cli.js")),
    );
    assert_eq!(network.registry, "https://from-global.example/");
    let network = npm_network(
        &npm_env(&[]),
        &read,
        None,
        Some(Path::new("/opt/node/bin/node")),
        None,
    );
    assert_eq!(network.registry, "https://default-prefix.example/");
}

const REFUSED_NPM_OUTPUT: &str = "npm error code ECONNREFUSED
npm error syscall connect
npm error errno ECONNREFUSED
npm error FetchError: request to http://127.0.0.1:9/pi-acp failed, reason: connect ECONNREFUSED 127.0.0.1:9
npm error     at ClientRequest.<anonymous> (/Users/r/.hermes/node/lib/node_modules/npm/node_modules/minipass-fetch/lib/index.js:130:14)
npm error     at ClientRequest.emit (node:events:514:20)
npm error     at emitErrorEvent (node:_http_client:114:11)
npm error     at _destroy (node:_http_client:1169:9)
npm error     at onSocketNT (node:_http_client:1190:5)
npm error     at process.processTicksAndRejections (node:internal/process/task_queues:91:21) {
npm error   code: 'ECONNREFUSED',
npm error   errno: 'ECONNREFUSED',
npm error   syscall: 'connect',
npm error   address: '127.0.0.1',
npm error   port: 9,
npm error   type: 'system',
npm error   requiredBy: '.'
npm error }
npm error
npm error If you are behind a proxy, please make sure that the 'proxy' config is set properly.  See: 'npm help config'
npm error A complete log of this run can be found in: /tmp/install-1/npm-cache/_logs/2026-10-26T16_14_29_422Z-debug-0.log
";

const TIMED_OUT_NPM_OUTPUT: &str = "npm error code FETCH_ERROR
npm error errno FETCH_ERROR
npm error network timeout at: http://127.0.0.1:18999/pi-acp
npm error A complete log of this run can be found in: /tmp/install-1/npm-cache/_logs/2026-10-26T16_26_16_722Z-debug-0.log
";

fn npm_failure(stderr: &str) -> CommandFailure {
    CommandFailure::Failed(failure_lines(
        &PipeCapture::default(),
        &trailing_lines(stderr),
    ))
}

#[test]
fn npm_network_failures_name_the_registry_and_say_what_to_check() {
    let advice = "Check your network connection, proxy or npm registry setting.";
    let english = |failure: String| crate::app_error::english_error(&failure);
    let refused = npm_install_message(npm_failure(REFUSED_NPM_OUTPUT), "127.0.0.1");
    assert_eq!(
        crate::app_error::code(&refused).as_deref(),
        Some("acp.install.npm_unreachable")
    );
    assert_eq!(
        english(refused),
        format!("Oleafly couldn't reach the npm registry at 127.0.0.1 (ECONNREFUSED). {advice}")
    );
    assert_eq!(
        english(npm_install_message(
            npm_failure(TIMED_OUT_NPM_OUTPUT),
            "registry.npmmirror.com"
        )),
        format!(
            "Oleafly couldn't reach the npm registry at registry.npmmirror.com (FETCH_ERROR). {advice}"
        )
    );
    for (output, code) in [
        ("npm error code ETIMEDOUT\nnpm error syscall connect\n", "ETIMEDOUT"),
        ("npm error code ENOTFOUND\nnpm error network request to https://registry.npmjs.org/pi-acp failed, reason: getaddrinfo ENOTFOUND registry.npmjs.org\n", "ENOTFOUND"),
        ("npm error code EAI_AGAIN\n", "EAI_AGAIN"),
        ("npm error code ECONNRESET\nnpm error network aborted\n", "ECONNRESET"),
        ("npm error code UNABLE_TO_GET_ISSUER_CERT_LOCALLY\nnpm error errno UNABLE_TO_GET_ISSUER_CERT_LOCALLY\nnpm error request to https://registry.npmjs.org/pi-acp failed, reason: unable to get local issuer certificate\n", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY"),
        ("npm error code SELF_SIGNED_CERT_IN_CHAIN\n", "SELF_SIGNED_CERT_IN_CHAIN"),
        ("npm error code CERT_HAS_EXPIRED\n", "CERT_HAS_EXPIRED"),
    ] {
        assert_eq!(
            english(npm_install_message(npm_failure(output), "registry.npmjs.org")),
            format!("Oleafly couldn't reach the npm registry at registry.npmjs.org ({code}). {advice}"),
            "{output}"
        );
    }
    let timed_out = npm_install_message(CommandFailure::TimedOut, "registry.npmmirror.com");
    assert_eq!(
        crate::app_error::code(&timed_out).as_deref(),
        Some("acp.install.npm_timed_out")
    );
    let timed_out = english(timed_out);
    assert!(timed_out.contains("registry.npmmirror.com"), "{timed_out}");
    assert!(timed_out.ends_with(advice), "{timed_out}");
    assert_eq!(
        npm_install_message(CommandFailure::NotStarted("NotFound: node".into()), "x"),
        "The installation command could not be started (NotFound: node)."
    );
}

#[test]
fn other_npm_failures_keep_their_lines_without_the_deleted_debug_log() {
    let not_found = "npm error code E404\n\
         npm error 404 Not Found - GET https://registry.npmmirror.com/@nope%2fagent - Not found\n\
         npm error A complete log of this run can be found in: /tmp/install-1/npm-cache/_logs/x-debug-0.log\n";
    assert_eq!(
        npm_install_message(npm_failure(not_found), "registry.npmmirror.com"),
        "npm error code E404\nnpm error 404 Not Found - GET https://registry.npmmirror.com/@nope%2fagent - Not found"
    );
    let older = "npm ERR! code E404\n\
         npm ERR! A complete log of this run can be found in:\n\
         npm ERR!     /tmp/install-1/npm-cache/_logs/2026-10-26T16_14_29_422Z-debug-0.log\n";
    assert_eq!(
        npm_install_message(npm_failure(older), "registry.npmjs.org"),
        "npm ERR! code E404"
    );
    let only_log =
        "npm error A complete log of this run can be found in: /tmp/x/_logs/x-debug-0.log\n";
    assert_eq!(
        npm_install_message(npm_failure(only_log), "registry.npmjs.org"),
        INSTALL_FAILED
    );
}

fn vendor(id: &str) -> VendorCli {
    vendor_cli(&builtins().into_iter().find(|agent| agent.id == id).unwrap()).unwrap()
}

fn cli(path: &Path, kind: ProgramKind, overridden: bool) -> CliProgram {
    CliProgram {
        located: Located {
            path: path.to_path_buf(),
            kind,
        },
        overridden,
        version: None,
    }
}

#[test]
fn codex_gets_a_cli_at_least_as_new_as_the_one_its_bridge_bundles() {
    let temp = tempfile::tempdir().unwrap();
    let codex = temp.path().join("codex");
    let found = |version: Option<&str>| CliProgram {
        version: version.map(str::to_owned),
        ..cli(&codex, ProgramKind::Native, false)
    };
    let handed = Some(("CODEX_PATH".to_string(), codex.clone().into_os_string()));
    assert_eq!(CODEX_BUNDLED_CLI, "0.160.1");
    for version in ["0.162.1", "0.160.1", "1.0.0", "0.161.0-alpha.1"] {
        assert_eq!(
            cli_handoff(&vendor("codex"), Some(&found(Some(version)))),
            handed,
            "{version}"
        );
    }
    for version in [
        Some("0.159.9"),
        Some("0.160.1-alpha.2"),
        Some("latest"),
        None,
    ] {
        assert_eq!(
            cli_handoff(&vendor("codex"), Some(&found(version))),
            None,
            "{version:?}"
        );
    }
    let claude = temp.path().join("claude");
    assert_eq!(
        cli_handoff(
            &vendor("claude"),
            Some(&CliProgram {
                version: Some("99.0.0".into()),
                ..cli(&claude, ProgramKind::Native, false)
            })
        ),
        None
    );
}

#[tokio::test]
async fn a_probed_cli_version_is_known_until_the_program_changes() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("acp");
    let env = locator::child_env(&[], &[]);
    let codex = version_probe_cli(
        temp.path(),
        "codex",
        "echo codex-cli 0.162.1",
        "echo codex-cli 0.162.1",
    );
    assert_eq!(known_cli_version(&codex.path), None);
    let version = program_version(
        &root,
        &codex,
        vendor("codex").version_args,
        &env,
        Duration::from_secs(10),
    )
    .await
    .unwrap();
    assert_eq!(version, "0.162.1");
    assert_eq!(known_cli_version(&codex.path).as_deref(), Some("0.162.1"));
    let mut file = std::fs::OpenOptions::new()
        .append(true)
        .open(&codex.path)
        .unwrap();
    writeln!(file).unwrap();
    drop(file);
    assert_eq!(known_cli_version(&codex.path), None);
}

#[test]
fn bridges_learn_where_the_cli_is_only_as_they_can_use_it() {
    let temp = tempfile::tempdir().unwrap();
    let pi_cmd = temp.path().join("pi.cmd");
    let pi = cli(&pi_cmd, ProgramKind::Script, false);
    assert_eq!(
        cli_handoff(&vendor("pi"), Some(&pi)),
        Some(("PI_ACP_PI_COMMAND".into(), pi_cmd.clone().into_os_string()))
    );
    assert_eq!(cli_handoff(&vendor("pi"), None), None);

    let claude_exe = temp.path().join("claude.exe");
    assert_eq!(
        cli_handoff(
            &vendor("claude"),
            Some(&cli(&claude_exe, ProgramKind::Native, false))
        ),
        None,
        "Claude uses its bundled CLI unless one was chosen"
    );
    assert_eq!(
        cli_handoff(
            &vendor("claude"),
            Some(&cli(&claude_exe, ProgramKind::Native, true))
        ),
        Some(("CLAUDE_CODE_EXECUTABLE".into(), claude_exe.into_os_string()))
    );
    let claude_cmd = temp.path().join("claude.cmd");
    std::fs::write(&claude_cmd, "@echo off\r\n").unwrap();
    assert_eq!(
        cli_handoff(
            &vendor("claude"),
            Some(&cli(&claude_cmd, ProgramKind::Script, true))
        ),
        None,
        "CLAUDE_CODE_EXECUTABLE is never a .cmd"
    );
    let script = temp
        .path()
        .join("node_modules/@anthropic-ai/claude-code/cli.js");
    std::fs::create_dir_all(script.parent().unwrap()).unwrap();
    std::fs::write(&script, "").unwrap();
    std::fs::write(
        &claude_cmd,
        "@SETLOCAL\r\n@node  \"%~dp0\\node_modules\\@anthropic-ai\\claude-code\\cli.js\" %*\r\n",
    )
    .unwrap();
    let (name, value) = cli_handoff(
        &vendor("claude"),
        Some(&cli(&claude_cmd, ProgramKind::Script, true)),
    )
    .unwrap();
    assert_eq!(name, "CLAUDE_CODE_EXECUTABLE");
    assert!(PathBuf::from(value).ends_with("cli.js"));

    let codex_cmd = temp.path().join("codex.cmd");
    assert_eq!(
        cli_handoff(
            &vendor("codex"),
            Some(&cli(&codex_cmd, ProgramKind::Script, false))
        ),
        None
    );
    assert_eq!(
        cli_handoff(
            &vendor("codex"),
            Some(&cli(&codex_cmd, ProgramKind::Script, true))
        ),
        Some(("CODEX_PATH".into(), codex_cmd.into_os_string()))
    );
    assert_eq!(
        cli_handoff(
            &vendor("opencode"),
            Some(&cli(
                &temp.path().join("opencode"),
                ProgramKind::Native,
                true
            ))
        ),
        None
    );
}

#[test]
fn node_comes_first_and_only_a_cli_the_bridge_needs_goes_before_system_folders() {
    let node = PathBuf::from("/opt/node/bin/node");
    let launch = Launch {
        executable: node.clone(),
        entry: Some(PathBuf::from("/data/agents/pi/index.js")),
        ..Launch::default()
    };
    let pi = cli(
        Path::new("/home/r/.pi/agent/bin/pi"),
        ProgramKind::Native,
        false,
    );
    let (prepend, append) =
        search_path_folders(Some(&vendor("pi")), Some(&node), Some(&pi), &launch);
    assert_eq!(
        prepend,
        [
            PathBuf::from("/opt/node/bin"),
            PathBuf::from("/opt/node/bin"),
            PathBuf::from("/home/r/.pi/agent/bin")
        ]
    );
    assert!(append.is_empty());
    let codex = cli(
        Path::new("/tools/codex/bin/codex"),
        ProgramKind::Native,
        false,
    );
    let (prepend, append) =
        search_path_folders(Some(&vendor("codex")), Some(&node), Some(&codex), &launch);
    assert_eq!(prepend.last(), Some(&PathBuf::from("/opt/node/bin")));
    assert_eq!(append, [PathBuf::from("/tools/codex/bin")]);
    let env = launch_env(Some(&vendor("pi")), Some(&node), Some(&pi), &launch);
    assert_eq!(env[0].0, "PATH");
    assert!(env.iter().any(|(name, value)| name == "PI_ACP_PI_COMMAND"
        && Path::new(value) == Path::new("/home/r/.pi/agent/bin/pi")));
}

#[test]
fn a_recognised_windows_shim_runs_its_script_with_node_and_others_run_through_cmd() {
    let temp = tempfile::tempdir().unwrap();
    let prefix = temp.path().join("npm");
    let script = prefix.join("node_modules/opencode-ai/bin/opencode.js");
    std::fs::create_dir_all(script.parent().unwrap()).unwrap();
    std::fs::write(&script, "").unwrap();
    let shim = prefix.join("opencode.cmd");
    std::fs::write(
        &shim,
        "@IF EXIST \"%~dp0\\node.exe\" (\r\n  \"%~dp0\\node.exe\"  \"%~dp0\\node_modules\\opencode-ai\\bin\\opencode.js\" %*\r\n) ELSE (\r\n  @SETLOCAL\r\n  @SET PATHEXT=%PATHEXT:;.JS;=;%\r\n  node  \"%~dp0\\node_modules\\opencode-ai\\bin\\opencode.js\" %*\r\n)\r\n",
    )
    .unwrap();
    let node = temp.path().join("nodejs/node.exe");
    let launch = launch_program(
        Located {
            path: shim.clone(),
            kind: ProgramKind::Script,
        },
        vec!["acp".into()],
        Some(&node),
    );
    assert_eq!(launch.executable, node);
    assert_eq!(
        launch.args,
        [
            prefix
                .join("node_modules")
                .join("opencode-ai")
                .join("bin")
                .join("opencode.js")
                .to_string_lossy()
                .into_owned(),
            "acp".to_string()
        ]
    );
    assert!(!launch.batch);
    let other = temp.path().join("hermes.cmd");
    std::fs::write(&other, "@\"%~dp0\\venv\\Scripts\\hermes.exe\" %*\r\n").unwrap();
    let launch = launch_program(
        Located {
            path: other.clone(),
            kind: ProgramKind::Script,
        },
        vec!["acp".into()],
        Some(&node),
    );
    assert_eq!(launch.executable, other);
    assert_eq!(launch.args, ["acp"]);
    assert!(launch.batch);
    let no_node = launch_program(
        Located {
            path: shim,
            kind: ProgramKind::Script,
        },
        Vec::new(),
        None,
    );
    assert!(no_node.batch);
}

#[test]
fn a_chosen_program_wins_over_the_managed_install_for_agents_oleafly_starts_directly() {
    let temp = tempfile::tempdir().unwrap();
    let definition = binary_definition();
    let managed = installed_fixture(temp.path(), &definition, false);
    let chosen = temp.path().join("chosen-agent.exe");
    native_file(&chosen);
    assert_eq!(program_role(&definition), ProgramRole::Launch);
    let plan = plan(temp.path(), &definition, Some(&chosen));
    let launch = plan.launch.unwrap();
    assert_eq!(launch.executable, chosen);
    assert_eq!(launch.args, ["--acp"]);
    assert!(!launch.managed);
    let fallback = resolve(temp.path(), &definition).unwrap();
    assert_eq!(fallback.executable, locator::child_path(&managed));
    let missing = super::plan(
        temp.path(),
        &definition,
        Some(&temp.path().join("gone.exe")),
    );
    assert!(
        crate::app_error::english_error(&missing.launch.unwrap_err()).contains("Choose it again")
    );
}

#[test]
fn a_chosen_cli_is_handed_to_the_bridge_and_the_bridge_stays_the_same() {
    let temp = tempfile::tempdir().unwrap();
    let pi = builtins()
        .into_iter()
        .find(|agent| agent.id == "pi")
        .unwrap();
    assert_eq!(program_role(&pi), ProgramRole::Cli);
    let script = installed_fixture(temp.path(), &pi, true);
    // Windows starts only programs with a program extension.
    let chosen = temp
        .path()
        .join("D Tools")
        .join(format!("pi-cli{}", std::env::consts::EXE_SUFFIX));
    std::fs::create_dir_all(chosen.parent().unwrap()).unwrap();
    native_file(&chosen);
    let plan = plan(temp.path(), &pi, Some(&chosen));
    assert_eq!(
        plan.cli,
        Some(CliProgram {
            located: Located {
                path: chosen.clone(),
                kind: ProgramKind::Native
            },
            overridden: true,
            version: None
        })
    );
    if let Ok(launch) = plan.launch {
        assert_eq!(launch.entry, Some(locator::child_path(&script)));
        assert!(launch
            .env
            .iter()
            .any(|(name, value)| name == "PI_ACP_PI_COMMAND" && Path::new(value) == chosen));
        let path = &launch
            .env
            .iter()
            .find(|(name, _)| name == "PATH")
            .unwrap()
            .1;
        assert!(std::env::split_paths(path).any(|entry| entry == chosen.parent().unwrap()));
    }
    let gone = super::plan(temp.path(), &pi, Some(&temp.path().join("missing-pi")));
    assert!(gone.cli.is_none());
    assert_eq!(gone.cli_rejected[0].reason, locator::RejectReason::NotFound);
}

#[tokio::test]
async fn status_reports_the_chosen_program_its_source_and_whether_the_cli_is_required() {
    let temp = tempfile::tempdir().unwrap();
    let pi = builtins()
        .into_iter()
        .find(|agent| agent.id == "pi")
        .unwrap();
    let chosen = temp
        .path()
        .join(format!("pi-cli{}", std::env::consts::EXE_SUFFIX));
    native_file(&chosen);
    let status = status_with(
        temp.path(),
        pi.clone(),
        false,
        Some(chosen.to_string_lossy().into_owned()),
    )
    .await;
    assert!(status.cli_required);
    assert_eq!(
        status.program_override.as_deref(),
        Some(chosen.to_string_lossy().as_ref())
    );
    let cli = status.cli.unwrap();
    assert_eq!(cli.source.as_deref(), Some("override"));
    assert_eq!(cli.path.as_deref(), Some(chosen.to_string_lossy().as_ref()));
    assert!(cli.sign_in_command.contains(&*chosen.to_string_lossy()));
    let claude = builtins()
        .into_iter()
        .find(|agent| agent.id == "claude")
        .unwrap();
    assert!(
        !status_with(temp.path(), claude, false, None)
            .await
            .cli_required
    );
}

#[test]
fn sign_in_commands_quote_a_cli_a_terminal_cannot_find_by_name() {
    for windows in [false, true] {
        assert_eq!(
            sign_in_command_for(
                "claude auth login",
                Some(Path::new("/x/claude")),
                true,
                windows
            ),
            "claude auth login"
        );
        assert_eq!(sign_in_command_for("pi", None, false, windows), "pi");
    }

    // POSIX shells: a single-quoted path, so spaces, `$` and backticks stay
    // literal; a quote in the path closes, escapes and reopens.
    assert_eq!(
        sign_in_command_for(
            "claude auth login",
            Some(Path::new("/my tools/claude")),
            false,
            false
        ),
        "'/my tools/claude' auth login"
    );
    assert_eq!(
        sign_in_command_for("pi", Some(Path::new("/x/$HOME/pi")), false, false),
        "'/x/$HOME/pi'"
    );
    assert_eq!(
        sign_in_command_for("pi", Some(Path::new("/Users/o'brien/bin/pi")), false, false),
        r"'/Users/o'\''brien/bin/pi'"
    );

    // PowerShell (the Windows terminal): a quoted path on its own is only a
    // string, so it needs the call operator; quotes in the path are doubled.
    assert_eq!(
        sign_in_command_for(
            "claude auth login",
            Some(Path::new(r"C:\Users\Ada\.local\bin\claude.exe")),
            false,
            true
        ),
        r"& 'C:\Users\Ada\.local\bin\claude.exe' auth login"
    );
    assert_eq!(
        sign_in_command_for("pi", Some(Path::new(r"D:\tools\pi\pi.cmd")), false, true),
        r"& 'D:\tools\pi\pi.cmd'"
    );
    assert_eq!(
        sign_in_command_for("pi", Some(Path::new(r"D:\O'Brien\pi.cmd")), false, true),
        r"& 'D:\O''Brien\pi.cmd'"
    );
    assert_eq!(
        sign_in_command_for(
            "pi",
            Some(Path::new("D:\\O\u{2019}Brien\\pi.cmd")),
            false,
            true
        ),
        "& 'D:\\O\u{2019}\u{2019}Brien\\pi.cmd'"
    );

    // The command shown to the user is the form for this computer's shell.
    let path = Path::new("/my tools/claude");
    assert_eq!(
        sign_in_command_text("claude auth login", Some(path), false),
        sign_in_command_for("claude auth login", Some(path), false, cfg!(windows))
    );
}

#[test]
fn node_versions_parse_with_their_minor_release() {
    assert_eq!(parse_node_version("v22.19.0\n"), Some((22, 19, 0)));
    assert_eq!(parse_node_version("v25.2.1-nightly"), Some((25, 2, 1)));
    assert_eq!(parse_node_version("22"), Some((22, 0, 0)));
    assert_eq!(parse_node_version("node"), None);
    assert!(parse_node_version("v22.18.9").unwrap() < (22, 19, 0));
}

#[test]
fn registry_agents_that_ship_as_built_ins_are_linked_to_them() {
    for (registry, builtin) in [
        ("pi-acp", "pi"),
        ("claude-acp", "claude"),
        ("codex-acp", "codex"),
        ("gemini", "gemini"),
        ("opencode", "opencode"),
        ("cline", "cline"),
        ("kimi", "kimi"),
        ("qoder", "qoder"),
        ("cursor", "cursor"),
        ("codebuddy-code", "codebuddy"),
        ("grok-build", "grok"),
    ] {
        assert_eq!(registry_builtin_id(registry).as_deref(), Some(builtin));
        assert!(builtins().iter().any(|agent| agent.id == builtin));
    }
    assert_eq!(registry_builtin_id("claude-code-acp"), None);
    let entries = registry_entries(
        br#"{"agents":[{"id":"pi-acp","name":"Pi","description":"","version":"0.0.34","distribution":{"npx":{"package":"pi-acp@0.0.34"}}},{"id":"other","name":"Other","description":"","version":"1.0.0","distribution":{"npx":{"package":"other@1.0.0"}}}]}"#,
        "",
    )
    .unwrap();
    assert_eq!(entries[0].builtin_id.as_deref(), Some("pi"));
    assert_eq!(entries[1].builtin_id, None);
}

#[test]
fn pi_uses_the_bridge_release_with_the_windows_launch_fix() {
    let pi = builtins()
        .into_iter()
        .find(|agent| agent.id == "pi")
        .unwrap();
    assert_eq!(pi.distribution.npx.unwrap().package, "pi-acp@0.0.34");
    let vendor = vendor("pi");
    assert!(vendor.bridge_needs_cli);
    assert_eq!(vendor.cli_env, Some("PI_ACP_PI_COMMAND"));
}

#[test]
fn sandboxed_launches_see_resolved_paths() {
    let temp = tempfile::tempdir().unwrap();
    let script = temp.path().join("index.js");
    std::fs::write(&script, "").unwrap();
    let launch = Launch {
        executable: temp.path().join("node"),
        args: vec![script.to_string_lossy().into_owned(), "--acp".into()],
        entry: Some(script.clone()),
        ..Launch::default()
    };
    let resolved = launch.resolved_for_sandbox();
    let real = script.canonicalize().unwrap();
    assert_eq!(resolved.args[0], real.to_string_lossy());
    assert_eq!(resolved.args[1], "--acp");
    assert_eq!(resolved.entry, Some(real));
}

fn builtin(id: &str) -> AgentDefinition {
    builtins().into_iter().find(|agent| agent.id == id).unwrap()
}

#[test]
fn claude_uses_the_bridge_that_bundles_claude_code_2_1_309() {
    let claude = builtin("claude");
    assert_eq!(claude.version, "0.95.0");
    let npx = claude.distribution.npx.unwrap();
    assert_eq!(npx.package, "@agentclientprotocol/claude-agent-acp@0.95.0");
    assert_eq!(npx.node_major, Some(22));
}

#[test]
fn every_bridge_pin_is_the_version_the_catalog_shows() {
    for definition in builtins() {
        if let Some(npx) = &definition.distribution.npx {
            let (_, version) = package_parts(&npx.package, true).unwrap();
            assert_eq!(version, definition.version, "{}", definition.id);
        }
    }
}

#[test]
fn a_slow_registry_link_gets_fifteen_minutes_while_a_dead_one_still_fails_fast() {
    assert_eq!(NPM_INSTALL_LIMIT, Duration::from_secs(15 * 60));
    assert!(NPM_INSTALL_FLAGS.contains(&"--fetch-timeout=60000"));
    assert!(NPM_INSTALL_FLAGS.contains(&"--fetch-retries=1"));
}

fn claude_settings(folder: &Path, text: &str) {
    std::fs::create_dir_all(folder).unwrap();
    std::fs::write(folder.join("settings.json"), text).unwrap();
}

#[test]
fn claude_gateway_users_are_sent_to_their_endpoint_settings_not_to_anthropic_sign_in() {
    let home = tempfile::tempdir().unwrap();
    let home = home.path();
    let nothing = |_: &str| None::<OsString>;
    assert!(!claude_uses_gateway(&nothing, Some(home)));
    assert!(!claude_uses_gateway(&nothing, None));
    for name in ["ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN"] {
        let env = move |key: &str| (key == name).then(|| OsString::from("https://gateway.test"));
        assert!(claude_uses_gateway(&env, Some(home)), "{name}");
    }
    let api_key_only = |key: &str| (key == "ANTHROPIC_API_KEY").then(|| OsString::from("sk-ant"));
    assert!(!claude_uses_gateway(&api_key_only, Some(home)));
    let blank = |key: &str| (key == "ANTHROPIC_BASE_URL").then(OsString::new);
    assert!(!claude_uses_gateway(&blank, Some(home)));

    let folder = home.join(".claude");
    claude_settings(
        &folder,
        r#"{"env":{"ANTHROPIC_BASE_URL":"https://api.deepseek.com/anthropic","ANTHROPIC_AUTH_TOKEN":"sk-secret-1234"}}"#,
    );
    assert!(claude_uses_gateway(&nothing, Some(home)));
    claude_settings(
        &folder,
        r#"{"env":{"ANTHROPIC_AUTH_TOKEN":"sk-secret-1234"}}"#,
    );
    assert!(claude_uses_gateway(&nothing, Some(home)));
    claude_settings(&folder, r#"{"apiKeyHelper":"~/bin/gateway-key.sh"}"#);
    assert!(claude_uses_gateway(&nothing, Some(home)));
    claude_settings(
        &folder,
        r#"{"model":"opus","env":{"ANTHROPIC_MODEL":"opus"}}"#,
    );
    assert!(!claude_uses_gateway(&nothing, Some(home)));
    claude_settings(&folder, "{ not json");
    assert!(!claude_uses_gateway(&nothing, Some(home)));

    let custom = home.join("claude-config");
    claude_settings(
        &custom,
        r#"{"env":{"ANTHROPIC_BASE_URL":"https://api.z.ai/api/anthropic"}}"#,
    );
    let config_dir = {
        let custom = custom.clone();
        move |key: &str| (key == "CLAUDE_CONFIG_DIR").then(|| custom.clone().into_os_string())
    };
    assert!(claude_uses_gateway(&config_dir, Some(home)));

    let padded = format!(
        r#"{{"env":{{"ANTHROPIC_BASE_URL":"https://gateway.test"}},"padding":"{}"}}"#,
        "x".repeat(CLAUDE_SETTINGS_LIMIT as usize)
    );
    claude_settings(&custom, &padded);
    assert!(
        !claude_uses_gateway(&config_dir, Some(home)),
        "an oversized settings file is not read"
    );
}

#[test]
fn the_claude_gateway_hint_names_the_variables_and_never_their_values() {
    let claude = builtin("claude");
    let gateway = crate::app_error::english_error(&sign_in_hint(&claude, None, true));
    assert_eq!(
        gateway,
        "Claude Code uses a custom API endpoint. Check ANTHROPIC_BASE_URL and ANTHROPIC_AUTH_TOKEN in your shell profile or Claude Code's settings.json, then reconnect."
    );
    assert!(!gateway.contains("auth login"));
    assert!(sign_in_hint(&claude, None, false).contains("claude auth login"));
    assert_eq!(
        sign_in_hint(&builtin("codex"), None, true),
        sign_in_hint(&builtin("codex"), None, false),
        "only Claude Code reads the Anthropic gateway settings"
    );
}

#[test]
fn hermes_reports_its_version_through_acp_without_the_update_check() {
    assert_eq!(vendor("hermes").version_args, ["acp", "--version"]);
    for id in [
        "claude", "codex", "gemini", "pi", "opencode", "deepseek", "kimi",
    ] {
        assert_eq!(vendor(id).version_args, ["--version"], "{id}");
    }
    assert_eq!(parse_cli_version("0.20.5\n").as_deref(), Some("0.20.5"));
    assert_eq!(
        parse_cli_version("Hermes Agent v0.20.5 (2026.8.19) · upstream bc47fcd3\n").as_deref(),
        Some("0.20.5")
    );
}

#[tokio::test]
async fn the_version_probe_runs_the_arguments_the_vendor_names() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("acp");
    let env = locator::child_env(&[], &[]);
    let hermes = version_probe_cli(
        temp.path(),
        "hermes",
        r#"if [ "$1 $2" = "acp --version" ]; then echo 0.20.5; exit 0; fi; sleep 20"#,
        "if \"%~1 %~2\"==\"acp --version\" (echo 0.20.5& exit /b 0)\r\nping -n 21 127.0.0.1 >nul",
    );
    let name = hermes
        .path
        .file_name()
        .unwrap()
        .to_string_lossy()
        .into_owned();
    let version = program_version(
        &root,
        &hermes,
        vendor("hermes").version_args,
        &env,
        Duration::from_secs(10),
    )
    .await
    .unwrap();
    assert_eq!(version, "0.20.5");
    let error = program_version(
        &root,
        &hermes,
        &["--version"],
        &env,
        Duration::from_millis(500),
    )
    .await
    .unwrap_err();
    assert!(error.contains(&format!("{name} --version")), "{error}");
    let silent = version_probe_cli(temp.path(), "quiet-hermes", "exit 3", "exit /b 3");
    let name = silent
        .path
        .file_name()
        .unwrap()
        .to_string_lossy()
        .into_owned();
    let error = program_version(
        &root,
        &silent,
        &["acp", "--version"],
        &env,
        Duration::from_secs(10),
    )
    .await
    .unwrap_err();
    assert!(error.contains(&format!("{name} acp --version")), "{error}");
}

#[test]
fn npm_versions_compare_by_release_then_prerelease() {
    for (found, pinned, older) in [
        ("0.0.20", "0.0.34", true),
        ("0.0.28", "0.0.34", true),
        ("0.0.34", "0.0.34", false),
        ("0.0.35", "0.0.34", false),
        ("0.0.34-rc.1", "0.0.34", true),
        ("0.0.34", "0.0.34-rc.1", false),
        ("0.93.0", "0.95.0", true),
        ("1.0.0", "0.95.0", false),
        ("0.100.0", "0.95.0", false),
        ("not-a-version", "0.0.34", false),
        ("", "0.0.34", false),
    ] {
        assert_eq!(
            older_npm_version(found, pinned),
            older,
            "{found} < {pinned}"
        );
    }
}

fn global_bridge(prefix: &Path, name: &str, version: &str) -> PathBuf {
    let root = prefix.join("lib").join("node_modules");
    let package = root.join(name);
    std::fs::create_dir_all(package.join("dist")).unwrap();
    std::fs::write(
        package.join("package.json"),
        format!(r#"{{"name":"{name}","version":"{version}","bin":{{"{name}":"dist/index.js"}}}}"#),
    )
    .unwrap();
    std::fs::write(
        package.join("dist").join("package.json"),
        r#"{"type":"module"}"#,
    )
    .unwrap();
    std::fs::write(
        package.join("dist").join("index.js"),
        "#!/usr/bin/env node\n",
    )
    .unwrap();
    root
}

#[test]
fn a_global_pi_bridge_older_than_the_pin_is_not_used_and_the_managed_install_is_offered() {
    let temp = tempfile::tempdir().unwrap();
    let pi = builtin("pi");
    let node = temp.path().join("node");
    let old = global_bridge(&temp.path().join("old"), "pi-acp", "0.0.20");
    let launch = existing_npm_launch_in(&pi, &[], Some(&node), vec![old]).unwrap();
    assert_eq!(launch.version.as_deref(), Some("0.0.20"));
    let error = current_bridge(&pi, [launch]).unwrap_err();
    assert_eq!(
        crate::app_error::code(&error).as_deref(),
        Some("acp.start.bridge_outdated")
    );
    assert_eq!(
        crate::app_error::english_error(&error),
        "pi-acp 0.0.20 on this computer is too old. Oleafly needs 0.0.34 or newer. Install the bridge in Settings."
    );

    let fresh = global_bridge(&temp.path().join("fresh"), "pi-acp", "0.0.34");
    let current = existing_npm_launch_in(&pi, &[], Some(&node), vec![fresh]).unwrap();
    let old_again = global_bridge(&temp.path().join("old-again"), "pi-acp", "0.0.20");
    let stale = existing_npm_launch_in(&pi, &[], Some(&node), vec![old_again]).unwrap();
    let chosen = current_bridge(&pi, [stale, current.clone()]).unwrap();
    assert_eq!(
        chosen.entry, current.entry,
        "a current copy further on is used"
    );

    let unknown = Launch {
        version: None,
        ..current.clone()
    };
    assert!(
        current_bridge(&pi, [unknown]).is_ok(),
        "a bridge whose version can't be read is still used"
    );
    assert_eq!(
        crate::app_error::english_error(&current_bridge(&pi, []).unwrap_err()),
        "This agent isn't installed yet. Install it, or choose its program in Settings."
    );
    let gemini = Launch {
        version: Some("0.50.0".into()),
        ..current
    };
    assert!(
        current_bridge(&builtin("gemini"), [gemini]).is_ok(),
        "Gemini's bridge is the user's own CLI"
    );
}

#[cfg(unix)]
#[test]
fn a_bridge_found_by_name_reports_the_version_of_its_package() {
    let temp = tempfile::tempdir().unwrap();
    let prefix = temp.path().join("prefix");
    let root = global_bridge(&prefix, "pi-acp", "0.0.20");
    std::fs::create_dir_all(prefix.join("bin")).unwrap();
    let link = prefix.join("bin").join("pi-acp");
    std::os::unix::fs::symlink(root.join("pi-acp").join("dist").join("index.js"), &link).unwrap();
    let located = Located {
        path: link,
        kind: ProgramKind::Native,
    };
    assert_eq!(
        bridge_package_version("pi-acp", &located).as_deref(),
        Some("0.0.20")
    );
    assert_eq!(bridge_package_version("other-acp", &located), None);
}
