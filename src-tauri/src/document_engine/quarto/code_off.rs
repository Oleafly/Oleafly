use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};

use serde_norway::Value;

use super::{chunk_opener, inline_knitr, project_directories, source_text, EXTENSIONS_DIRECTORY};
use super::{SOURCE_LIMIT, YAML_LIMIT};

type Verdict = Result<(), &'static str>;

const MAX_FILES: usize = 64;
const MAX_DEPTH: usize = 8;
const ENVIRONMENT_PREFIX: &str = "_environment";
const PROJECT_FILE_PREFIXES: [&str; 2] = ["_quarto", "_metadata"];
const QUARTO_PROJECT_FILES: [&str; 2] = ["_quarto.yml", "_quarto.yaml"];
const OPTION_PREFIXES: [&str; 4] = ["#|", "//|", "--|", "%%|"];

const ALLOWED_FILTERS: &[&str] = &["quarto", "citeproc"];
const ALLOWED_PDF_ENGINES: &[&str] = &["pdflatex", "xelatex", "lualatex", "tectonic", "typst"];
const ALLOWED_ENGINE_FLAGS: &[&str] = &[
    "-halt-on-error",
    "--halt-on-error",
    "-file-line-error",
    "--file-line-error",
    "-no-file-line-error",
    "--no-file-line-error",
    "-no-shell-escape",
    "--no-shell-escape",
    "-shell-restricted",
    "--shell-restricted",
    "-8bit",
    "--8bit",
    "-recorder",
    "--recorder",
    "--keep-logs",
    "--keep-intermediates",
];
const ALLOWED_ENGINE_FLAG_PREFIXES: &[&str] =
    &["-interaction=", "--interaction=", "-synctex=", "--synctex="];
const ALLOWED_EXECUTE: &[&str] = &[
    "echo",
    "eval",
    "output",
    "warning",
    "error",
    "include",
    "enabled",
    "cache",
    "freeze",
    "daemon",
    "daemon-restart",
    "debug",
    "keep-md",
    "keep-ipynb",
];
const DOCUMENT_ENGINES: &[&str] = &["markdown", "knitr", "jupyter"];
const KNITR_ENGINES: &[&str] = &[
    "r",
    "python",
    "bash",
    "sh",
    "zsh",
    "sql",
    "stan",
    "c",
    "cc",
    "fortran",
    "fortran95",
    "rcpp",
    "tikz",
    "dot",
    "asy",
    "ditaa",
    "cat",
    "verbatim",
    "asis",
    "block",
    "block2",
    "comment",
    "css",
    "js",
    "sass",
    "scss",
    "bslib",
    "go",
    "highlight",
    "mermaid",
    "ojs",
    "awk",
    "gawk",
    "sed",
    "perl",
    "ruby",
    "node",
    "coffee",
    "groovy",
    "haskell",
    "lein",
    "mysql",
    "psql",
    "octave",
    "php",
    "scala",
    "sas",
    "stata",
    "rscript",
];
const PROGRAM_KEYS: &[&str] = &[
    "shortcodes",
    "pre-render",
    "post-render",
    "ipynb-filters",
    "engines",
    "data-dir",
    "defaults",
    "lua-filter",
    "lua-filters",
    "r-options",
    "r.options",
    "julia",
    "latex-makeindex",
    "latex-makeindex-opt",
    "latex-makeindex-opts",
    "latex-tlmgr-opt",
    "latex-tlmgr-opts",
    "latex-input-paths",
    "engine.opts",
    "engine.path",
    "engine.env",
];
const FILE_KEYS: &[&str] = &[
    "include-in-header",
    "include-before-body",
    "include-after-body",
    "include-before",
    "include-after",
    "template",
    "template-partials",
    "file",
    "child",
];
const METADATA_FILE_KEYS: &[&str] = &["metadata-files", "metadata-file"];
const SHORTCODES: &[&str] = &[
    "include",
    "embed",
    "meta",
    "var",
    "pagebreak",
    "kbd",
    "video",
    "lipsum",
    "placeholder",
    "version",
    "contents",
    "brand",
];

pub(super) fn code_needed(project_dir: &Path, input: &Path) -> bool {
    refusal(project_dir, input).is_err()
}

fn refusal(project_dir: &Path, input: &Path) -> Verdict {
    let root = project_dir
        .canonicalize()
        .unwrap_or_else(|_| project_dir.to_path_buf());
    let Ok(main) = input.canonicalize() else {
        return Ok(());
    };
    if !main.starts_with(&root) {
        return Err("the document is outside the project");
    }
    let main_dir = main
        .parent()
        .map_or_else(|| root.clone(), Path::to_path_buf);
    let quarto_root = quarto_project_dir(&main_dir).unwrap_or_else(|| main_dir.clone());
    let knitr = main
        .extension()
        .and_then(std::ffi::OsStr::to_str)
        .is_some_and(|extension| {
            extension.eq_ignore_ascii_case("rmd") || extension.eq_ignore_ascii_case("rmarkdown")
        });
    let mut scan = Scan {
        root,
        main_dir,
        quarto_root,
        visited: HashSet::new(),
        documents: Vec::new(),
        knitr,
    };
    scan.project_files(&main)?;
    scan.document(&main, 0)?;
    scan.cells()
}

