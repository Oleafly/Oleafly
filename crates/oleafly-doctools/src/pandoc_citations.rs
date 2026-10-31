use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

pub const FILTER_NAME: &str = "export-references.lua";
const FILTER: &str = include_str!("../resources/pandoc/export-references.lua");
const DATA_NAME: &str = "export-references.tsv";

const MAX_AUX_FILES: usize = 20;
const MAX_AUX_BYTES: u64 = 1024 * 1024;
const MAX_ENTRY_BYTES: u64 = 64 * 1024;
const MAX_BIBLIOGRAPHIES: usize = 16;
const MAX_BIBLIOGRAPHY_BYTES: u64 = 32 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuxLabel {
    pub number: String,
    pub kind: String,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct AuxRecords {
    pub labels: BTreeMap<String, AuxLabel>,
    pub bibcites: BTreeMap<String, String>,
}

fn balanced_group(text: &str, open: usize) -> Option<(&str, usize)> {
    let bytes = text.as_bytes();
    if bytes.get(open) != Some(&b'{') {
        return None;
    }
    let mut depth = 0_usize;
    let mut index = open;
    while index < bytes.len() {
        match bytes[index] {
            b'\\' => index += 1,
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return Some((&text[open + 1..index], index + 1));
                }
            }
            _ => {}
        }
        index += 1;
    }
    None
}

fn skip_blanks(text: &str, from: usize) -> usize {
    from + text[from..].len() - text[from..].trim_start_matches([' ', '\t']).len()
}

fn groups_after<'a>(line: &'a str, command: &str, count: usize) -> Option<Vec<&'a str>> {
    let rest = line.trim_start().strip_prefix(command)?;
    let offset = line.len() - rest.len();
    let mut position = offset;
    let mut groups = Vec::with_capacity(count);
    for _ in 0..count {
        let (group, end) = balanced_group(line, skip_blanks(line, position))?;
        groups.push(group);
        position = end;
    }
    Some(groups)
}

/// The kind in a hyperref anchor such as `equation.2.1` or `figure.caption.3`.
fn anchor_kind(anchor: &str) -> String {
    let kind = anchor.split('.').next().unwrap_or_default();
    if kind
        .chars()
        .all(|character| character.is_ascii_alphabetic())
    {
        kind.to_ascii_lowercase()
    } else {
        String::new()
    }
}

fn clean_number(number: &str) -> String {
    number
        .trim()
        .trim_start_matches("\\relax")
        .trim()
        .to_string()
}

pub fn parse_aux(text: &str, records: &mut AuxRecords) -> Vec<String> {
    let mut children = Vec::new();
    let mut cleveref_kinds = BTreeMap::new();
    for line in text.lines() {
        if let Some(groups) = groups_after(line, "\\newlabel", 2) {
            let (name, payload) = (groups[0].trim(), groups[1]);
            if name.is_empty() {
                continue;
            }
            if let Some(label) = name.strip_suffix("@cref") {
                // {[equation][1][2]2.1}{...}
                if let Some(kind) = payload
                    .trim_start()
                    .strip_prefix("{[")
                    .and_then(|rest| rest.split(']').next())
                {
                    cleveref_kinds.insert(label.to_string(), kind.to_ascii_lowercase());
                }
                continue;
            }
            let Some((number, end)) = balanced_group(payload, skip_blanks(payload, 0)) else {
                continue;
            };
            let mut rest = Vec::new();
            let mut position = end;
            while let Some((group, next)) = balanced_group(payload, skip_blanks(payload, position))
            {
                rest.push(group);
                position = next;
            }
            let kind = rest
                .get(2)
                .map(|anchor| anchor_kind(anchor))
                .unwrap_or_default();
            records.labels.insert(
                name.to_string(),
                AuxLabel {
                    number: clean_number(number),
                    kind,
                },
            );
        } else if let Some(groups) = groups_after(line, "\\bibcite", 2) {
            let key = groups[0].trim();
            let payload = groups[1].trim();
            // natbib: {{1}{2020}{{Smith}}{{Smith, John}}}
            let label = balanced_group(payload, 0)
                .map(|(first, _)| first)
                .unwrap_or(payload);
            if !key.is_empty() && !label.trim().is_empty() {
                records
                    .bibcites
                    .insert(key.to_string(), clean_number(label));
            }
        } else if let Some(groups) = groups_after(line, "\\@input", 1) {
            children.push(groups[0].trim().to_string());
        }
    }
    for (label, kind) in cleveref_kinds {
        if let Some(entry) = records.labels.get_mut(&label) {
            entry.kind = kind;
        }
    }
    children
}

fn safe_aux_child(name: &str) -> Option<&str> {
    let usable = name.ends_with(".aux")
        && !name.starts_with('/')
        && !name.contains('\\')
        && !name.contains(':')
        && name.split('/').all(|part| !part.is_empty() && part != "..");
    usable.then_some(name)
}

