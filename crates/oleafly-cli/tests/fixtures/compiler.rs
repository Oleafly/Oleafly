// A stand-in for tectonic and latexmk. Switches (environment):
// FIXTURE_SLEEP_MS     wait this long before finishing
// FIXTURE_LOG_LINES    print this many log lines
// FIXTURE_BUNDLE_FAIL  fail like a bundle download while `--bundle` is given
// FIXTURE_RECORD       append the arguments (and a few variables) to <exe>.calls
// FIXTURE_TEX_LOG      copy this file to <outdir>/<stem>.log
// A source containing `fixture-partial-pdf` ends like latexmk -f after a TeX
// error: a partial PDF is written and the exit code is 12.
use std::ffi::OsString;
use std::path::PathBuf;

const IMAGE_FAILURE_MARKER: &str = "fixture-libpng-error";
const PARTIAL_PDF_MARKER: &str = "fixture-partial-pdf";
const ENTRY_PREFIX: &str = "\\ifdefined\\pdfglyphtounicode";

fn arguments() -> Vec<OsString> {
    std::env::args_os().skip(1).collect()
}

/// The document the build is for: the main document named by Oleafly's
/// entry shim, or the last argument.
fn source() -> Option<PathBuf> {
    let last = PathBuf::from(arguments().last()?);
    let text = std::fs::read_to_string(&last).ok();
    if let Some(text) = text.filter(|text| text.starts_with(ENTRY_PREFIX)) {
        let start = text.find("\\detokenize{")? + "\\detokenize{".len();
        let end = start + text[start..].find('}')?;
        return Some(PathBuf::from(&text[start..end]));
    }
    Some(last)
}

fn source_contains(marker: &str) -> bool {
    source()
        .and_then(|source| std::fs::read_to_string(source).ok())
        .is_some_and(|text| text.contains(marker))
}

fn reports_an_image_failure() -> bool {
    source_contains(IMAGE_FAILURE_MARKER)
}

fn print_version() -> bool {
    let first = arguments().into_iter().next();
    if !matches!(first.as_deref().and_then(|value| value.to_str()), Some("--version" | "-v")) {
        return false;
    }
    let stem = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.file_stem().map(|stem| stem.to_string_lossy().into_owned()))
        .unwrap_or_default();
    if stem.contains("latexmk") {
        println!("Latexmk, John Collins, 7 Jan. 2025. Version 4.86a");
    } else {
        println!("Tectonic 0.15.0");
    }
    true
}

fn record() {
    if std::env::var_os("FIXTURE_RECORD").is_none() {
        return;
    }
    use std::io::Write;
    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    let mut fields: Vec<String> = arguments().iter().map(|argument| argument.to_string_lossy().into_owned()).collect();
    for name in ["PAR_GLOBAL_TMPDIR", "TEXMFOUTPUT", "openin_any"] {
        fields.push(format!("{name}={}", std::env::var(name).unwrap_or_default()));
    }
    let calls = exe.with_extension("calls");
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(calls) {
        let _ = writeln!(file, "{}", fields.join("\u{1f}"));
    }
}

fn common() {
    record();
    if let Some(milliseconds) = std::env::var("FIXTURE_SLEEP_MS").ok().and_then(|value| value.parse().ok()) {
        std::thread::sleep(std::time::Duration::from_millis(milliseconds));
    }
    if let Some(lines) = std::env::var("FIXTURE_LOG_LINES").ok().and_then(|value| value.parse::<usize>().ok()) {
        for index in 0..lines {
            println!("fixture log line {index}");
        }
    }
    if std::env::var_os("FIXTURE_BUNDLE_FAIL").is_some() && arguments().iter().any(|argument| argument == "--bundle") {
        eprintln!("error: this bundle isn't cached, and we couldn't get it from the internet");
        std::process::exit(1);
    }
}

#[cfg(fixture_failure)]
fn main() {
    if print_version() {
        return;
    }
    common();
    if reports_an_image_failure() {
        eprintln!("(ts1cmr.fd)libpng error: IHDR: CRC error");
        std::process::exit(1);
    }
    eprintln!("! Fixture failure");
    std::process::exit(7);
}

#[cfg(not(fixture_failure))]
fn main() {
    if print_version() {
        return;
    }
    common();
    let arguments = arguments();
    let outdir = arguments
        .windows(2)
        .find(|pair| pair[0] == "--outdir")
        .map(|pair| PathBuf::from(&pair[1]))
        .or_else(|| {
            arguments.iter().find_map(|argument| {
                argument
                    .to_str()
                    .and_then(|argument| argument.strip_prefix("-outdir="))
                    .map(PathBuf::from)
            })
        })
        .unwrap();
    let last = arguments.last().map(PathBuf::from).unwrap();
    let output_stem = arguments
        .iter()
        .find_map(|argument| {
            argument
                .to_str()
                .and_then(|argument| argument.strip_prefix("-jobname="))
                .map(OsString::from)
        })
        .or_else(|| last.file_stem().map(ToOwned::to_owned))
        .unwrap();
    std::fs::create_dir_all(&outdir).unwrap();
    if source_contains(PARTIAL_PDF_MARKER) {
        std::fs::write(outdir.join(&output_stem).with_extension("pdf"), b"%PDF-1.7\npartial\n").unwrap();
        eprintln!("! Fixture failure");
        std::process::exit(12);
    }
    std::fs::write(outdir.join(&output_stem).with_extension("pdf"), b"%PDF-1.7\nfixture\n").unwrap();
    if let Some(log) = std::env::var_os("FIXTURE_TEX_LOG") {
        std::fs::copy(log, outdir.join(&output_stem).with_extension("log")).unwrap();
    }
    println!("fixture-ok:{}", source().unwrap_or(last).display());
    if reports_an_image_failure() {
        eprintln!("libpng error: IHDR: CRC error");
    }
}