fn quarto_project_dir(start: &Path) -> Option<PathBuf> {
    start.ancestors().find_map(|directory| {
        QUARTO_PROJECT_FILES
            .iter()
            .any(|name| directory.join(name).is_file())
            .then(|| directory.to_path_buf())
    })
}

struct Scan {
    root: PathBuf,
    main_dir: PathBuf,
    quarto_root: PathBuf,
    visited: HashSet<PathBuf>,
    documents: Vec<String>,
    knitr: bool,
}

impl Scan {
    fn project_files(&mut self, main: &Path) -> Verdict {
        for directory in project_directories(&self.root, main) {
            if directory.join(EXTENSIONS_DIRECTORY).exists() {
                return Err("the project has Quarto extensions");
            }
            let Ok(entries) = std::fs::read_dir(&directory) else {
                continue;
            };
            let mut metadata = Vec::new();
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_lowercase();
                if name.starts_with(ENVIRONMENT_PREFIX) {
                    return Err("the project sets environment variables");
                }
                let yaml = name.ends_with(".yml") || name.ends_with(".yaml");
                if yaml
                    && PROJECT_FILE_PREFIXES
                        .iter()
                        .any(|prefix| name.starts_with(prefix))
                {
                    metadata.push(entry.path());
                }
            }
            metadata.sort();
            for path in metadata {
                self.metadata_file(&path, 0)?;
            }
        }
        Ok(())
    }

    fn admit(&mut self, path: &Path, depth: usize) -> Result<Option<PathBuf>, &'static str> {
        if depth > MAX_DEPTH {
            return Err("files are nested too deeply");
        }
        let Ok(real) = path.canonicalize() else {
            return Ok(None);
        };
        if !real.starts_with(&self.root) {
            return Err("a file outside the project is read");
        }
        if !self.visited.insert(real.clone()) {
            return Ok(None);
        }
        if self.visited.len() > MAX_FILES {
            return Err("too many files are read");
        }
        Ok(Some(real))
    }

    fn metadata_file(&mut self, path: &Path, depth: usize) -> Verdict {
        let Some(real) = self.admit(path, depth)? else {
            return Ok(());
        };
        let Some(text) = read_limited(&real, YAML_LIMIT)? else {
            return Ok(());
        };
        let base = real
            .parent()
            .map_or_else(|| self.root.clone(), Path::to_path_buf);
        self.shortcodes(&text, depth)?;
        let value = parse_yaml(&text)?;
        self.walk(&value, &base, depth)
    }

    fn document(&mut self, path: &Path, depth: usize) -> Verdict {
        let Some(real) = self.admit(path, depth)? else {
            return Ok(());
        };
        let Some(text) = read_limited(&real, SOURCE_LIMIT)? else {
            return Ok(());
        };
        let base = real
            .parent()
            .map_or_else(|| self.root.clone(), Path::to_path_buf);
        let blocks = yaml_blocks(&text);
        for block in &blocks {
            let value = parse_yaml(block)?;
            self.walk(&value, &base, depth)?;
        }
        if let Ok(merged) = serde_norway::from_str::<Value>(&blocks.join("\n")) {
            self.walk(&merged, &base, depth)?;
        }
        if inline_knitr(&text) {
            return Err("the document has inline R code");
        }
        self.shortcodes(&text, depth)?;
        self.documents.push(text);
        Ok(())
    }

    fn shortcodes(&mut self, text: &str, depth: usize) -> Verdict {
        let mut search = 0;
        while let Some(found) = text[search..].find("{{<") {
            let start = search + found;
            let body_start = start + 3;
            let Some(length) = text[body_start..].find(">}}") else {
                break;
            };
            search = body_start;
            let body = text[body_start..body_start + length].trim();
            if text[..start].ends_with('{') || body.starts_with("/*") {
                continue;
            }
            let params = shortcode_params(body);
            let Some(name) = params.first().map(|name| name.to_lowercase()) else {
                continue;
            };
            if !SHORTCODES.contains(&name.as_str()) {
                return Err("the document uses a shortcode that is not built into Quarto");
            }
            let target = params.get(1).map(String::as_str).unwrap_or_default();
            match name.as_str() {
                "include" => {
                    let path = self.quarto_resolve(target)?;
                    self.document(&path, depth + 1)?;
                }
                "embed" => {
                    let file = target.split('#').next().unwrap_or_default();
                    let path = self.quarto_resolve(file)?;
                    if is_markdown_notebook(&path) {
                        self.document(&path, depth + 1)?;
                    }
                }
                _ => {}
            }
        }
        Ok(())
    }

    fn quarto_resolve(&self, raw: &str) -> Result<PathBuf, &'static str> {
        let raw = plain_path(raw)?;
        let path = match raw.strip_prefix('/') {
            Some(rooted) => lexical_join(&self.quarto_root, rooted),
            None => lexical_join(&self.main_dir, raw),
        };
        self.confined(&path)
            .then_some(path)
            .ok_or("a file outside the project is included")
    }

    fn check_path(&self, raw: &str, base: &Path) -> Verdict {
        let raw = plain_path(raw)?;
        if raw.is_empty() {
            return Ok(());
        }
        let mut candidates = vec![lexical_join(base, raw), lexical_join(&self.main_dir, raw)];
        if let Some(rooted) = raw.strip_prefix('/') {
            candidates.push(lexical_join(&self.quarto_root, rooted));
        }
        if candidates.iter().all(|path| self.confined(path)) {
            Ok(())
        } else {
            Err("a file outside the project is read")
        }
    }

    fn confined(&self, path: &Path) -> bool {
        match path.canonicalize() {
            Ok(real) => real.starts_with(&self.root),
            Err(_) => path.starts_with(&self.root),
        }
    }

    fn walk(&mut self, value: &Value, base: &Path, depth: usize) -> Verdict {
        match value {
            Value::Tagged(_) => Err("the metadata has a tagged value"),
            Value::Sequence(items) => items
                .iter()
                .try_for_each(|item| self.walk(item, base, depth)),
            Value::Mapping(entries) => {
                for (key, value) in entries {
                    match key {
                        Value::String(name) => {
                            self.entry(&name.trim().to_lowercase(), value, base, depth)?
                        }
                        Value::Tagged(_) => return Err("the metadata has a tagged key"),
                        other => {
                            self.walk(other, base, depth)?;
                            self.walk(value, base, depth)?;
                        }
                    }
                }
                Ok(())
            }
            _ => Ok(()),
        }
    }

    fn entry(&mut self, name: &str, value: &Value, base: &Path, depth: usize) -> Verdict {
        if name == "knitr" {
            self.knitr = true;
        }
        if blank(value) {
            return Ok(());
        }
        match name {
            "filters" => allowed_strings(value, ALLOWED_FILTERS, "the metadata adds a filter"),
            "pdf-engine" => allowed_strings(
                value,
                ALLOWED_PDF_ENGINES,
                "the metadata picks a PDF engine Oleafly does not allow with code off",
            ),
            "pdf-engine-opt" | "pdf-engine-opts" => {
                let options =
                    strings(value).ok_or("the metadata passes options to the PDF engine")?;
                options
                    .iter()
                    .all(|option| allowed_engine_flag(option))
                    .then_some(())
                    .ok_or("the metadata passes options to the PDF engine")
            }
            "engine" => {
                let engine = value.as_str().map(str::to_lowercase).unwrap_or_default();
                if engine == "knitr" {
                    self.knitr = true;
                }
                (DOCUMENT_ENGINES.contains(&engine.as_str())
                    || KNITR_ENGINES.contains(&engine.as_str()))
                .then_some(())
                .ok_or("the metadata picks an engine that runs code")
            }
            "execute" => self.execute(value, base, depth),
            _ if PROGRAM_KEYS.contains(&name) => Err("the metadata runs a program"),
            _ if METADATA_FILE_KEYS.contains(&name) => {
                let files = strings(value).ok_or("the metadata merges files")?;
                for file in files {
                    self.check_path(file, base)?;
                    self.metadata_file(&lexical_join(base, plain_path(file)?), depth + 1)?;
                }
                Ok(())
            }
            _ if FILE_KEYS.contains(&name) => self.paths(value, base, depth),
            _ => self.walk(value, base, depth),
        }
    }

    fn execute(&mut self, value: &Value, base: &Path, depth: usize) -> Verdict {
        match value {
            Value::Bool(false) => Ok(()),
            Value::Mapping(entries) => {
                for (key, value) in entries {
                    let name = key
                        .as_str()
                        .map(|name| name.trim().to_lowercase())
                        .ok_or("the metadata changes how code runs")?;
                    if !ALLOWED_EXECUTE.contains(&name.as_str())
                        || (name == "enabled" && !matches!(value, Value::Bool(false) | Value::Null))
                    {
                        return Err("the metadata changes how code runs");
                    }
                    self.walk(value, base, depth)?;
                }
                Ok(())
            }
            _ => Err("the metadata changes how code runs"),
        }
    }

    fn paths(&mut self, value: &Value, base: &Path, depth: usize) -> Verdict {
        match value {
            Value::String(path) => self.check_path(path, base),
            Value::Sequence(items) => items
                .iter()
                .try_for_each(|item| self.paths(item, base, depth)),
            Value::Mapping(_) => self.walk(value, base, depth),
            Value::Tagged(_) => Err("the metadata has a tagged value"),
            _ => Ok(()),
        }
    }

    fn cells(&mut self) -> Verdict {
        let documents = std::mem::take(&mut self.documents);
        if !self.knitr {
            self.knitr = documents
                .iter()
                .any(|text| cells(text).any(|cell| cell.language.eq_ignore_ascii_case("r")));
        }
        for text in &documents {
            for cell in cells(text) {
                self.cell(&cell)?;
            }
        }
        Ok(())
    }

    fn cell(&mut self, cell: &Cell<'_>) -> Verdict {
        let main_dir = self.main_dir.clone();
        if self.knitr {
            let language = cell.language.to_lowercase();
            if !KNITR_ENGINES.contains(&language.as_str()) {
                return Err("a code chunk uses an engine that runs code by itself");
            }
            for file in r_options(cell.header, true)? {
                self.check_path(&file, &main_dir)?;
            }
        }
        if cell.options.is_empty() {
            return Ok(());
        }
        match serde_norway::from_str::<Value>(&cell.options.join("\n")) {
            Ok(value @ Value::Mapping(_)) => self.walk(&value, &main_dir, 0),
            _ if self.knitr => {
                for line in &cell.options {
                    for file in r_options(line, false)? {
                        self.check_path(&file, &main_dir)?;
                    }
                }
                Ok(())
            }
            _ => Ok(()),
        }
    }
}