fn read_regular_file(path: &Path, limit: u64) -> Option<String> {
    use std::io::Read as _;
    let metadata = std::fs::symlink_metadata(path).ok()?;
    if !metadata.is_file() {
        return None;
    }
    let mut bytes = Vec::new();
    std::fs::File::open(path)
        .ok()?
        .take(limit)
        .read_to_end(&mut bytes)
        .ok()?;
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

fn aux_belongs_to(build_dir: &Path, main_doc: &str) -> bool {
    let entry = build_dir.join(oleafly_core::engine_spec::ENTRY_TEX);
    match read_regular_file(&entry, MAX_ENTRY_BYTES) {
        Some(text) => text.contains(&format!("\\detokenize{{{main_doc}}}")),
        None => !entry.exists(),
    }
}

pub fn read_aux_records(build_dir: &Path, main_doc: &str) -> AuxRecords {
    let mut records = AuxRecords::default();
    if !aux_belongs_to(build_dir, main_doc) {
        return records;
    }
    let entry = format!("{}.aux", oleafly_core::engine_spec::ENTRY_STEM);
    let mut queue = std::collections::VecDeque::from([entry.clone()]);
    let mut seen = std::collections::HashSet::from([entry]);
    let mut budget = MAX_AUX_BYTES;
    let mut files = 0;
    while let Some(name) = queue.pop_front() {
        if files >= MAX_AUX_FILES || budget == 0 {
            break;
        }
        let Some(text) = read_regular_file(&build_dir.join(&name), budget) else {
            continue;
        };
        files += 1;
        budget = budget.saturating_sub(text.len() as u64);
        let mut found = AuxRecords::default();
        for child in parse_aux(&text, &mut found) {
            if let Some(child) = safe_aux_child(&child) {
                if seen.insert(child.to_string()) {
                    queue.push_back(child.to_string());
                }
            }
        }
        // The first definition wins, as in LaTeX's own lookup.
        for (label, value) in found.labels {
            records.labels.entry(label).or_insert(value);
        }
        for (key, value) in found.bibcites {
            records.bibcites.entry(key).or_insert(value);
        }
    }
    records
}

fn is_bib_file(path: &Path) -> bool {
    path.extension()
        .and_then(std::ffi::OsStr::to_str)
        .is_some_and(|extension| extension.eq_ignore_ascii_case("bib"))
}

fn bib_files_in(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut found: Vec<PathBuf> = entries
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_file()))
        .map(|entry| entry.path())
        .filter(|path| is_bib_file(path) && !path_is_placeholder(path))
        .collect();
    found.sort();
    found
}

pub fn fallback_bibliographies(root: &Path, main_doc: &str) -> Vec<PathBuf> {
    let main_dir = root
        .join(main_doc)
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| root.to_path_buf());
    let mut found = bib_files_in(&main_dir);
    if main_dir != root {
        found.extend(bib_files_in(root));
    }
    found.truncate(MAX_BIBLIOGRAPHIES * 2);
    found
}

fn data_field(value: &str) -> String {
    value.replace(['\t', '\r', '\n'], " ")
}

fn root_relative(root: &Path, path: &Path) -> Option<String> {
    let parts = path
        .strip_prefix(root)
        .ok()?
        .components()
        .map(|component| match component {
            std::path::Component::Normal(part) => part.to_str(),
            _ => None,
        })
        .collect::<Option<Vec<_>>>()?;
    (!parts.is_empty()).then(|| parts.join("/"))
}

fn filter_data(root: &Path, fallback: &[PathBuf], aux: &AuxRecords) -> String {
    let mut data = String::new();
    for path in fallback {
        let Some(path) = root_relative(root, path) else {
            continue;
        };
        if !path.contains(['\t', '\r', '\n']) {
            data.push_str(&format!("bibliography\t{path}\n"));
        }
    }
    for (name, label) in &aux.labels {
        data.push_str(&format!(
            "label\t{}\t{}\t{}\n",
            data_field(name),
            data_field(&label.number),
            data_field(&label.kind)
        ));
    }
    for (key, label) in &aux.bibcites {
        data.push_str(&format!(
            "bibcite\t{}\t{}\n",
            data_field(key),
            data_field(label)
        ));
    }
    data
}

pub fn stage_filter(dir: &Path) -> Result<(), String> {
    std::fs::write(dir.join(FILTER_NAME), FILTER)
        .map_err(|error| format!("Could not prepare the citation filter: {error}"))
}

pub const STAGING_DIR: &str = "export-staging";

const STAGED_PREFIX: &str = "oleafly-export-";

static LIVE_STAGED: std::sync::Mutex<std::collections::BTreeSet<std::ffi::OsString>> =
    std::sync::Mutex::new(std::collections::BTreeSet::new());

fn live_staged() -> std::sync::MutexGuard<'static, std::collections::BTreeSet<std::ffi::OsString>> {
    LIVE_STAGED
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

pub struct ExportFilter {
    dir: Option<tempfile::TempDir>,
    argument: PathBuf,
    live: Option<std::ffi::OsString>,
}

impl ExportFilter {
    pub fn argument(&self) -> &Path {
        &self.argument
    }
}

impl Drop for ExportFilter {
    fn drop(&mut self) {
        // Removal can fail on Windows while a scanner holds a file open; the
        // next export in the project clears what is left.
        drop(self.dir.take());
        if let Some(name) = self.live.take() {
            live_staged().remove(&name);
        }
    }
}

/// Plain ASCII reads the same in every Windows ANSI code page.
fn ascii_path(path: &Path) -> bool {
    path.to_str().is_some_and(str::is_ascii)
}

fn scratch_folder(parent: &Path) -> std::io::Result<tempfile::TempDir> {
    tempfile::Builder::new()
        .prefix(STAGED_PREFIX)
        .tempdir_in(parent)
}

fn same_component(a: std::path::Component<'_>, b: std::path::Component<'_>) -> bool {
    if cfg!(windows) {
        a.as_os_str().eq_ignore_ascii_case(b.as_os_str())
    } else {
        a == b
    }
}

