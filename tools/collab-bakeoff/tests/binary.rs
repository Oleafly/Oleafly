use std::fs;
use std::process::Command;

#[test]
fn writes_both_reports_and_fills_the_results_section() {
    let out = std::env::temp_dir().join(format!("collab-bakeoff-{}", std::process::id()));
    fs::create_dir_all(&out).expect("temp dir");
    let decision = out.join("DECISION.md");
    fs::write(
        &decision,
        "# Decision\n\n## Results\n\nold table\n\n## Recommendation\n\nEngine:\n",
    )
    .expect("template");
    let output = Command::new(env!("CARGO_BIN_EXE_collab-bakeoff"))
        .args([
            "--scale",
            "small",
            "--engines",
            "loro",
            "--only",
            "rename_and_edit",
            "--skip-measurements",
            "--out",
        ])
        .arg(&out)
        .arg("--decision")
        .arg(&decision)
        .output()
        .expect("run the binary");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let report = fs::read_to_string(out.join("report.md")).expect("report.md");
    assert!(report.contains("| rename_and_edit | pass |"), "{report}");
    let json = fs::read_to_string(out.join("report.json")).expect("report.json");
    assert!(json.contains("\"rename_and_edit\""), "{json}");
    let filled = fs::read_to_string(&decision).expect("decision");
    assert!(filled.contains("| rename_and_edit | pass |"), "{filled}");
    assert!(
        filled.contains("## Recommendation") && !filled.contains("old table"),
        "{filled}"
    );
    fs::remove_dir_all(&out).expect("clean up");
}