fn blank(value: &Value) -> bool {
    match value {
        Value::Null => true,
        Value::String(text) => text.trim().is_empty(),
        Value::Sequence(items) => items.is_empty(),
        Value::Mapping(entries) => entries.is_empty(),
        _ => false,
    }
}

fn strings(value: &Value) -> Option<Vec<&str>> {
    match value {
        Value::String(text) => Some(vec![text.as_str()]),
        Value::Sequence(items) => items.iter().map(Value::as_str).collect(),
        _ => None,
    }
}

fn allowed_strings(value: &Value, allowed: &[&str], refusal: &'static str) -> Verdict {
    strings(value)
        .is_some_and(|names| {
            names
                .iter()
                .all(|name| allowed.contains(&name.trim().to_lowercase().as_str()))
        })
        .then_some(())
        .ok_or(refusal)
}

fn allowed_engine_flag(option: &str) -> bool {
    let option = option.trim();
    ALLOWED_ENGINE_FLAGS.contains(&option)
        || ALLOWED_ENGINE_FLAG_PREFIXES.iter().any(|prefix| {
            option.strip_prefix(prefix).is_some_and(|rest| {
                !rest.is_empty()
                    && rest
                        .chars()
                        .all(|character| character.is_ascii_alphanumeric() || character == '-')
            })
        })
}