fn lexical_relative(base: &Path, target: &Path) -> Option<PathBuf> {
    use std::path::Component;
    if !base.is_absolute() || !target.is_absolute() {
        return None;
    }
    let base: Vec<Component> = base.components().collect();
    let target: Vec<Component> = target.components().collect();
    let anchor = |parts: &[Component]| {
        parts
            .iter()
            .take_while(|part| matches!(part, Component::Prefix(_) | Component::RootDir))
            .count()
    };
    let shared = base
        .iter()
        .zip(&target)
        .take_while(|(a, b)| same_component(**a, **b))
        .count();
    if shared < anchor(&base) || shared < anchor(&target) {
        return None;
    }
    let mut relative = PathBuf::new();
    for part in &base[shared..] {
        if !matches!(part, Component::Normal(_)) {
            return None;
        }
        relative.push("..");
    }
    for part in &target[shared..] {
        let Component::Normal(name) = part else {
            return None;
        };
        relative.push(name);
    }
    Some(relative)
}

fn relative_to_root(root: &Path, folder: &Path) -> Option<PathBuf> {
    let folder = folder.canonicalize().ok()?;
    // A folder inside the project is the same path down from any spelling
    // of the root (an 8.3 short name, a symlink).
    let inside = root
        .canonicalize()
        .ok()
        .and_then(|root| folder.strip_prefix(root).ok().map(Path::to_path_buf));
    if let Some(inside) = inside {
        return inside.components().next().is_some().then_some(inside);
    }
    // Windows resolves `..` against the spelling of the working folder,
    // which the child gets without a `\\?\` prefix; Unix resolves it on
    // disk, past any symlink.
    let folder = oleafly_core::plain_path(&folder);
    let base = if cfg!(windows) {
        oleafly_core::plain_path(root)
    } else {
        root.canonicalize().ok()?
    };
    lexical_relative(&base, &folder)
}

fn clear_stale_staging(staging: &Path, live: &std::collections::BTreeSet<std::ffi::OsString>) {
    let Ok(entries) = std::fs::read_dir(staging) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let staged = name
            .to_str()
            .is_some_and(|name| name.starts_with(STAGED_PREFIX));
        if !staged || live.contains(&name) {
            continue;
        }
        let path = entry.path();
        let _ = match entry.file_type() {
            Ok(kind) if kind.is_dir() => std::fs::remove_dir_all(&path),
            _ => std::fs::remove_file(&path),
        };
    }
}

fn stage_in_project(root: &Path, staging: &Path) -> Option<ExportFilter> {
    if staging.file_name() != Some(std::ffi::OsStr::new(STAGING_DIR)) {
        return None;
    }
    let mut live = live_staged();
    clear_stale_staging(staging, &live);
    let relative = relative_to_root(root, staging)?;
    let dir = scratch_folder(staging).ok()?;
    let name = dir.path().file_name()?.to_os_string();
    let argument = relative.join(&name).join(FILTER_NAME);
    if !ascii_path(&argument) {
        return None;
    }
    live.insert(name.clone());
    Some(ExportFilter {
        dir: Some(dir),
        argument,
        live: Some(name),
    })
}

fn stage_in_temp(temp: &Path) -> Result<ExportFilter, String> {
    let dir = scratch_folder(temp)
        .map_err(|error| format!("Could not prepare the citation filter: {error}"))?;
    let mut folder = dir.path().to_path_buf();
    if !ascii_path(&folder) {
        if let Some(short) = oleafly_core::short_path_name(&folder)
            .map(|short| oleafly_core::plain_path(&short))
            .filter(|short| ascii_path(short))
        {
            folder = short;
        }
    }
    Ok(ExportFilter {
        dir: Some(dir),
        argument: folder.join(FILTER_NAME),
        live: None,
    })
}

/// Stages the filter and its data for one export.
///
/// Pandoc loads a Lua filter with C `fopen`, which on Windows converts the
/// path to the ANSI code page, so a folder name outside it (a Japanese
/// profile name on an English system) cannot be opened. The filter goes in
/// `staging`, the project's data area, and pandoc gets a relative path: the
/// C library resolves it against pandoc's working directory, the project
/// root, which Windows keeps in UTF-16. When that path would not be plain
/// ASCII (a linked folder on another drive), or there is no staging folder,
/// the filter goes in `temp` by its full path.
pub fn prepare_export_filter(
    root: &Path,
    main_doc: &str,
    build_dir: Option<&Path>,
    staging: Option<&Path>,
    temp: &Path,
) -> Result<ExportFilter, String> {
    let aux = build_dir
        .map(|build| read_aux_records(build, main_doc))
        .unwrap_or_default();
    let data = filter_data(root, &fallback_bibliographies(root, main_doc), &aux);
    if let Some(filter) = staging.and_then(|staging| stage_in_project(root, staging)) {
        // A link or junction on the way can make the relative path lead
        // elsewhere; pandoc must find the filter where it was written.
        let found = write_staged(&filter, &data).is_ok()
            && oleafly_core::plain_path(root)
                .join(filter.argument())
                .is_file();
        if found {
            return Ok(filter);
        }
    }
    let filter = stage_in_temp(temp)?;
    write_staged(&filter, &data)?;
    Ok(filter)
}

fn write_staged(filter: &ExportFilter, data: &str) -> Result<(), String> {
    let dir = filter
        .dir
        .as_ref()
        .ok_or("Could not prepare the citation filter")?
        .path();
    stage_filter(dir)?;
    std::fs::write(dir.join(DATA_NAME), data)
        .map_err(|error| format!("Could not prepare the citation filter: {error}"))
}

