use std::path::Path;
use std::process::Command;

#[test]
fn oleafly_ot_has_no_loro_dependency() {
    let cargo = std::env::var("CARGO").unwrap_or_else(|_| "cargo".to_owned());
    let workspace = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let output = Command::new(cargo)
        .current_dir(workspace)
        .args([
            "tree",
            "--offline",
            "--package",
            "oleafly-ot",
            "--edges",
            "normal",
            "--target",
            "all",
            "--prefix",
            "none",
            "--format",
            "{p}",
        ])
        .output()
        .expect("cargo tree runs");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let tree = String::from_utf8_lossy(&output.stdout);
    assert!(
        tree.lines().any(|line| line.starts_with("oleafly-ot ")),
        "{tree}"
    );
    let loro: Vec<&str> = tree
        .lines()
        .filter(|line| line.starts_with("loro"))
        .collect();
    assert!(loro.is_empty(), "oleafly-ot depends on {loro:?}");
}
