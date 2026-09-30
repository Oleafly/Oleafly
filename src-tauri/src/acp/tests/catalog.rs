use super::*;
use crate::acp::types::BinaryDistribution;
use crate::program_locator::{Located, ProgramKind};
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
            Some(&installed("opencode", "opencode auth login"))
        ),
        "Run opencode auth login in your terminal, then reconnect."
    );
    assert_eq!(
        sign_in_hint(
            &by_id("pi"),
            Some(&installed("pi", r"& 'D:\Tools\Agents\Pi\pi.cmd'"))
        ),
        r"Run & 'D:\Tools\Agents\Pi\pi.cmd' in your terminal and sign in with /login, then reconnect."
    );
    assert_eq!(
        sign_in_hint(&by_id("pi"), None),
        "Run pi in your terminal and sign in with /login, then reconnect."
    );
    assert_eq!(
        sign_in_hint(&by_id("kimi"), None),
        "Install Kimi Code, run kimi login in your terminal, then reconnect."
    );
    assert!(sign_in_hint(&by_id("deepseek"), None).contains("DEEPSEEK_API_KEY"));
    assert!(sign_in_hint(&by_id("pi"), None).contains("/login"));
    assert!(sign_in_hint(&by_id("gemini"), None).contains("workspace trust"));
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
    assert!(missing.reason.unwrap().contains("isn't installed"));
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
    let output = bounded_command(command, Duration::from_secs(5))
        .await
        .unwrap();
    assert_eq!(output, "x".repeat(64 * 1024));

    let mut command = tokio::process::Command::new(&python);
    command.args([
        "-c",
        "import sys; sys.stdout.write('npm notice line\\n'); sys.stderr.write('npm error code E404\\nnpm error 404 Not Found\\n'); sys.exit(2)",
    ]);
    let error = bounded_command(command, Duration::from_secs(5))
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
    let silent = bounded_command(command, Duration::from_secs(5))
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
        std::fs::write(&path, format!("#!/bin/sh\n{unix}\n")).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).unwrap();
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
    let error = program_version(&root, &silent, &env, Duration::from_secs(10))
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
    let error = program_version(&root, &slow, &env, Duration::from_millis(500))
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
    let error = program_version(&root, &missing, &env, Duration::from_secs(10))
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
    let error = program_version(&root, &loud, &env, Duration::from_secs(10))
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
    assert!(blocked.reason.unwrap().contains("Node.js 999"));
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
    }
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
    assert!(missing.launch.unwrap_err().contains("Choose it again"));
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
    let chosen = temp.path().join("D Tools").join("pi-cli");
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
            overridden: true
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
    let chosen = temp.path().join("pi-cli");
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