pub fn export_failure(log: &str, root: &Path) -> crate::DocError {
    const MARKER: &str = "Error reading bibliography file ";
    let Some(at) = log.find(MARKER) else {
        return crate::DocError::new("export.failed", format!("pandoc failed: {}", log.trim()));
    };
    let rest = &log[at + MARKER.len()..];
    let (first, remainder) = rest.split_once('\n').unwrap_or((rest, ""));
    let path = Path::new(first.trim().trim_end_matches(':'));
    // Pandoc names a fallback file under its working folder, which can be
    // spelled differently from `root`: resolved past a symlink, or without
    // the `\\?\` prefix on Windows.
    let spellings = [Some(root.to_path_buf()), root.canonicalize().ok()];
    let name = spellings
        .iter()
        .flatten()
        .flat_map(|root| [root.clone(), oleafly_core::plain_path(root)])
        .find_map(|root| path.strip_prefix(root).ok().map(Path::to_path_buf))
        .map(|relative| relative.to_string_lossy().replace('\\', "/"))
        .or_else(|| {
            path.file_name()
                .map(|name| name.to_string_lossy().into_owned())
        })
        .unwrap_or_else(|| first.trim().to_string());
    let detail = remainder
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    let detail = detail
        .strip_prefix('(')
        .map(|inner| inner.replacen("):", ":", 1))
        .unwrap_or(detail);
    let message = format!("Oleafly couldn't read the bibliography {name}. Check it for a broken entry, then export again.");
    let error =
        crate::DocError::new("export.bibliography_unreadable", message.clone()).param("name", name);
    if detail.is_empty() {
        error
    } else {
        crate::DocError {
            message: format!("{message} ({detail})"),
            ..error.param("detail", detail)
        }
    }
}

fn path_is_placeholder(path: &Path) -> bool {
    std::fs::symlink_metadata(path)
        .is_ok_and(|metadata| oleafly_core::is_cloud_placeholder(&metadata))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BibliographySource {
    Markdown,
    Typst,
}

impl BibliographySource {
    pub fn for_reader(reader: &str) -> Option<Self> {
        match reader {
            "markdown" | "md" => Some(Self::Markdown),
            "typst" | "typ" => Some(Self::Typst),
            _ => None,
        }
    }
}

fn code_fence(line: &str) -> Option<(char, usize)> {
    let stripped = line.trim_start_matches(' ');
    if line.len() - stripped.len() > 3 {
        return None;
    }
    let marker = stripped.chars().next().filter(|c| matches!(c, '`' | '~'))?;
    let length = stripped.chars().take_while(|c| *c == marker).count();
    (length >= 3).then_some((marker, length))
}

fn yaml_bibliography(yaml: &str) -> Option<Vec<String>> {
    let value = serde_norway::from_str::<serde_norway::Value>(yaml).ok()?;
    match value.get("bibliography")? {
        serde_norway::Value::String(entry) => Some(vec![entry.clone()]),
        serde_norway::Value::Sequence(entries) => Some(
            entries
                .iter()
                .filter_map(serde_norway::Value::as_str)
                .map(str::to_string)
                .collect(),
        ),
        _ => None,
    }
}

/// The `bibliography` entries of Markdown metadata blocks. Pandoc reads a
/// block at the top of the file, after blank lines, or anywhere a blank line
/// comes before it; its opening `---` is not followed by a blank line. When
/// two blocks set the field, the later one wins.
fn front_matter_bibliographies(text: &str) -> Vec<String> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let lines: Vec<&str> = text.lines().collect();
    let mut found = Vec::new();
    let mut fence: Option<(char, usize)> = None;
    let mut after_blank = true;
    let mut index = 0;
    while index < lines.len() {
        let line = lines[index];
        index += 1;
        if let Some((marker, length)) = fence {
            let closes = code_fence(line).is_some_and(|(close, count)| {
                close == marker && count >= length && {
                    let rest = line.trim().trim_start_matches(marker);
                    rest.trim().is_empty()
                }
            });
            if closes {
                fence = None;
            }
            after_blank = false;
            continue;
        }
        if let Some(opening) = code_fence(line) {
            fence = Some(opening);
            after_blank = false;
            continue;
        }
        let opens_block = after_blank
            && line.trim_end() == "---"
            && lines.get(index).is_some_and(|next| !next.trim().is_empty());
        after_blank = line.trim().is_empty();
        if !opens_block {
            continue;
        }
        let Some(length) = lines[index..]
            .iter()
            .position(|line| matches!(line.trim_end(), "---" | "..."))
        else {
            continue;
        };
        let yaml = lines[index..index + length].join("\n");
        if let Some(entries) = yaml_bibliography(&yaml) {
            found = entries;
        }
        index += length + 1;
        after_blank = false;
    }
    found
}

fn typst_call_strings(text: &str, open: usize) -> Vec<String> {
    let mut strings = Vec::new();
    let mut depth = 1_usize;
    let mut named = false;
    let mut characters = text[open..].chars();
    while let Some(character) = characters.next() {
        match character {
            '(' => depth += 1,
            ')' => {
                depth -= 1;
                if depth == 0 {
                    break;
                }
            }
            ':' if depth == 1 => named = true,
            ',' if depth == 1 => named = false,
            '"' => {
                let mut value = String::new();
                while let Some(inner) = characters.next() {
                    match inner {
                        '\\' => {
                            if let Some(escaped) = characters.next() {
                                value.push(escaped);
                            }
                        }
                        '"' => break,
                        _ => value.push(inner),
                    }
                }
                if !named {
                    strings.push(value);
                }
            }
            _ => {}
        }
    }
    strings
}

