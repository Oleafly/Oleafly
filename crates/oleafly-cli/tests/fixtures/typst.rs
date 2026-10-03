use std::io::Write;
use std::path::PathBuf;

const RECORDED_VARIABLES: [&str; 6] = [
    "TYPST_PACKAGE_PATH",
    "TYPST_PACKAGE_CACHE_PATH",
    "HTTPS_PROXY",
    "NO_PROXY",
    "SOURCE_DATE_EPOCH",
    "GIT_DIR",
];

const HUMAN_ERROR: &str = "error: unknown variable: foo\n  \u{250c}\u{2500} main.typ:3:1\n  \u{2502}\n3 \u{2502} $foo$ and text.\n  \u{2502}  ^^^\n  \u{2502}\n  = hint: if you meant to display multiple letters as is, try adding spaces between each letter: `f o o`\n  = hint: or if you meant to display this as text, try placing it in quotes: `\"foo\"`\n\nwarning: unknown font family: nosuchfont\n  \u{250c}\u{2500} chapters\\intro.typ:1:16\n  \u{2502}\n1 \u{2502} #set text(font: \"NoSuchFont\")\n  \u{2502}                 ^^^^^^^^^^^^\n\n";

fn beside_me(name: &str) -> PathBuf {
    std::env::current_exe().unwrap().with_file_name(name)
}

fn record_environment() {
    let recorded: String = RECORDED_VARIABLES
        .iter()
        .filter_map(|name| {
            std::env::var_os(name).map(|value| format!("{name}={}\n", value.to_string_lossy()))
        })
        .collect();
    std::fs::write(beside_me("fixture-typst-env"), recorded).unwrap();
}

fn main() {
    let arguments: Vec<String> = std::env::args().skip(1).collect();
    let version = std::fs::read_to_string(beside_me("fixture-typst-version"))
        .unwrap()
        .trim()
        .to_string();
    let mut calls = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(beside_me("fixture-typst-calls"))
        .unwrap();
    writeln!(calls, "{}", arguments.join(" ")).unwrap();
    if arguments.iter().any(|argument| argument == "--version") {
        println!("typst {version} (fixture)");
        return;
    }
    record_environment();
    let compile = arguments
        .iter()
        .position(|argument| argument == "compile")
        .unwrap();
    let source = std::fs::read_to_string(&arguments[compile + 1]).unwrap_or_default();
    if source.contains("fixture-human-error") {
        eprint!("{HUMAN_ERROR}");
        std::process::exit(1);
    }
    let output = PathBuf::from(&arguments[compile + 2]);
    std::fs::create_dir_all(output.parent().unwrap()).unwrap();
    std::fs::write(&output, b"%PDF-1.7\nfixture\n").unwrap();
    println!("typst-fixture-ok:{version}:{}", arguments.join(" "));
}
