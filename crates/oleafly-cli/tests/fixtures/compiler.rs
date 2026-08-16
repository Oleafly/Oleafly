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
        .or_else(|| {
            arguments.iter().find_map(|argument| {
                argument
                    .to_str()
                    .and_then(|argument| argument.strip_prefix("-outdir="))
                    .map(PathBuf::from)
            })
        })
        .unwrap();
    let source = arguments
        .last()
        .map(PathBuf::from)
        .unwrap();
    let output_stem = arguments
        .iter()
        .find_map(|argument| {
            argument
                .to_str()
                .and_then(|argument| argument.strip_prefix("-jobname="))
                .map(OsString::from)
        })
        .or_else(|| source.file_stem().map(ToOwned::to_owned))
        .unwrap();
    std::fs::create_dir_all(&outdir).unwrap();
    std::fs::write(
        outdir.join(output_stem).with_extension("pdf"),
        b"%PDF-1.7\nfixture\n",
    )
    .unwrap();
    println!("fixture-ok:{}", source.display());
}

#[cfg(not(fixture_failure))]
use std::ffi::OsString;
#[cfg(not(fixture_failure))]
use std::path::PathBuf;