fn plain_path(raw: &str) -> Result<&str, &'static str> {
    let raw = raw.trim();
    if raw.starts_with('~') || raw.contains("://") {
        return Err("a file outside the project is read");
    }
    Ok(raw)
}

fn lexical_join(base: &Path, raw: &str) -> PathBuf {
    let relative = Path::new(raw);
    let mut path = if relative.has_root() || relative.is_absolute() {
        PathBuf::new()
    } else {
        base.to_path_buf()
    };
    for component in relative.components() {
        match component {
            Component::Prefix(_) | Component::RootDir => path.push(component.as_os_str()),
            Component::CurDir => {}
            Component::ParentDir => {
                path.pop();
            }
            Component::Normal(part) => path.push(part),
        }
    }
    path
}

fn is_markdown_notebook(path: &Path) -> bool {
    path.extension()
        .and_then(std::ffi::OsStr::to_str)
        .is_some_and(|extension| {
            ["qmd", "rmd", "md"]
                .iter()
                .any(|known| extension.eq_ignore_ascii_case(known))
        })
}

fn read_limited(path: &Path, limit: u64) -> Result<Option<String>, &'static str> {
    match oleafly_core::read_bounded(path, limit) {
        None => Ok(None),
        Some(read) if !read.complete => Err("a file the document needs is too large to check"),
        Some(read) => Ok(Some(source_text(&read))),
    }
}

fn parse_yaml(text: &str) -> Result<Value, &'static str> {
    serde_norway::from_str::<Value>(text).map_err(|_| "the metadata cannot be read")
}

