use std::io::Read;
use std::path::{Path, PathBuf};

const TEX_HOSTILE: [char; 9] = ['\\', '#', '%', '^', '{', '}', '~', '&', '$'];

fn fail(message: String) -> ! {
    eprintln!("error: {message}");
    std::process::exit(1);
}

fn command_arguments<'a>(tex: &'a str, command: &str) -> Vec<&'a str> {
    let mut found = Vec::new();
    for (index, _) in tex.match_indices(command) {
        let rest = &tex[index + command.len()..];
        let rest = match rest.strip_prefix('[') {
            Some(options) => match options.find("]{") {
                Some(end) => &options[end + 1..],
                None => fail(format!("unterminated {command} options")),
            },
            None => rest,
        };
        let Some(rest) = rest.strip_prefix('{') else {
            continue;
        };
        let Some(end) = rest.find('}') else {
            fail(format!("unterminated {command} argument"));
        };
        found.push(&rest[..end]);
    }
    found
}

fn locate(name: &str, search: &[PathBuf], extensions: &[&str]) -> Option<PathBuf> {
    extensions.iter().find_map(|extension| {
        let candidate = PathBuf::from(format!("{name}{extension}"));
        if candidate.is_file() {
            return Some(candidate);
        }
        if candidate.is_absolute() {
            return None;
        }
        search
            .iter()
            .map(|directory| directory.join(&candidate))
            .find(|path| path.is_file())
    })
}

fn same(left: &Path, right: &Path) -> bool {
    matches!(
        (left.canonicalize(), right.canonicalize()),
        (Ok(left), Ok(right)) if left == right
    )
}

fn within(path: &Path, directory: &Path) -> bool {
    match (path.canonicalize(), directory.canonicalize()) {
        (Ok(path), Ok(directory)) => path.starts_with(directory),
        _ => false,
    }
}

fn main() {
    let arguments = std::env::args().collect::<Vec<_>>();
    let outdir = arguments
        .windows(2)
        .find(|pair| pair[0] == "--outdir")
        .map(|pair| PathBuf::from(&pair[1]))
        .unwrap();
    let search: Vec<PathBuf> = arguments
        .iter()
        .filter_map(|argument| argument.strip_prefix("-Zsearch-path="))
        .map(PathBuf::from)
        .collect();
    let mut tex = String::new();
    std::io::stdin().read_to_string(&mut tex).unwrap();
    std::fs::write(outdir.join("texput.tex"), &tex).unwrap();
    let cwd = std::env::current_dir().unwrap();
    let tmp = PathBuf::from(std::env::var_os("TMP").unwrap_or_default());
    let mut record = format!(
        "cwd={}\noutdir={}\noutdir_relative={}\ncwd_is_tmp={}\n",
        cwd.display(),
        outdir.display(),
        outdir.is_relative(),
        same(&cwd, &tmp)
    );
    for name in ["TMP", "TEMP", "TMPDIR"] {
        record.push_str(&format!(
            "{name}={}\n",
            std::env::var(name).unwrap_or_default()
        ));
    }
    let mut problems = Vec::new();
    let images = command_arguments(&tex, "\\includegraphics");
    let mut images_in_scratch = 0;
    let mut images_from_search_path = 0;
    for image in &images {
        if image.contains(TEX_HOSTILE) {
            problems.push(format!("TeX cannot read the image path {image}"));
        }
        match locate(image, &search, &[""]) {
            Some(found) if within(&found, &tmp) => images_in_scratch += 1,
            Some(found) if search.iter().any(|directory| within(&found, directory)) => {
                images_from_search_path += 1
            }
            Some(found) => problems.push(format!("image {image} came from {}", found.display())),
            None => problems.push(format!("missing image {image}")),
        }
    }
    let inputs = command_arguments(&tex, "\\input");
    let mut inputs_from_search_path = 0;
    for input in &inputs {
        match locate(input, &search, &["", ".tex"]) {
            Some(found) if search.iter().any(|directory| within(&found, directory)) => {
                inputs_from_search_path += 1
            }
            Some(found) => problems.push(format!("input {input} came from {}", found.display())),
            None => problems.push(format!("missing input {input}")),
        }
    }
    record.push_str(&format!(
        "images={}\nimages_in_scratch={images_in_scratch}\nimages_from_search_path={images_from_search_path}\n",
        images.len()
    ));
    record.push_str(&format!(
        "inputs={}\ninputs_from_search_path={inputs_from_search_path}\n",
        inputs.len()
    ));
    record.push_str(&format!("citation={}\n", tex.contains("KnuthTitle")));
    record.push_str(&format!("csl={}\n", tex.contains("CSLMARK")));
    std::fs::write(
        std::env::current_exe().unwrap().with_extension("record"),
        record,
    )
    .unwrap();
    if !problems.is_empty() {
        fail(problems.join("; "));
    }
    std::fs::write(outdir.join("texput.pdf"), b"%PDF-1.7\nfixture\n").unwrap();
}
