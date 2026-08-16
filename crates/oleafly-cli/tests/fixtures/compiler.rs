#[cfg(fixture_failure)]
fn main() {
    eprintln!("! Fixture failure");
    std::process::exit(7);
}

#[cfg(not(fixture_failure))]
fn main() {
    let arguments = std::env::args_os().skip(1).collect::<Vec<_>>();
    let outdir = arguments
        .windows(2)
        .find(|pair| pair[0] == "--outdir")
        .map(|pair| PathBuf::from(&pair[1]))
        .unwrap();
    let source = arguments
        .last()
        .map(PathBuf::from)
        .and_then(|path| path.file_stem().map(ToOwned::to_owned))
        .unwrap();
    std::fs::write(outdir.join(source).with_extension("pdf"), b"%PDF-1.7\nfixture\n").unwrap();
    println!("fixture-ok");
}

#[cfg(not(fixture_failure))]
use std::path::PathBuf;