fn yaml_blocks(text: &str) -> Vec<String> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let lines: Vec<&str> = text.lines().collect();
    let mut blocks = Vec::new();
    let mut index = 0;
    while index < lines.len() {
        let opens = lines[index].trim_end() == "---"
            && lines
                .get(index + 1)
                .is_some_and(|next| !next.trim().is_empty());
        if !opens {
            index += 1;
            continue;
        }
        let body = index + 1;
        let Some(length) = lines[body..]
            .iter()
            .position(|line| matches!(line.trim_end(), "---" | "..."))
        else {
            break;
        };
        blocks.push(lines[body..body + length].join("\n"));
        index = body + length + 1;
    }
    blocks
}

fn shortcode_params(body: &str) -> Vec<String> {
    let mut params = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    for character in body.chars() {
        match quote {
            Some(open) if character == open => quote = None,
            Some(_) => current.push(character),
            None if character == '"' || character == '\'' => quote = Some(character),
            None if character.is_whitespace() => {
                if !current.is_empty() {
                    params.push(std::mem::take(&mut current));
                }
            }
            None => current.push(character),
        }
    }
    if !current.is_empty() {
        params.push(current);
    }
    params
}

struct Cell<'a> {
    language: &'a str,
    header: &'a str,
    options: Vec<&'a str>,
}

fn cells<'a>(text: &'a str) -> impl Iterator<Item = Cell<'a>> + 'a {
    let lines: Vec<&'a str> = text.lines().collect();
    (0..lines.len()).filter_map(move |index| {
        let inner = chunk_opener(lines[index])?;
        let split = inner
            .find(|character: char| !(character.is_ascii_alphanumeric() || character == '_'))
            .unwrap_or(inner.len());
        let options = lines[index + 1..]
            .iter()
            .copied()
            .map_while(|line: &'a str| {
                let trimmed = line.trim_start();
                OPTION_PREFIXES.iter().find_map(|prefix| {
                    trimmed
                        .strip_prefix(prefix)
                        .map(|rest| rest.strip_prefix(' ').unwrap_or(rest))
                })
            })
            .collect();
        Some(Cell {
            language: &inner[..split],
            header: &inner[split..],
            options,
        })
    })
}

fn split_top(text: &str) -> Option<Vec<&str>> {
    let mut parts = Vec::new();
    let mut depth = 0_usize;
    let mut quote: Option<char> = None;
    let mut escaped = false;
    let mut start = 0;
    for (index, character) in text.char_indices() {
        if let Some(open) = quote {
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == open {
                quote = None;
            }
            continue;
        }
        match character {
            '"' | '\'' => quote = Some(character),
            '`' => return None,
            '(' => depth += 1,
            ')' => depth = depth.checked_sub(1)?,
            ',' if depth == 0 => {
                parts.push(&text[start..index]);
                start = index + 1;
            }
            _ => {}
        }
    }
    if quote.is_some() || depth != 0 {
        return None;
    }
    parts.push(&text[start..]);
    Some(parts)
}

fn top_level_equals(part: &str) -> Option<usize> {
    let mut quote: Option<char> = None;
    let mut escaped = false;
    for (index, character) in part.char_indices() {
        if let Some(open) = quote {
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == open {
                quote = None;
            }
            continue;
        }
        match character {
            '"' | '\'' => quote = Some(character),
            '=' => return Some(index),
            _ => {}
        }
    }
    None
}

fn r_options(text: &str, label_allowed: bool) -> Result<Vec<String>, &'static str> {
    const REFUSAL: &str = "a code chunk option is R code";
    let mut files = Vec::new();
    for (position, part) in split_top(text).ok_or(REFUSAL)?.into_iter().enumerate() {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        let Some(at) = top_level_equals(part) else {
            let valid = if position == 0 && label_allowed {
                chunk_label(part)
            } else {
                r_literal(part)
            };
            if !valid {
                return Err(REFUSAL);
            }
            continue;
        };
        let name = part[..at].trim();
        let value = part[at + 1..].trim();
        if !r_identifier(name) || value.starts_with('=') || !r_literal(value) {
            return Err(REFUSAL);
        }
        let name = name.to_lowercase();
        if PROGRAM_KEYS.contains(&name.as_str()) {
            return Err("a code chunk option runs a program");
        }
        if name == "engine" {
            let engine = r_string(value)
                .unwrap_or_else(|| value.to_owned())
                .to_lowercase();
            if !KNITR_ENGINES.contains(&engine.as_str()) {
                return Err("a code chunk uses an engine that runs code by itself");
            }
        }
        if name == "file" || name == "child" {
            files.extend(r_strings(value).ok_or(REFUSAL)?);
        }
    }
    Ok(files)
}

fn chunk_label(text: &str) -> bool {
    text.chars().all(|character| {
        character.is_alphanumeric() || matches!(character, '-' | '_' | '.' | ':' | '/' | ' ')
    })
}

fn r_identifier(text: &str) -> bool {
    let mut characters = text.chars();
    characters
        .next()
        .is_some_and(|first| first.is_ascii_alphabetic() || first == '.')
        && characters
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '.' | '_'))
}