/// Whether a Typst bibliography argument names a file Typst reads: BibTeX,
/// or Hayagriva YAML.
fn is_typst_bibliography_file(value: &str) -> bool {
    Path::new(value)
        .extension()
        .and_then(std::ffi::OsStr::to_str)
        .is_some_and(|extension| {
            ["bib", "yml", "yaml"]
                .iter()
                .any(|known| extension.eq_ignore_ascii_case(known))
        })
}

fn typst_bibliographies(text: &str) -> Vec<String> {
    let mut found = Vec::new();
    let mut search = 0;
    while let Some(at) = text[search..].find("#bibliography(") {
        let open = search + at + "#bibliography(".len();
        found.extend(
            typst_call_strings(text, open)
                .into_iter()
                .filter(|value| is_typst_bibliography_file(value)),
        );
        search = open;
    }
    found
}

pub fn declared_bibliographies(source: BibliographySource, text: &str) -> Vec<String> {
    match source {
        BibliographySource::Markdown => front_matter_bibliographies(text),
        BibliographySource::Typst => typst_bibliographies(text),
    }
}

fn declared_file_name(entry: &str) -> &str {
    entry
        .rsplit(['/', '\\'])
        .find(|part| !part.is_empty())
        .unwrap_or(entry)
}

/// A file name BibTeX can read: spaces and TeX specials become hyphens.
pub fn local_bibliography_name(entry: &str) -> String {
    let file = declared_file_name(entry);
    let stem = file.rsplit_once('.').map(|(stem, _)| stem).unwrap_or(file);
    let mut name = String::new();
    for character in stem.chars() {
        let keep = character.is_alphanumeric() || matches!(character, '_' | '-' | '+' | '.');
        let next = if keep { character } else { '-' };
        if next == '-' && name.ends_with('-') {
            continue;
        }
        name.push(next);
    }
    let name = name.trim_matches(['-', '.']);
    if name.is_empty() {
        "references.bib".into()
    } else {
        format!("{name}.bib")
    }
}

pub fn unique_local_names<'a>(entries: impl IntoIterator<Item = &'a str>) -> Vec<String> {
    let mut used = std::collections::HashSet::new();
    let mut names = Vec::new();
    for entry in entries {
        let base = local_bibliography_name(entry);
        let stem = base.trim_end_matches(".bib").to_string();
        let mut candidate = base;
        let mut counter = 2;
        while !used.insert(candidate.to_ascii_lowercase()) {
            candidate = format!("{stem}-{counter}.bib");
            counter += 1;
        }
        names.push(candidate);
    }
    names
}

fn resolve_declared(
    source: BibliographySource,
    source_dir: &Path,
    entry: &str,
    home: Option<&Path>,
) -> PathBuf {
    let home = || home.map(Path::to_path_buf);
    if let Some(rest) = entry
        .strip_prefix("~/")
        .or_else(|| entry.strip_prefix("~\\"))
    {
        if let Some(home) = home() {
            return home.join(rest);
        }
    }
    // A Typst path that starts with "/" is relative to the project root,
    // which for a lone source file is its folder.
    if source == BibliographySource::Typst {
        return source_dir.join(entry.trim_start_matches('/'));
    }
    let path = Path::new(entry);
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        source_dir.join(path)
    }
}

fn read_bibliography(path: &Path) -> Option<Vec<u8>> {
    let metadata = std::fs::metadata(path).ok()?;
    if !metadata.is_file() || metadata.len() > MAX_BIBLIOGRAPHY_BYTES || path_is_placeholder(path) {
        return None;
    }
    std::fs::read(path).ok()
}

#[derive(Debug, Default)]
pub struct ImportBibliographies {
    pub files: Vec<(String, Vec<u8>)>,
    pub missing: Vec<String>,
}

impl ImportBibliographies {
    pub fn local_names(&self) -> Vec<String> {
        self.files.iter().map(|(name, _)| name.clone()).collect()
    }
}

pub fn collect_import_bibliographies(
    source: BibliographySource,
    source_path: &Path,
    text: &str,
    home: Option<&Path>,
) -> ImportBibliographies {
    let source_dir = source_path.parent().unwrap_or_else(|| Path::new("."));
    let declared = declared_bibliographies(source, text);
    let mut result = ImportBibliographies::default();
    let candidates: Vec<(String, PathBuf)> = if declared.is_empty() {
        bib_files_in(source_dir)
            .into_iter()
            .map(|path| (path.to_string_lossy().into_owned(), path))
            .collect()
    } else {
        declared
            .iter()
            .map(|entry| {
                (
                    entry.clone(),
                    resolve_declared(source, source_dir, entry, home),
                )
            })
            .collect()
    };
    let mut readable = Vec::new();
    for (entry, path) in candidates {
        let contents = (is_bib_file(&path) && readable.len() < MAX_BIBLIOGRAPHIES)
            .then(|| read_bibliography(&path))
            .flatten();
        match contents {
            Some(bytes) => readable.push((entry, bytes)),
            None => result
                .missing
                .push(declared_file_name(&entry).replace(['\r', '\n'], " ")),
        }
    }
    let names = unique_local_names(readable.iter().map(|(entry, _)| entry.as_str()));
    result.files = names
        .into_iter()
        .zip(readable)
        .map(|(name, (_, bytes))| (name, bytes))
        .collect();
    result
}

