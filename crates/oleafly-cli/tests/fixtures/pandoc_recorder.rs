use std::path::PathBuf;

fn main() {
    let output = std::env::args()
        .find_map(|argument| argument.strip_prefix("--output=").map(PathBuf::from))
        .unwrap();
    let cwd = std::env::current_dir().unwrap();
    let mut record = format!("cwd={}\n", cwd.display());
    for name in ["TMP", "TEMP", "TMPDIR"] {
        let value = std::env::var(name).unwrap_or_default();
        let exists = !value.is_empty() && PathBuf::from(&value).is_dir();
        record.push_str(&format!("{name}={value}\n{name}_EXISTS={exists}\n"));
    }
    let tmp = std::env::var_os("TMP")
        .map(PathBuf::from)
        .unwrap_or_default();
    let cwd_is_tmp = matches!(
        (cwd.canonicalize(), tmp.canonicalize()),
        (Ok(cwd), Ok(tmp)) if cwd == tmp
    );
    record.push_str(&format!("cwd_is_tmp={cwd_is_tmp}\n"));
    let defaults = std::env::args().nth(1).unwrap_or_default();
    let defaults = defaults.strip_prefix("--defaults=").unwrap_or_default();
    record.push_str(&format!(
        "defaults={}\nresource_path={}\n",
        std::fs::read_to_string(defaults).unwrap_or_default(),
        std::env::var("OLEAFLY_PANDOC_RESOURCE_PATH").unwrap_or_default()
    ));
    let executable = std::env::current_exe().unwrap();
    std::fs::write(executable.with_extension("record"), record).unwrap();
    std::fs::write(output, b"%PDF-1.7\nfixture\n").unwrap();
}