fn r_number(text: &str) -> bool {
    let text = text.strip_prefix(['-', '+']).unwrap_or(text);
    let text = text.strip_suffix(['L', 'i']).unwrap_or(text);
    if let Some(hex) = text.strip_prefix("0x").or_else(|| text.strip_prefix("0X")) {
        return !hex.is_empty() && hex.chars().all(|character| character.is_ascii_hexdigit());
    }
    let (mantissa, exponent) = match text.split_once(['e', 'E']) {
        Some((mantissa, exponent)) => (mantissa, Some(exponent)),
        None => (text, None),
    };
    let digits = mantissa.chars().filter(char::is_ascii_digit).count();
    digits > 0
        && mantissa.matches('.').count() <= 1
        && mantissa
            .chars()
            .all(|character| character.is_ascii_digit() || character == '.')
        && exponent.is_none_or(|exponent| {
            let exponent = exponent.strip_prefix(['-', '+']).unwrap_or(exponent);
            !exponent.is_empty() && exponent.chars().all(|character| character.is_ascii_digit())
        })
}

fn r_string(text: &str) -> Option<String> {
    let quote = text
        .chars()
        .next()
        .filter(|first| *first == '"' || *first == '\'')?;
    let inner = text.strip_prefix(quote)?.strip_suffix(quote)?;
    let mut escaped = false;
    for character in inner.chars() {
        if escaped {
            escaped = false;
        } else if character == '\\' {
            escaped = true;
        } else if character == quote {
            return None;
        }
    }
    (!escaped).then(|| inner.to_owned())
}

fn r_vector(text: &str) -> Option<Vec<&str>> {
    let inner = text.strip_prefix("c(")?.strip_suffix(')')?;
    let parts = split_top(inner)?;
    Some(
        parts
            .into_iter()
            .map(str::trim)
            .filter(|part| !part.is_empty())
            .collect(),
    )
}

fn r_literal(text: &str) -> bool {
    let text = text.trim();
    if let Some(items) = r_vector(text) {
        return items
            .iter()
            .all(|item| r_string(item).is_some() || r_number(item) || r_identifier(item));
    }
    r_string(text).is_some() || r_number(text) || r_identifier(text)
}