pub fn missing_bibliographies_note(main_doc: &str, missing: &[String]) -> Option<String> {
    if missing.is_empty() {
        return None;
    }
    let names = missing.join(", ");
    let first =
        format!("Oleafly couldn't copy these bibliography files into the project: {names}.");
    Some(if main_doc.ends_with(".tex") {
        format!("% {first}\n% Add them next to {main_doc} and list them in \\bibliography.\n")
    } else if main_doc.ends_with(".typ") {
        format!("// {first}\n// Add them next to {main_doc} and list them in #bibliography.\n")
    } else {
        format!(
            "\n<!-- {first} Add them next to {main_doc} and list them under bibliography. -->\n"
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aux_records_carry_numbers_kinds_and_bibcites() {
        let mut records = AuxRecords::default();
        let children = parse_aux(
            "\\relax\n\
             \\newlabel{sec:method}{{2}{3}{Method}{section.2}{}}\n\
             \\newlabel{eq:mae}{{2.1}{3}{}{equation.2.1}{}}\n\
             \\newlabel{eq:mae@cref}{{[equation][1][2]2.1}{[1][3][]3}}\n\
             \\newlabel{fig:plot}{{\\relax 4}{5}}\n\
             \\newlabel{tab:x@cref}{{[table][1][]1}{[1][1][]1}}\n\
             \\bibcite{smith2020}{1}\n\
             \\bibcite{jones2021}{{2}{2021}{{Jones}}{{Jones, Kate}}}\n\
             \\@input{chapters/one.aux}\n",
            &mut records,
        );
        assert_eq!(children, vec!["chapters/one.aux"]);
        assert_eq!(
            records.labels["sec:method"],
            AuxLabel {
                number: "2".into(),
                kind: "section".into()
            }
        );
        assert_eq!(records.labels["eq:mae"].number, "2.1");
        assert_eq!(records.labels["eq:mae"].kind, "equation");
        assert_eq!(records.labels["fig:plot"].number, "4");
        assert_eq!(records.labels["fig:plot"].kind, "");
        assert!(!records.labels.contains_key("tab:x"));
        assert!(!records.labels.contains_key("eq:mae@cref"));
        assert_eq!(records.bibcites["smith2020"], "1");
        assert_eq!(records.bibcites["jones2021"], "2");
    }

    #[test]
    fn aux_numbers_come_only_from_this_documents_compile() {
        let build = tempfile::tempdir().unwrap();
        std::fs::write(
            build.path().join(oleafly_core::engine_spec::ENTRY_TEX),
            "\\input{\\detokenize{paper/main.tex}}\n",
        )
        .unwrap();
        std::fs::write(
            build.path().join("_oleafly_entry.aux"),
            "\\newlabel{a}{{1}{1}}\n\\@input{ch/one.aux}\n\\@input{../escape.aux}\n",
        )
        .unwrap();
        std::fs::create_dir_all(build.path().join("ch")).unwrap();
        std::fs::write(
            build.path().join("ch/one.aux"),
            "\\newlabel{b}{{2}{2}}\n\\newlabel{a}{{9}{9}}\n",
        )
        .unwrap();

        let records = read_aux_records(build.path(), "paper/main.tex");
        assert_eq!(records.labels["a"].number, "1");
        assert_eq!(records.labels["b"].number, "2");
        assert!(read_aux_records(build.path(), "other.tex")
            .labels
            .is_empty());
    }

    #[test]
    fn export_falls_back_to_bib_files_beside_the_main_document_then_the_root() {
        let project = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(project.path().join("paper/deep")).unwrap();
        for file in [
            "paper/b.bib",
            "paper/a.BIB",
            "root.bib",
            "paper/deep/no.bib",
            "x.txt",
        ] {
            std::fs::write(project.path().join(file), "").unwrap();
        }
        let found = fallback_bibliographies(project.path(), "paper/main.tex");
        assert_eq!(
            found,
            vec![
                project.path().join("paper/a.BIB"),
                project.path().join("paper/b.bib"),
                project.path().join("root.bib"),
            ]
        );
    }

    #[test]
    fn unreadable_bibliographies_are_named_without_the_home_folder() {
        let root = Path::new("/home/ada/project");
        let error = export_failure(
            "Error reading bibliography file /home/ada/project/paper/refs.bib:\n(line 2, column 1):\nunexpected end of input\n",
            root,
        );
        assert_eq!(error.code, "export.bibliography_unreadable");
        assert_eq!(
            error.message,
            "Oleafly couldn't read the bibliography paper/refs.bib. Check it for a broken entry, then export again. (line 2, column 1: unexpected end of input)"
        );
        let outside = export_failure(
            "Error reading bibliography file /home/ada/Zotero/My Library.bib:\nboom\n",
            root,
        );
        assert!(outside
            .params
            .iter()
            .any(|(key, value)| *key == "name" && value == "My Library.bib"));
        assert!(
            !outside.message.contains("/home/ada"),
            "{}",
            outside.message
        );
        assert_eq!(
            export_failure("boom\n", root).message,
            "pandoc failed: boom"
        );
    }

    #[test]
    fn declared_bibliographies_come_from_front_matter_or_typst_calls() {
        assert_eq!(
            declared_bibliographies(
                BibliographySource::Markdown,
                "---\ntitle: T\nbibliography:\n  - a.bib\n  - \"/x/My Library.bib\"\n---\n\nText\n"
            ),
            vec!["a.bib", "/x/My Library.bib"]
        );
        assert_eq!(
            declared_bibliographies(
                BibliographySource::Markdown,
                "---\nbibliography: refs.bib\n...\n"
            ),
            vec!["refs.bib"]
        );
        assert!(
            declared_bibliographies(BibliographySource::Markdown, "# No front matter\n").is_empty()
        );
        assert_eq!(
            declared_bibliographies(
                BibliographySource::Typst,
                "#bibliography((\"a.bib\", \"b.bib\"), style: \"apa\")\n"
            ),
            vec!["a.bib", "b.bib"]
        );
        assert_eq!(
            declared_bibliographies(BibliographySource::Typst, "#bibliography(\"refs.bib\")"),
            vec!["refs.bib"]
        );
        // Hayagriva YAML is a Typst bibliography too. Named arguments are not
        // files, whatever their value looks like.
        assert_eq!(
            declared_bibliographies(BibliographySource::Typst, "#bibliography(\"works.yml\")"),
            vec!["works.yml"]
        );
        assert_eq!(
            declared_bibliographies(
                BibliographySource::Typst,
                "#bibliography((\"a.yaml\", \"b.bib\"), title: \"Old.bib\", style: \"ieee.csl\")\n"
            ),
            vec!["a.yaml", "b.bib"]
        );
    }

    #[test]
    fn a_typst_source_naming_yaml_notes_it_instead_of_dropping_it() {
        let sources = tempfile::tempdir().unwrap();
        let paper = sources.path().join("paper.typ");
        let text = "See @smith2020.\n\n#bibliography(\"works.yml\", style: \"apa\")\n";
        std::fs::write(&paper, text).unwrap();
        std::fs::write(
            sources.path().join("works.yml"),
            "smith2020:\n  type: article\n",
        )
        .unwrap();

        let found = collect_import_bibliographies(BibliographySource::Typst, &paper, text, None);

        assert!(found.files.is_empty());
        assert_eq!(found.missing, vec!["works.yml"]);
        let note = missing_bibliographies_note("main.tex", &found.missing).unwrap();
        assert!(note.contains("works.yml"), "{note}");
        let folder = sources.path().to_string_lossy().into_owned();
        assert!(!note.contains(&folder), "{note}");
    }

    fn names_in(folder: &Path) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(folder)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    fn library_staging(root: &Path) -> PathBuf {
        let staging = root.join(".oleafly").join(STAGING_DIR);
        std::fs::create_dir_all(&staging).unwrap();
        staging
    }

    #[test]
    fn export_filter_is_handed_to_pandoc_by_an_ascii_path() {
        // Pandoc loads a Lua filter with C fopen, which on Windows reads the
        // path in the ANSI code page. A folder under a profile such as
        // C:\Users\論文 cannot be named in CP1252, so the filter is staged in
        // the project's data folder and pandoc, which runs at the project
        // root, gets a relative path. Nothing appears beside the user's files.
        let outer = tempfile::tempdir().unwrap();
        let root = outer.path().join("Übung 論文");
        let unicode_temp = outer.path().join("論文");
        std::fs::create_dir_all(root.join("paper")).unwrap();
        std::fs::create_dir_all(&unicode_temp).unwrap();
        std::fs::write(root.join("paper/refs.bib"), "").unwrap();
        std::fs::write(root.join("root.bib"), "").unwrap();
        let staging = library_staging(&root);
        let before = names_in(&root);

        let filter =
            prepare_export_filter(&root, "paper/main.tex", None, Some(&staging), &unicode_temp)
                .unwrap();
        let argument = filter.argument().to_path_buf();
        assert!(argument.is_relative(), "{argument:?}");
        assert!(argument.to_str().is_some_and(str::is_ascii), "{argument:?}");
        assert!(
            argument.starts_with(".oleafly/export-staging"),
            "{argument:?}"
        );
        assert!(argument.ends_with(FILTER_NAME), "{argument:?}");
        let staged = root.join(&argument);
        assert!(staged.is_file(), "{staged:?}");
        let data = std::fs::read_to_string(staged.with_file_name(DATA_NAME)).unwrap();
        assert_eq!(
            data,
            "bibliography\tpaper/refs.bib\nbibliography\troot.bib\n"
        );
        assert_eq!(names_in(&root), before, "no new entry at the root");
        assert!(names_in(&unicode_temp).is_empty());
        drop(filter);
        assert_eq!(names_in(&root), before);
        assert!(names_in(&staging).is_empty());

        let ascii_temp = outer.path().join("plain");
        std::fs::create_dir_all(&ascii_temp).unwrap();
        let filter =
            prepare_export_filter(&root, "paper/main.tex", None, Some(&staging), &ascii_temp)
                .unwrap();
        assert!(
            filter.argument().starts_with(".oleafly/export-staging"),
            "{:?}",
            filter.argument()
        );
        assert!(names_in(&ascii_temp).is_empty());
        drop(filter);

        let filter =
            prepare_export_filter(&root, "paper/main.tex", None, None, &ascii_temp).unwrap();
        assert!(filter.argument().starts_with(&ascii_temp));
        assert!(filter.argument().is_file());
        assert_eq!(names_in(&root), before);
    }

    #[test]
    fn a_linked_folder_stages_the_filter_in_its_state_area() {
        let outer = tempfile::tempdir().unwrap();
        let root = outer.path().join("Übung 論文");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("refs.bib"), "").unwrap();
        let staging = outer.path().join("data/linked/abc/export-staging");
        std::fs::create_dir_all(&staging).unwrap();
        let unicode_temp = outer.path().join("論文");
        std::fs::create_dir_all(&unicode_temp).unwrap();

        let filter =
            prepare_export_filter(&root, "main.tex", None, Some(&staging), &unicode_temp).unwrap();
        let argument = filter.argument().to_path_buf();
        assert!(argument.is_relative(), "{argument:?}");
        assert!(argument.to_str().is_some_and(str::is_ascii), "{argument:?}");
        assert!(argument.starts_with(".."), "{argument:?}");
        assert!(root.join(&argument).is_file(), "{argument:?}");
        assert_eq!(names_in(&root), ["refs.bib"]);
        assert!(names_in(&unicode_temp).is_empty());
        drop(filter);
        assert!(names_in(&staging).is_empty());

        let far = outer.path().join("論文/export-staging");
        std::fs::create_dir_all(&far).unwrap();
        let ascii_temp = outer.path().join("plain");
        std::fs::create_dir_all(&ascii_temp).unwrap();
        let filter =
            prepare_export_filter(&root, "main.tex", None, Some(&far), &ascii_temp).unwrap();
        assert!(filter.argument().is_absolute(), "{:?}", filter.argument());
        assert!(filter.argument().starts_with(&ascii_temp));
        assert!(names_in(&far).is_empty());
        assert_eq!(names_in(&root), ["refs.bib"]);
    }

    #[test]
    fn an_export_clears_filter_folders_an_earlier_one_left_behind() {
        // A force-quit, or a removal Windows refused while a scanner held a
        // file open, leaves a folder behind. The next export removes it but
        // keeps the folder of an export that is still running.
        let outer = tempfile::tempdir().unwrap();
        let root = outer.path().join("project");
        let temp = outer.path().join("temp");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&temp).unwrap();
        let staging = library_staging(&root);
        let running =
            prepare_export_filter(&root, "main.tex", None, Some(&staging), &temp).unwrap();
        let stale = staging.join("oleafly-export-stale1");
        std::fs::create_dir_all(&stale).unwrap();
        std::fs::write(stale.join(DATA_NAME), "bibliography\trefs.bib\n").unwrap();
        std::fs::write(staging.join("notes.txt"), "").unwrap();

        let next = prepare_export_filter(&root, "main.tex", None, Some(&staging), &temp).unwrap();

        assert!(!stale.exists());
        assert!(root.join(running.argument()).is_file(), "still running");
        assert!(root.join(next.argument()).is_file());
        assert!(staging.join("notes.txt").is_file(), "not an export folder");
        drop(running);
        drop(next);
        assert_eq!(names_in(&staging), ["notes.txt"]);
    }

    #[test]
    fn relative_paths_climb_to_the_shared_folder_then_descend() {
        let relative =
            |base: &str, target: &str| lexical_relative(Path::new(base), Path::new(target));
        assert_eq!(relative("a/b", "/a/b"), None);
        #[cfg(not(windows))]
        {
            assert_eq!(
                relative("/a/b/c", "/a/x/y"),
                Some(PathBuf::from("../../x/y"))
            );
            assert_eq!(
                relative("/a/b", "/a/b/.oleafly/s"),
                Some(PathBuf::from(".oleafly/s"))
            );
        }
        #[cfg(windows)]
        {
            assert_eq!(
                relative(r"C:\Users\論文\Paper", r"c:\users\論文\.oleafly\linked\x"),
                Some(PathBuf::from(r"..\.oleafly\linked\x"))
            );
            assert_eq!(relative(r"D:\Paper", r"C:\Users\x"), None);
            assert_eq!(relative(r"\\server\share\Paper", r"C:\Users\x"), None);
        }
    }

    #[test]
    fn front_matter_is_found_wherever_pandoc_reads_a_metadata_block() {
        let markdown = |text: &str| declared_bibliographies(BibliographySource::Markdown, text);
        // Pandoc reads a metadata block after leading blank lines, and later
        // in the file when a blank line comes before it.
        assert_eq!(
            markdown("\n---\nbibliography: \"/x/My Library.bib\"\n---\n\nSee [@a].\n"),
            vec!["/x/My Library.bib"]
        );
        assert_eq!(
            markdown("Intro.\n\n---\nbibliography: late.bib\n...\n\nSee [@a].\n"),
            vec!["late.bib"]
        );
        // When two blocks set it, the later one wins, as in pandoc.
        assert_eq!(
            markdown("---\nbibliography: a.bib\n---\n\nText.\n\n---\nbibliography: b.bib\n---\n"),
            vec!["b.bib"]
        );
        assert!(markdown("Text\n\n---\n\nbibliography: no.bib\n---\n").is_empty());
        assert!(markdown("Title\n---\nbibliography: no.bib\n---\n").is_empty());
        assert!(markdown("```\n\n---\nbibliography: no.bib\n---\n```\n").is_empty());
    }

    #[test]
    fn export_filter_reads_files_through_pandoc_not_c_stdio() {
        // Lua's io.open uses the ANSI code page on Windows, so a non-ASCII
        // profile or project folder would read as missing. Pandoc's own
        // file functions take UTF-8 paths on every platform.
        assert!(!FILTER.contains("io.open"), "{FILTER}");
        assert!(!FILTER.contains("io.lines"), "{FILTER}");
    }

    #[test]
    fn local_bibliography_names_are_bibtex_safe_and_unique() {
        assert_eq!(
            local_bibliography_name("/x/My Library.bib"),
            "My-Library.bib"
        );
        assert_eq!(local_bibliography_name("~/Zotero/lib.bib"), "lib.bib");
        assert_eq!(local_bibliography_name("C:\\refs\\a,b{c}.bib"), "a-b-c.bib");
        assert_eq!(local_bibliography_name("Müller.bib"), "Müller.bib");
        assert_eq!(local_bibliography_name("---.bib"), "references.bib");
        assert_eq!(
            unique_local_names(["a/refs.bib", "b/refs.bib", "c/REFS.bib"]),
            vec!["refs.bib", "refs-2.bib", "REFS-3.bib"]
        );
    }
}