fn r_strings(text: &str) -> Option<Vec<String>> {
    let items = r_vector(text).unwrap_or_else(|| vec![text]);
    items
        .into_iter()
        .map(|item| {
            if r_identifier(item) {
                return Some(String::new());
            }
            r_string(item).filter(|path| !path.contains('\\'))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Project {
        _temp: tempfile::TempDir,
        root: PathBuf,
    }

    impl Project {
        fn new() -> Self {
            let temp = tempfile::tempdir().unwrap();
            let root = temp.path().join("project");
            std::fs::create_dir_all(&root).unwrap();
            Self { _temp: temp, root }
        }

        fn outside(&self) -> PathBuf {
            let path = self.root.parent().unwrap().join("secret.txt");
            std::fs::write(&path, "secret").unwrap();
            path
        }

        fn write(&self, name: &str, text: &str) -> PathBuf {
            let path = self.root.join(name);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, text).unwrap();
            path
        }

        fn refusal(&self, source: &str) -> Verdict {
            let input = self.write("main.qmd", source);
            refusal(&self.root, &input)
        }
    }

    fn refused(source: &str) -> bool {
        Project::new().refusal(source).is_err()
    }

    #[test]
    fn plain_documents_and_safe_options_compile_with_code_off() {
        assert_eq!(
            Project::new().refusal(
                "---\ntitle: A\nformat:\n  pdf:\n    pdf-engine: lualatex\n    pdf-engine-opt: -interaction=nonstopmode\nexecute:\n  echo: false\n  enabled: false\njupyter: python3\nfilters: [quarto]\n---\n\n# Body\n\n```{python}\n#| echo: false\nprint(1)\n```\n\n{{< pagebreak >}}\n"
            ),
            Ok(())
        );
        assert_eq!(
            Project::new().refusal(
                "---\nformat: pdf\n---\n\n```{r setup, include=FALSE, fig.cap=\"A, B\", out.width='50%', dev=c('png', \"pdf\"), fig.width=6.5}\nlibrary(x)\n```\n\n```{r}\n#| label: fig-a\n#| echo: false\nplot(1)\n```\n"
            ),
            Ok(())
        );
    }

    #[test]
    fn the_bundled_quarto_templates_compile_with_code_off() {
        let templates = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/templates");
        for (folder, main) in [
            ("quarto-article", "main.qmd"),
            ("quarto-slides", "slides.qmd"),
        ] {
            let project = Project::new();
            for entry in std::fs::read_dir(templates.join(folder)).unwrap() {
                let entry = entry.unwrap();
                std::fs::copy(entry.path(), project.root.join(entry.file_name())).unwrap();
            }
            assert_eq!(
                refusal(&project.root, &project.root.join(main)),
                Ok(()),
                "{folder}"
            );
        }
    }

    #[test]
    fn filters_are_found_in_any_yaml_form() {
        assert!(refused("---\nformat:\n  html: {filters: [x.lua]}\n---\n"));
        assert!(refused("---\n\"\\x66ilters\": [x.lua]\n---\n"));
        assert!(refused(
            "---\nformat:\n  pdf:\n    filters:\n      - path: x.lua\n---\n"
        ));
        assert!(refused("---\nshortcodes: [x.lua]\n---\n"));
        assert!(refused("---\nproject:\n  pre-render: setup.py\n---\n"));
        assert!(refused("---\nFilters: [x.lua]\n---\n"));
        assert!(!refused(
            "---\ntitle: Filters for water\nformat: pdf\n---\n"
        ));
    }

    #[test]
    fn every_metadata_block_counts_not_only_the_first() {
        assert!(refused(
            "---\ntitle: A\n---\n\nText.\n\n---\nformat:\n  html:\n    filters: [x.lua]\n---\n"
        ));
        assert!(refused(
            "---\ntitle: A\n---\n\n```markdown\n---\npdf-engine-opt: -shell-escape\n---\n```\n"
        ));
    }

    #[test]
    fn metadata_that_cannot_be_read_or_carries_tags_is_refused() {
        assert!(refused("---\ntitle: [unclosed\n---\n"));
        assert!(refused("---\nparams:\n  day: !r Sys.Date()\n---\n"));
        assert!(refused("---\n!!str filters: [x.lua]\n---\n"));
    }

    #[test]
    fn engine_options_that_run_programs_are_refused() {
        assert!(refused(
            "---\nformat: pdf\npdf-engine-opt: -shell-escape\n---\n"
        ));
        assert!(refused("---\npdf-engine-opts: [\"-shell-escape\"]\n---\n"));
        assert!(refused(
            "---\npdf-engine-opt: -cnf-line=shell_escape=t\n---\n"
        ));
        assert!(refused("---\npdf-engine: ./bin/xelatex\n---\n"));
        assert!(refused("---\npdf-engine: latexmk\n---\n"));
        assert!(refused("---\nlatex-makeindex: ./evil\n---\n"));
        assert!(refused(
            "---\nlatex-input-paths: [/Users/owner/.ssh]\n---\n"
        ));
        assert!(refused("---\ndata-dir: tools\n---\n"));
        assert!(refused("---\nengine: julia\n---\n"));
        assert!(refused("---\nexecute:\n  enabled: true\n---\n"));
        assert!(refused("---\nexecute:\n  kernel: evil\n---\n"));
        assert!(refused("---\nipynb-filters: [x.py]\n---\n"));
        assert!(refused("---\nr-options:\n  device: evil\n---\n"));
        assert!(!refused("---\nengine: knitr\nexecute: false\n---\n"));
    }

    #[test]
    fn merged_metadata_files_are_checked_and_kept_in_the_project() {
        let project = Project::new();
        project.write("extra.yml", "format:\n  html:\n    filters: [x.lua]\n");
        assert!(project
            .refusal("---\nmetadata-files: [extra.yml]\n---\n")
            .is_err());
        let project = Project::new();
        project.write("extra.yml", "title: Safe\n");
        assert_eq!(
            project.refusal("---\nmetadata-files: [extra.yml]\n---\n"),
            Ok(())
        );
        let project = Project::new();
        project.outside();
        assert!(project
            .refusal("---\nmetadata-files: [../secret.txt]\n---\n")
            .is_err());
        let project = Project::new();
        project.write(
            "_quarto.yml",
            "project:\n  type: default\nmetadata-files: [more.yml]\n",
        );
        project.write("more.yml", "pdf-engine-opt: -shell-escape\n");
        assert!(project.refusal("# Body\n").is_err());
    }

    #[test]
    fn project_files_profiles_and_environment_files_are_checked() {
        let project = Project::new();
        project.write(
            "_quarto-advanced.yml",
            "format:\n  pdf: {pdf-engine-opt: -shell-escape}\n",
        );
        assert!(project.refusal("# Body\n").is_err());
        let project = Project::new();
        project.write("_environment", "shell_escape=t\n");
        assert!(project.refusal("# Body\n").is_err());
        let project = Project::new();
        project.write("chapters/_metadata.yml", "filters: [x.lua]\n");
        let input = project.write("chapters/one.qmd", "# One\n");
        assert!(refusal(&project.root, &input).is_err());
        let project = Project::new();
        std::fs::create_dir(project.root.join("_extensions")).unwrap();
        assert!(project.refusal("# Body\n").is_err());
    }

    #[test]
    fn inline_r_anywhere_in_the_document_or_its_includes_is_refused() {
        assert!(refused("The mean is `r mean(x)`.\n"));
        assert!(refused("```markdown\nThe mean is `r mean(x)`.\n```\n"));
        let project = Project::new();
        project.write("child.qmd", "Result: `r system('id')`\n");
        assert!(project.refusal("{{< include child.qmd >}}\n").is_err());
        let long = format!(
            "{}\nThe mean is `r mean(x)`.\n",
            "x".repeat(5 * 1024 * 1024)
        );
        assert!(refused(&long));
    }

    #[test]
    fn included_files_must_stay_in_the_project() {
        let project = Project::new();
        project.outside();
        assert!(project.refusal("{{< include ../secret.txt >}}\n").is_err());
        assert!(project
            .refusal("---\ninclude-before-body: ../secret.txt\n---\n")
            .is_err());
        let absolute = project.outside();
        let source = format!(
            "---\nformat:\n  pdf:\n    include-in-header:\n      - file: {}\n---\n",
            absolute.display()
        );
        assert!(project.refusal(&source).is_err());
        assert!(project
            .refusal("---\ninclude-after-body: ~/.ssh/id_ed25519\n---\n")
            .is_err());
        let project = Project::new();
        project.write("parts/intro.qmd", "Intro\n");
        project.write("header.tex", "\\usepackage{x}\n");
        assert_eq!(
            project.refusal(
                "---\ninclude-in-header: header.tex\n---\n\n{{< include parts/intro.qmd >}}\n{{< include /parts/intro.qmd >}}\n{{{< include ../secret.txt >}}}\n"
            ),
            Ok(())
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_link_inside_the_project_cannot_reach_outside_it() {
        let project = Project::new();
        let secret = project.outside();
        std::os::unix::fs::symlink(&secret, project.root.join("notes.md")).unwrap();
        assert!(project.refusal("{{< include notes.md >}}\n").is_err());
        assert!(project
            .refusal("---\ninclude-in-header: notes.md\n---\n")
            .is_err());
    }

    #[test]
    fn shortcodes_outside_the_built_in_set_or_reading_the_environment_are_refused() {
        assert!(refused("Key: {{< env AWS_SECRET_ACCESS_KEY >}}\n"));
        assert!(refused("{{< fa star >}}\n"));
        assert!(!refused(
            "{{< meta title >}} {{< var version >}} {{< kbd Ctrl-C >}}\n"
        ));
    }

    #[test]
    fn knitr_chunk_options_must_be_plain_values() {
        assert!(refused("```{r, echo=system('id')}\n1\n```\n"));
        assert!(refused("```{r echo=`system`('id')}\n1\n```\n"));
        assert!(refused("```{r}\n#| echo: !expr system('id')\n1\n```\n"));
        assert!(refused("```{r}\n#| echo = system('id')\n1\n```\n"));
        assert!(refused(
            "```{r}\n1\n```\n\n```{exec}\n#| engine.opts: {command: sh, input: ../../.zshrc}\nid\n```\n"
        ));
        assert!(refused(
            "```{r}\n1\n```\n\n```{embed}\n\"../secret.txt\"\n```\n"
        ));
        assert!(refused("```{r, file='../secret.txt'}\n```\n"));
        assert!(refused("```{r}\n#| file: ../secret.txt\n```\n"));
        assert!(refused(
            "```{r}\n1\n```\n\n```{bash, engine='exec'}\nid\n```\n"
        ));
        assert!(!refused("```{python}\n1\n```\n\n```{julia}\n1\n```\n"));
    }

    #[test]
    fn r_values_are_told_apart_from_r_calls() {
        for literal in [
            "TRUE",
            "F",
            "NULL",
            "6.5",
            "-1e3",
            "2L",
            "'a, b'",
            "\"x\"",
            "c(1, 'a')",
            "fig.x",
        ] {
            assert!(r_literal(literal), "{literal}");
        }
        for call in [
            "system('id')",
            "1 + 1",
            "x$y",
            "paste0('a')",
            "c(system('id'))",
            "r\"(x)\"",
            "'a' 'b'",
        ] {
            assert!(!r_literal(call), "{call}");
        }
        assert_eq!(r_options(" setup, include=FALSE", true), Ok(Vec::new()));
        assert_eq!(
            r_options(" a, child=c('x.Rmd', \"y.Rmd\")", true),
            Ok(vec!["x.Rmd".to_owned(), "y.Rmd".to_owned()])
        );
        assert!(r_options(" a(b)", true).is_err());
        assert!(r_options(" a, engine.opts = 'x'", true).is_err());
    }

    #[test]
    fn yaml_blocks_follow_quarto_not_only_the_first_block() {
        assert_eq!(
            yaml_blocks("---\na: 1\n---\nText\n---\n\nRule\n---\nb: 2\n...\n"),
            vec!["a: 1".to_owned(), "b: 2".to_owned()]
        );
    }
}
