mod parse;
#[cfg(test)]
mod tests;

use crate::{
    is_cloud_placeholder, is_skipped_scan_directory, sniff_oleafly_manifest, ProjectManifest,
    MAX_MANIFEST_BYTES,
};
use crate::{Error, ErrorKind, Result};
use parse::{
    arxiv_toplevel_sources, document_class, has_begin_document, has_bibliography, has_extension,
    has_plain_tex_end, latex_references, latex_title, latexmk_default_files, markdown_references,
    markdown_title, mask_latex_comments, mask_typst_comments, normalize_project_path, parent_of,
    resolve_in, resolve_project_path, typst_library_like, typst_references,
    typst_template_entrypoint, typst_title,
};
pub use parse::{tex_magic_comments, TexMagicComments};
use serde::Serialize;
use std::cmp::Ordering;
use std::collections::{BTreeSet, HashMap, VecDeque};
use std::ffi::OsStr;
use std::io::{Read, Seek, SeekFrom};
use std::ops::ControlFlow;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering as AtomicOrdering};
use std::time::{Duration, Instant};
use unicode_normalization::UnicodeNormalization;

pub const DETECT_MAX_DEPTH: usize = 6;
pub const DETECT_MAX_ENTRIES: usize = 20_000;
pub const DETECT_MAX_SOURCES: usize = 3_000;
pub const DETECT_DEADLINE: Duration = Duration::from_millis(1_500);
const HEAD_BYTES: u64 = 64 * 1024;
const TAIL_BYTES: u64 = 4 * 1024;
const UTF8_BOM: [u8; 3] = [0xEF, 0xBB, 0xBF];
const MANIFEST_FILE: &str = "project.json";
const SOURCE_SUFFIXES: [&str; 6] = [".tex", ".ltx", ".latex", ".typ", ".md", ".markdown"];
const LATEX_SUFFIXES: [&str; 3] = [".tex", ".ltx", ".latex"];
const GRAPHIC_SUFFIXES: [&str; 6] = [".pdf", ".png", ".jpg", ".jpeg", ".eps", ".svg"];
const ROOT_MAINS: [&str; 3] = ["main.tex", "main.typ", "main.md"];
const REPOSITORY_NOTES: [&str; 7] = [
    "readme",
    "changelog",
    "license",
    "licence",
    "contributing",
    "code_of_conduct",
    "security",
];

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceFamily {
    Latex,
    Typst,
    Markdown,
}

impl SourceFamily {
    pub fn of(path: &str) -> Option<Self> {
        let extension = Path::new(path)
            .extension()
            .and_then(OsStr::to_str)?
            .to_ascii_lowercase();
        match extension.as_str() {
            "tex" | "ltx" | "latex" => Some(Self::Latex),
            "typ" => Some(Self::Typst),
            "md" | "markdown" => Some(Self::Markdown),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Tier {
    S,
    A,
    M,
    W,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DocumentKind {
    Document,
    Book,
    Presentation,
    Poster,
    Standalone,
    Typst,
    Markdown,
    Unknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Reason {
    Declared,
    TopLevel,
    NamedMain,
    NamedAfterFolder,
    IncludesFiles,
    HasBibliography,
    NoBeginDocument,
    StandaloneFigure,
    Placeholder,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Decision {
    Auto,
    Ask,
    NoMain,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DetectionSource {
    SavedChoice,
    Manifest,
    Latexmkrc,
    ArxivReadme,
    TypstToml,
    Subfiles,
    TexRoot,
    RootMain,
    Scan,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Candidate {
    pub path: String,
    pub family: SourceFamily,
    pub tier: Tier,
    pub kind: DocumentKind,
    pub class: Option<String>,
    pub title: Option<String>,
    pub depth: usize,
    pub reasons: Vec<Reason>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Detection {
    pub main: Option<String>,
    pub decision: Decision,
    pub source: DetectionSource,
    pub candidates: Vec<Candidate>,
    pub truncated: bool,
    pub compile_dir: Option<String>,
}

impl Detection {
    pub fn best(&self) -> Option<&str> {
        self.main.as_deref().or_else(|| {
            self.candidates
                .first()
                .map(|candidate| candidate.path.as_str())
        })
    }

    pub fn best_of(&self, family: SourceFamily) -> Option<&str> {
        self.main
            .as_deref()
            .filter(|main| SourceFamily::of(main) == Some(family))
            .or_else(|| {
                self.candidates
                    .iter()
                    .find(|candidate| candidate.family == family)
                    .map(|candidate| candidate.path.as_str())
            })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DetectLimits {
    pub max_depth: usize,
    pub max_entries: usize,
    pub max_sources: usize,
    pub deadline: Duration,
}

impl Default for DetectLimits {
    fn default() -> Self {
        Self {
            max_depth: DETECT_MAX_DEPTH,
            max_entries: DETECT_MAX_ENTRIES,
            max_sources: DETECT_MAX_SOURCES,
            deadline: DETECT_DEADLINE,
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct DetectOptions<'a> {
    pub saved_main: Option<&'a str>,
    pub limits: DetectLimits,
    pub cancel: Option<&'a AtomicBool>,
    pub placeholder: fn(&Path, &std::fs::Metadata) -> bool,
}

impl Default for DetectOptions<'_> {
    fn default() -> Self {
        Self {
            saved_main: None,
            limits: DetectLimits::default(),
            cancel: None,
            placeholder: cloud_placeholder_entry,
        }
    }
}

fn cloud_placeholder_entry(_path: &Path, metadata: &std::fs::Metadata) -> bool {
    is_cloud_placeholder(metadata)
}

pub fn detect_main_document(root: &Path, options: &DetectOptions<'_>) -> Result<Detection> {
    let root = root.canonicalize().map_err(|error| {
        Error::new(
            ErrorKind::InvalidInput,
            format!("cannot inspect {}: {error}", root.display()),
        )
    })?;
    if !root.is_dir() {
        return Err(Error::new(
            ErrorKind::InvalidInput,
            format!("workspace is not a directory: {}", root.display()),
        ));
    }
    if let Some(saved) = options
        .saved_main
        .and_then(|saved| existing_source(&root, saved, None))
        .map(|saved| disk_spelling(&root, None, saved))
    {
        return Ok(settled(&root, saved, DetectionSource::SavedChoice, options));
    }
    if let Some(main) = manifest_main(&root, options) {
        return Ok(settled(&root, main, DetectionSource::Manifest, options));
    }
    let mut scan = Scan::run(&root, options)?;
    let graph = Graph::build(&scan);
    scan.complete_split_documents(&graph);
    let root_name = root
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let ranked = scan.ranked(&graph, &root_name);
    let declarations = declarations(&root, &scan, options);
    if !declarations.is_empty() {
        let decisive = decisive(&declarations, &ranked);
        return Ok(match declarations.as_slice() {
            [only] if decisive => automatic(
                &root,
                only.path.clone(),
                only.source,
                &ranked,
                &scan,
                options,
            ),
            _ => declared_choice(
                &root,
                &scan,
                &graph,
                &root_name,
                &declarations,
                options,
                if decisive { &[] } else { &ranked },
            ),
        });
    }
    if let Some(main) = root_main(&root, &scan, &graph, options) {
        return Ok(automatic(
            &root,
            main,
            DetectionSource::RootMain,
            &ranked,
            &scan,
            options,
        ));
    }
    let choice = automatic_choice(&ranked).filter(|&index| {
        !scan.truncated
            || (ranked[index].candidate.tier == Tier::S && ranked[index].candidate.depth == 0)
    });
    Ok(match choice {
        Some(index) => automatic(
            &root,
            ranked[index].candidate.path.clone(),
            DetectionSource::Scan,
            &ranked,
            &scan,
            options,
        ),
        None => Detection {
            main: None,
            decision: if ranked.is_empty() {
                Decision::NoMain
            } else {
                Decision::Ask
            },
            source: DetectionSource::Scan,
            candidates: ranked.into_iter().map(|ranked| ranked.candidate).collect(),
            truncated: scan.truncated,
            compile_dir: None,
        },
    })
}

pub fn compile_dir_for(root: &Path, main: &str) -> Option<String> {
    if SourceFamily::of(main) != Some(SourceFamily::Latex) {
        return None;
    }
    let main = normalize_project_path(main)?;
    let (directory, _) = main.rsplit_once('/')?;
    let head = read_head(&root.join(&main))?;
    let references = latex_references(&mask_latex_comments(&head));
    let targets = references
        .inputs
        .iter()
        .map(|raw| (raw, &LATEX_SUFFIXES[..]))
        .chain(
            references
                .graphics
                .iter()
                .map(|raw| (raw, &GRAPHIC_SUFFIXES[..])),
        )
        .chain(references.bibliographies.iter().map(|raw| (raw, &[][..])))
        .collect::<Vec<_>>();
    if targets.iter().any(|(raw, _)| {
        let raw = raw.trim().replace('\\', "/");
        raw == ".." || raw.starts_with("../")
    }) {
        return None;
    }
    let mut from_root = 0usize;
    let mut only_local = 0usize;
    for (raw, suffixes) in targets {
        if exists_under(root, "", raw, suffixes) {
            from_root += 1;
        } else if exists_under(root, directory, raw, suffixes) {
            only_local += 1;
        }
    }
    (only_local > from_root).then(|| directory.to_owned())
}

fn exists_under(root: &Path, directory: &str, raw: &str, suffixes: &[&str]) -> bool {
    let Some(path) = resolve_in(directory, raw) else {
        return false;
    };
    root.join(&path).is_file()
        || (!has_extension(&path)
            && suffixes
                .iter()
                .any(|suffix| root.join(format!("{path}{suffix}")).is_file()))
}

fn resident_compile_dir(root: &Path, main: &str, options: &DetectOptions<'_>) -> Option<String> {
    let path = root.join(main);
    let metadata = std::fs::symlink_metadata(&path).ok()?;
    if (options.placeholder)(&path, &metadata) {
        return None;
    }
    compile_dir_for(root, main)
}

fn settled(
    root: &Path,
    main: String,
    source: DetectionSource,
    options: &DetectOptions<'_>,
) -> Detection {
    Detection {
        compile_dir: resident_compile_dir(root, &main, options),
        main: Some(main),
        decision: Decision::Auto,
        source,
        candidates: Vec::new(),
        truncated: false,
    }
}

fn automatic(
    root: &Path,
    main: String,
    source: DetectionSource,
    ranked: &[Ranked],
    scan: &Scan,
    options: &DetectOptions<'_>,
) -> Detection {
    Detection {
        compile_dir: resident_compile_dir(root, &main, options),
        main: Some(main),
        decision: Decision::Auto,
        source,
        candidates: ranked
            .iter()
            .map(|ranked| ranked.candidate.clone())
            .collect(),
        truncated: scan.truncated,
    }
}

fn read_head(path: &Path) -> Option<String> {
    let file = std::fs::File::open(path).ok()?;
    let mut bytes = Vec::new();
    file.take(HEAD_BYTES).read_to_end(&mut bytes).ok()?;
    let text = bytes.strip_prefix(&UTF8_BOM).unwrap_or(&bytes);
    Some(String::from_utf8_lossy(text).into_owned())
}

fn read_tail(path: &Path) -> Option<String> {
    let mut file = std::fs::File::open(path).ok()?;
    let length = file.metadata().ok()?.len();
    if length <= HEAD_BYTES {
        return None;
    }
    file.seek(SeekFrom::Start(length - TAIL_BYTES)).ok()?;
    let mut bytes = Vec::new();
    file.take(TAIL_BYTES).read_to_end(&mut bytes).ok()?;
    let text = String::from_utf8_lossy(&bytes);
    text.split_once('\n')
        .map(|(_, whole_lines)| whole_lines.to_owned())
}

fn read_resident(path: &Path, limit: u64, options: &DetectOptions<'_>) -> Option<Vec<u8>> {
    let metadata = std::fs::symlink_metadata(path).ok()?;
    if !metadata.is_file() || metadata.len() > limit || (options.placeholder)(path, &metadata) {
        return None;
    }
    let mut bytes = Vec::new();
    std::fs::File::open(path)
        .ok()?
        .take(limit)
        .read_to_end(&mut bytes)
        .ok()?;
    Some(bytes)
}

fn read_text(path: &Path, options: &DetectOptions<'_>) -> Option<String> {
    read_resident(path, HEAD_BYTES, options)
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
}

fn oleafly_manifest_in(directory: &Path, options: &DetectOptions<'_>) -> Option<ProjectManifest> {
    let bytes = read_resident(&directory.join(MANIFEST_FILE), MAX_MANIFEST_BYTES, options)?;
    sniff_oleafly_manifest(&bytes)
}

fn manifest_main(root: &Path, options: &DetectOptions<'_>) -> Option<String> {
    let manifest = oleafly_manifest_in(root, options)?;
    existing_source(root, &manifest.main_doc, None).map(|main| disk_spelling(root, None, main))
}

fn existing_source(root: &Path, relative: &str, family: Option<SourceFamily>) -> Option<String> {
    let normalized = normalize_project_path(relative)?;
    let found = SourceFamily::of(&normalized)?;
    if family.is_some_and(|family| family != found) {
        return None;
    }
    let path = root.join(&normalized);
    let metadata = std::fs::symlink_metadata(&path).ok()?;
    if !metadata.is_file() || !path.canonicalize().ok()?.starts_with(root) {
        return None;
    }
    Some(normalized)
}

fn disk_spelling(root: &Path, scan: Option<&Scan>, path: String) -> String {
    if scan.is_some_and(|scan| scan.index.contains_key(&path)) {
        return path;
    }
    spelled_on_disk(root, &path).unwrap_or(path)
}

fn spelled_on_disk(root: &Path, relative: &str) -> Option<String> {
    let mut directory = root.to_path_buf();
    let mut parts = Vec::new();
    for part in relative.split('/') {
        let name = name_on_disk(&directory, part)?;
        directory.push(&name);
        parts.push(name);
    }
    Some(parts.join("/"))
}

fn name_on_disk(directory: &Path, wanted: &str) -> Option<String> {
    let names: Vec<String> = std::fs::read_dir(directory)
        .ok()?
        .flatten()
        .filter_map(|entry| entry.file_name().into_string().ok())
        .collect();
    if names.iter().any(|name| name == wanted) {
        return Some(wanted.to_owned());
    }
    [composed_name, folded_name].into_iter().find_map(|key| {
        let wanted = key(wanted);
        let mut matches = names.iter().filter(|name| key(name) == wanted);
        match (matches.next(), matches.next()) {
            (Some(only), None) => Some(only.clone()),
            _ => None,
        }
    })
}

fn composed_name(name: &str) -> String {
    name.nfc().collect()
}

fn folded_name(name: &str) -> String {
    composed_name(name).to_lowercase()
}

#[derive(Clone, Debug, Default)]
struct Facts {
    class: Option<String>,
    class_option: Option<String>,
    begin_document: bool,
    title: Option<String>,
    bibliography: bool,
    poster_package: bool,
    plain_tex: bool,
    library_like: bool,
    has_content: bool,
    references: Vec<String>,
    magic_root: Option<String>,
}

#[derive(Clone, Debug)]
struct Source {
    path: String,
    family: SourceFamily,
    depth: usize,
    placeholder: bool,
    facts: Facts,
}

fn read_facts(file: &Path, relative: &str, family: SourceFamily) -> Facts {
    let Some(head) = read_head(file) else {
        return Facts::default();
    };
    match family {
        SourceFamily::Latex => {
            let masked = mask_latex_comments(&head);
            let (class_option, class) = match document_class(&masked) {
                Some((option, class)) => (option, Some(class)),
                None => (None, None),
            };
            let plain_tex = class.is_none()
                && (has_plain_tex_end(&masked)
                    || read_tail(file)
                        .is_some_and(|tail| has_plain_tex_end(&mask_latex_comments(&tail))));
            Facts {
                class,
                class_option,
                begin_document: has_begin_document(&masked),
                title: latex_title(&masked),
                bibliography: has_bibliography(&masked),
                poster_package: masked.contains("beamerposter"),
                plain_tex,
                library_like: false,
                has_content: !masked.trim().is_empty(),
                references: latex_references(&masked).inputs,
                magic_root: tex_magic_comments(&head).root,
            }
        }
        SourceFamily::Typst => {
            let masked = mask_typst_comments(&head);
            Facts {
                title: typst_title(&masked),
                library_like: typst_library_like(&file_stem(relative), &masked),
                has_content: !masked.trim().is_empty(),
                references: typst_references(&masked),
                ..Facts::default()
            }
        }
        SourceFamily::Markdown => Facts {
            title: markdown_title(&head),
            has_content: !head.trim().is_empty(),
            references: markdown_references(&head),
            ..Facts::default()
        },
    }
}

fn file_stem(path: &str) -> String {
    let file = path.rsplit('/').next().unwrap_or(path);
    Path::new(file)
        .file_stem()
        .and_then(OsStr::to_str)
        .unwrap_or(file)
        .to_lowercase()
}

fn source_on_disk(root: &Path, relative: &str, options: &DetectOptions<'_>) -> Option<Source> {
    let family = SourceFamily::of(relative)?;
    let path = root.join(relative);
    let metadata = std::fs::symlink_metadata(&path).ok()?;
    if !metadata.is_file() {
        return None;
    }
    let placeholder = (options.placeholder)(&path, &metadata);
    Some(Source {
        path: relative.to_owned(),
        family,
        depth: relative.matches('/').count(),
        placeholder,
        facts: if placeholder {
            Facts::default()
        } else {
            read_facts(&path, relative, family)
        },
    })
}

struct Scan {
    sources: Vec<Source>,
    index: HashMap<String, usize>,
    folded: HashMap<String, Vec<usize>>,
    truncated: bool,
}

impl Scan {
    fn run(root: &Path, options: &DetectOptions<'_>) -> Result<Self> {
        let limits = options.limits;
        let started = Instant::now();
        let mut scan = Self {
            sources: Vec::new(),
            index: HashMap::new(),
            folded: HashMap::new(),
            truncated: false,
        };
        let mut entries = 0usize;
        let mut queue: VecDeque<(PathBuf, String, usize)> =
            VecDeque::from([(root.to_path_buf(), String::new(), 0)]);
        'walk: while let Some((directory, prefix, depth)) = queue.pop_front() {
            let budget = limits.max_entries.saturating_sub(entries);
            let (children, cut) =
                match list_directory(&directory, budget, || interrupted(options, started)) {
                    Ok(listing) => listing,
                    Err(error) if depth == 0 => {
                        return Err(Error::new(
                            ErrorKind::Io,
                            format!("cannot list {}: {error}", directory.display()),
                        ))
                    }
                    Err(_) => continue,
                };
            for entry in children {
                entries += 1;
                if entries > limits.max_entries
                    || interrupted(options, started)
                    || scan
                        .visit(&entry, &prefix, depth, options, &mut queue)
                        .is_break()
                {
                    scan.truncated = true;
                    break 'walk;
                }
            }
            if cut {
                scan.truncated = true;
                break;
            }
        }
        Ok(scan)
    }

    fn visit(
        &mut self,
        entry: &std::fs::DirEntry,
        prefix: &str,
        depth: usize,
        options: &DetectOptions<'_>,
        queue: &mut VecDeque<(PathBuf, String, usize)>,
    ) -> ControlFlow<()> {
        let limits = options.limits;
        let Ok(file_type) = entry.file_type() else {
            return ControlFlow::Continue(());
        };
        if file_type.is_symlink() {
            return ControlFlow::Continue(());
        }
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            return ControlFlow::Continue(());
        };
        let relative = if prefix.is_empty() {
            name.to_owned()
        } else {
            format!("{prefix}/{name}")
        };
        if file_type.is_dir() {
            if depth < limits.max_depth
                && !is_skipped_scan_directory(OsStr::new(name))
                && oleafly_manifest_in(&entry.path(), options).is_none()
            {
                queue.push_back((entry.path(), relative, depth + 1));
            }
            return ControlFlow::Continue(());
        }
        let Some(family) = SourceFamily::of(name) else {
            return ControlFlow::Continue(());
        };
        if !file_type.is_file() {
            return ControlFlow::Continue(());
        }
        if self.sources.len() >= limits.max_sources {
            return ControlFlow::Break(());
        }
        let path = entry.path();
        let placeholder = entry
            .metadata()
            .is_ok_and(|metadata| (options.placeholder)(&path, &metadata));
        let facts = if placeholder {
            Facts::default()
        } else {
            read_facts(&path, &relative, family)
        };
        self.push(Source {
            path: relative,
            family,
            depth,
            placeholder,
            facts,
        });
        ControlFlow::Continue(())
    }

    fn push(&mut self, source: Source) {
        let index = self.sources.len();
        self.index.insert(source.path.clone(), index);
        self.folded
            .entry(source.path.to_lowercase())
            .or_default()
            .push(index);
        self.sources.push(source);
    }

    fn lookup(&self, path: &str) -> Option<usize> {
        if let Some(&index) = self.index.get(path) {
            return Some(index);
        }
        match self.folded.get(&path.to_lowercase()).map(Vec::as_slice) {
            Some([only]) => Some(*only),
            _ => None,
        }
    }

    fn lookup_source(&self, path: &str) -> Option<usize> {
        self.lookup(path).or_else(|| {
            if has_extension(path) {
                return None;
            }
            SOURCE_SUFFIXES
                .iter()
                .find_map(|suffix| self.lookup(&format!("{path}{suffix}")))
        })
    }

    fn resolve(&self, from: &str, raw: &str) -> Option<usize> {
        let trimmed = raw.trim();
        if let Some(rooted) = trimmed.strip_prefix('/') {
            return resolve_in("", rooted).and_then(|path| self.lookup_source(&path));
        }
        resolve_project_path(from, trimmed, None)
            .and_then(|path| self.lookup_source(&path))
            .or_else(|| resolve_in("", trimmed).and_then(|path| self.lookup_source(&path)))
    }

    fn complete_split_documents(&mut self, graph: &Graph) {
        let completed: Vec<(usize, Facts)> = (0..self.sources.len())
            .filter_map(|index| {
                self.split_document_facts(graph, index)
                    .map(|facts| (index, facts))
            })
            .collect();
        for (index, facts) in completed {
            self.sources[index].facts = facts;
        }
    }

    fn split_document_facts(&self, graph: &Graph, index: usize) -> Option<Facts> {
        let source = &self.sources[index];
        if source.family != SourceFamily::Latex || source.placeholder || graph.referenced[index] {
            return None;
        }
        let mut facts = source.facts.clone();
        if facts
            .class
            .as_deref()
            .is_some_and(|class| !inheritable_class(class) || facts.begin_document)
        {
            return None;
        }
        let mut seen = vec![false; self.sources.len()];
        seen[index] = true;
        let mut queue = VecDeque::from([index]);
        while let Some(current) = queue.pop_front() {
            for &target in &graph.edges[current] {
                let included = &self.sources[target];
                let inherited = &included.facts;
                if seen[target]
                    || included.family != SourceFamily::Latex
                    || included.placeholder
                    || inherited
                        .class
                        .as_deref()
                        .is_some_and(|class| !inheritable_class(class))
                {
                    continue;
                }
                seen[target] = true;
                queue.push_back(target);
                if facts.class.is_none() && inherited.class.is_some() {
                    facts.class.clone_from(&inherited.class);
                    facts.class_option.clone_from(&inherited.class_option);
                }
                if facts.title.is_none() {
                    facts.title.clone_from(&inherited.title);
                }
                facts.begin_document |= inherited.begin_document;
                facts.bibliography |= inherited.bibliography;
                facts.poster_package |= inherited.poster_package;
            }
        }
        (facts.class.is_some() && facts.begin_document).then_some(facts)
    }

    fn ranked(&self, graph: &Graph, root_name: &str) -> Vec<Ranked> {
        let mut ranked: Vec<Ranked> = self
            .sources
            .iter()
            .enumerate()
            .filter_map(|(index, source)| {
                let tier = tier_of(source, graph.included[index])?;
                Some(Ranked::new(
                    source,
                    tier,
                    graph.outgoing[index],
                    root_name,
                    false,
                ))
            })
            .collect();
        ranked.sort_by(Ranked::compare);
        ranked
    }
}

fn list_directory(
    directory: &Path,
    budget: usize,
    mut stop: impl FnMut() -> bool,
) -> std::io::Result<(Vec<std::fs::DirEntry>, bool)> {
    let mut children = Vec::new();
    let mut cut = false;
    for entry in std::fs::read_dir(directory)? {
        if stop() {
            cut = true;
            break;
        }
        let Ok(entry) = entry else {
            continue;
        };
        if children.len() >= budget {
            cut = true;
            break;
        }
        children.push(entry);
    }
    children.sort_by_key(std::fs::DirEntry::file_name);
    Ok((children, cut))
}

fn interrupted(options: &DetectOptions<'_>, started: Instant) -> bool {
    options
        .cancel
        .is_some_and(|cancel| cancel.load(AtomicOrdering::Relaxed))
        || started.elapsed() >= options.limits.deadline
}

struct Graph {
    included: Vec<bool>,
    referenced: Vec<bool>,
    outgoing: Vec<usize>,
    edges: Vec<Vec<usize>>,
}

impl Graph {
    fn build(scan: &Scan) -> Self {
        let edges: Vec<Vec<usize>> = scan
            .sources
            .iter()
            .enumerate()
            .map(|(index, source)| {
                source
                    .facts
                    .references
                    .iter()
                    .filter_map(|raw| scan.resolve(&source.path, raw))
                    .filter(|&target| target != index)
                    .collect::<BTreeSet<usize>>()
                    .into_iter()
                    .collect()
            })
            .collect();
        let component = components(&edges);
        let mut included = vec![false; edges.len()];
        let mut referenced = vec![false; edges.len()];
        for (from, targets) in edges.iter().enumerate() {
            for &to in targets {
                referenced[to] = true;
                if component[from] != component[to] {
                    included[to] = true;
                }
            }
        }
        Self {
            outgoing: edges.iter().map(Vec::len).collect(),
            included,
            referenced,
            edges,
        }
    }
}

fn components(edges: &[Vec<usize>]) -> Vec<usize> {
    let count = edges.len();
    let mut visited = vec![false; count];
    let mut finished = Vec::with_capacity(count);
    for start in 0..count {
        if visited[start] {
            continue;
        }
        visited[start] = true;
        let mut stack = vec![(start, 0usize)];
        while let Some(top) = stack.len().checked_sub(1) {
            let (node, next) = stack[top];
            match edges[node].get(next) {
                Some(&target) => {
                    stack[top].1 += 1;
                    if !visited[target] {
                        visited[target] = true;
                        stack.push((target, 0));
                    }
                }
                None => {
                    finished.push(node);
                    stack.pop();
                }
            }
        }
    }
    let mut reverse = vec![Vec::new(); count];
    for (from, targets) in edges.iter().enumerate() {
        for &to in targets {
            reverse[to].push(from);
        }
    }
    let mut component = vec![usize::MAX; count];
    let mut next = 0usize;
    for &start in finished.iter().rev() {
        if component[start] != usize::MAX {
            continue;
        }
        component[start] = next;
        let mut stack = vec![start];
        while let Some(node) = stack.pop() {
            for &from in &reverse[node] {
                if component[from] == usize::MAX {
                    component[from] = next;
                    stack.push(from);
                }
            }
        }
        next += 1;
    }
    component
}

fn inheritable_class(class: &str) -> bool {
    !class.eq_ignore_ascii_case("subfiles") && !class.eq_ignore_ascii_case("standalone")
}

fn tier_of(source: &Source, included: bool) -> Option<Tier> {
    if included {
        return None;
    }
    if source.placeholder {
        return Some(Tier::W);
    }
    let facts = &source.facts;
    match source.family {
        SourceFamily::Latex => {
            let Some(class) = facts.class.as_deref() else {
                return facts.plain_tex.then_some(Tier::W);
            };
            if class.eq_ignore_ascii_case("subfiles") {
                return None;
            }
            if class.eq_ignore_ascii_case("standalone") || !facts.begin_document {
                return Some(Tier::W);
            }
            Some(Tier::S)
        }
        SourceFamily::Typst => (facts.has_content && !facts.library_like).then_some(Tier::A),
        SourceFamily::Markdown => (facts.has_content
            && !REPOSITORY_NOTES
                .contains(&file_stem(&source.path).split('.').next().unwrap_or("")))
        .then_some(Tier::M),
    }
}

fn latex_kind(class: &str, poster_package: bool) -> DocumentKind {
    let lower = class.to_ascii_lowercase();
    match lower.as_str() {
        "standalone" => DocumentKind::Standalone,
        "beamer" if poster_package => DocumentKind::Poster,
        "beamer" | "powerdot" | "prosper" | "seminar" | "slides" | "ctexbeamer" => {
            DocumentKind::Presentation
        }
        "book" | "report" | "memoir" | "scrbook" | "scrreprt" => DocumentKind::Book,
        _ if lower.contains("poster") => DocumentKind::Poster,
        _ if lower.contains("thesis") || lower.contains("dissertation") => DocumentKind::Book,
        _ => DocumentKind::Document,
    }
}

fn kind_of(source: &Source) -> DocumentKind {
    if source.placeholder {
        return DocumentKind::Unknown;
    }
    match source.family {
        SourceFamily::Latex => source
            .facts
            .class
            .as_deref()
            .map_or(DocumentKind::Unknown, |class| {
                latex_kind(class, source.facts.poster_package)
            }),
        SourceFamily::Typst => DocumentKind::Typst,
        SourceFamily::Markdown => DocumentKind::Markdown,
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum NameClass {
    Main,
    Folder,
    Thesis,
    Paper,
    Other,
}

fn squash(text: &str) -> String {
    text.chars()
        .filter(|character| !matches!(character, '_' | '-' | ' ' | '.'))
        .flat_map(char::to_lowercase)
        .collect()
}

fn name_class(path: &str, root_name: &str) -> NameClass {
    let (parent, file) = match path.rsplit_once('/') {
        Some((parent, file)) => (parent.rsplit('/').next().unwrap_or(parent), file),
        None => (root_name, path),
    };
    let stem = file_stem(file);
    if stem == "main" {
        return NameClass::Main;
    }
    let key = squash(&stem);
    if !key.is_empty() && key == squash(parent) {
        return NameClass::Folder;
    }
    match stem.as_str() {
        "thesis" | "dissertation" => NameClass::Thesis,
        "paper" | "article" | "manuscript" | "ms" => NameClass::Paper,
        _ => NameClass::Other,
    }
}

struct Ranked {
    candidate: Candidate,
    name: NameClass,
    kind_rank: u8,
    outgoing: usize,
    bibliography: bool,
    placeholder: bool,
}

impl Ranked {
    fn new(source: &Source, tier: Tier, outgoing: usize, root_name: &str, declared: bool) -> Self {
        let kind = kind_of(source);
        let name = name_class(&source.path, root_name);
        let mut reasons = Vec::new();
        if declared {
            reasons.push(Reason::Declared);
        }
        if source.placeholder {
            reasons.push(Reason::Placeholder);
        }
        if source.depth == 0 {
            reasons.push(Reason::TopLevel);
        }
        match name {
            NameClass::Main => reasons.push(Reason::NamedMain),
            NameClass::Folder => reasons.push(Reason::NamedAfterFolder),
            _ => {}
        }
        if outgoing > 0 {
            reasons.push(Reason::IncludesFiles);
        }
        if source.facts.bibliography {
            reasons.push(Reason::HasBibliography);
        }
        if tier == Tier::W && !source.placeholder {
            reasons.push(if kind == DocumentKind::Standalone {
                Reason::StandaloneFigure
            } else {
                Reason::NoBeginDocument
            });
        }
        Self {
            candidate: Candidate {
                path: source.path.clone(),
                family: source.family,
                tier,
                kind,
                class: source.facts.class.clone(),
                title: source.facts.title.clone(),
                depth: source.depth,
                reasons,
            },
            name,
            kind_rank: match kind {
                DocumentKind::Document
                | DocumentKind::Book
                | DocumentKind::Typst
                | DocumentKind::Markdown => 0,
                DocumentKind::Presentation | DocumentKind::Poster => 1,
                DocumentKind::Standalone | DocumentKind::Unknown => 2,
            },
            outgoing,
            bibliography: source.facts.bibliography,
            placeholder: source.placeholder,
        }
    }

    fn compare(left: &Self, right: &Self) -> Ordering {
        left.candidate
            .tier
            .cmp(&right.candidate.tier)
            .then(left.candidate.depth.cmp(&right.candidate.depth))
            .then(left.name.cmp(&right.name))
            .then(left.kind_rank.cmp(&right.kind_rank))
            .then(right.outgoing.cmp(&left.outgoing))
            .then(right.bibliography.cmp(&left.bibliography))
            .then_with(|| {
                left.candidate
                    .path
                    .to_lowercase()
                    .cmp(&right.candidate.path.to_lowercase())
            })
            .then_with(|| left.candidate.path.cmp(&right.candidate.path))
    }
}

fn automatic_choice(ranked: &[Ranked]) -> Option<usize> {
    let count = |tier: Tier| {
        ranked
            .iter()
            .filter(|ranked| ranked.candidate.tier == tier)
            .count()
    };
    let first = |tier: Tier| {
        ranked
            .iter()
            .position(|ranked| ranked.candidate.tier == tier)
    };
    match (
        count(Tier::S),
        count(Tier::A),
        count(Tier::M),
        count(Tier::W),
    ) {
        (1, _, _, _) => first(Tier::S),
        (strong, _, _, _) if strong > 1 => {
            let primary = &ranked[0];
            let secondary = ranked[1..strong].iter().all(|other| {
                matches!(
                    other.candidate.kind,
                    DocumentKind::Presentation | DocumentKind::Poster
                ) || other.candidate.depth > 0
            });
            (primary.candidate.depth == 0
                && primary.name <= NameClass::Paper
                && matches!(
                    primary.candidate.kind,
                    DocumentKind::Document | DocumentKind::Book
                )
                && secondary)
                .then_some(0)
        }
        (0, 1, _, _) => first(Tier::A),
        (0, 0, 1, _) => first(Tier::M).filter(|&index| {
            matches!(
                file_stem(&ranked[index].candidate.path).as_str(),
                "main" | "index" | "paper"
            )
        }),
        (0, 0, 0, 1) => first(Tier::W).filter(|&index| !ranked[index].placeholder),
        _ => None,
    }
}

fn root_main(
    root: &Path,
    scan: &Scan,
    graph: &Graph,
    options: &DetectOptions<'_>,
) -> Option<String> {
    ROOT_MAINS.iter().find_map(|name| {
        let scanned = scan
            .sources
            .iter()
            .position(|source| source.depth == 0 && source.path.eq_ignore_ascii_case(name));
        let (source, included) = match scanned {
            Some(index) => (scan.sources[index].clone(), graph.included[index]),
            None if scan.truncated => (source_on_disk(root, name, options)?, false),
            None => return None,
        };
        let expected = match source.family {
            SourceFamily::Latex => Tier::S,
            SourceFamily::Typst => Tier::A,
            SourceFamily::Markdown => Tier::M,
        };
        (!source.placeholder && tier_of(&source, included) == Some(expected)).then_some(source.path)
    })
}

struct Declaration {
    path: String,
    source: DetectionSource,
    votes: usize,
}

fn declarations(root: &Path, scan: &Scan, options: &DetectOptions<'_>) -> Vec<Declaration> {
    let mut found: Vec<Declaration> = Vec::new();
    let mut add = |path: Option<String>, source: DetectionSource| {
        let Some(path) = path.map(|path| disk_spelling(root, Some(scan), path)) else {
            return;
        };
        match found.iter_mut().find(|declared| declared.path == path) {
            Some(existing) => existing.votes += 1,
            None => found.push(Declaration {
                path,
                source,
                votes: 1,
            }),
        }
    };
    for name in ["latexmkrc", ".latexmkrc"] {
        for target in read_text(&root.join(name), options)
            .map(|text| latexmk_default_files(&text))
            .unwrap_or_default()
        {
            let target = resolve_project_path("", &target, Some(".tex"));
            add(
                target.and_then(|target| existing_source(root, &target, Some(SourceFamily::Latex))),
                DetectionSource::Latexmkrc,
            );
        }
    }
    for target in read_text(&root.join("00README.json"), options)
        .map(|text| arxiv_toplevel_sources(&text))
        .unwrap_or_default()
    {
        add(
            existing_source(root, &target, Some(SourceFamily::Latex)),
            DetectionSource::ArxivReadme,
        );
    }
    if let Some(target) = read_text(&root.join("typst.toml"), options)
        .and_then(|text| typst_template_entrypoint(&text))
    {
        add(
            existing_source(root, &target, Some(SourceFamily::Typst)),
            DetectionSource::TypstToml,
        );
    }
    for source in &scan.sources {
        let facts = &source.facts;
        if facts
            .class
            .as_deref()
            .is_some_and(|class| class.eq_ignore_ascii_case("subfiles"))
        {
            if let Some(option) = facts.class_option.as_deref() {
                let target = resolve_project_path(&source.path, option, Some(".tex"));
                add(
                    target.and_then(|target| {
                        existing_source(root, &target, Some(SourceFamily::Latex))
                    }),
                    DetectionSource::Subfiles,
                );
            }
        }
    }
    for source in &scan.sources {
        if let Some(target) = source.facts.magic_root.as_deref() {
            add(
                resolve_project_path(&source.path, target, None)
                    .and_then(|target| existing_source(root, &target, Some(SourceFamily::Latex))),
                DetectionSource::TexRoot,
            );
        }
    }
    found
}

fn decisive(declarations: &[Declaration], ranked: &[Ranked]) -> bool {
    if declarations.iter().any(|declaration| {
        matches!(
            declaration.source,
            DetectionSource::Latexmkrc | DetectionSource::ArxivReadme | DetectionSource::TypstToml
        )
    }) {
        return true;
    }
    let folders: Vec<&str> = declarations
        .iter()
        .map(|declaration| parent_of(&declaration.path))
        .collect();
    ranked
        .iter()
        .filter(|ranked| ranked.candidate.tier == Tier::S)
        .all(|ranked| {
            matches!(
                ranked.candidate.kind,
                DocumentKind::Presentation | DocumentKind::Poster
            ) || folders.iter().any(|folder| {
                folder.is_empty()
                    || ranked
                        .candidate
                        .path
                        .strip_prefix(folder)
                        .is_some_and(|rest| rest.starts_with('/'))
            })
        })
}

fn declared_choice(
    root: &Path,
    scan: &Scan,
    graph: &Graph,
    root_name: &str,
    declarations: &[Declaration],
    options: &DetectOptions<'_>,
    others: &[Ranked],
) -> Detection {
    let mut declared: Vec<(&Declaration, Ranked)> = declarations
        .iter()
        .filter_map(|declaration| {
            let (source, outgoing) = match scan.lookup(&declaration.path) {
                Some(index) => (scan.sources[index].clone(), graph.outgoing[index]),
                None => (source_on_disk(root, &declaration.path, options)?, 0),
            };
            let tier = tier_of(&source, false).unwrap_or(Tier::W);
            Some((
                declaration,
                Ranked::new(&source, tier, outgoing, root_name, true),
            ))
        })
        .collect();
    declared.sort_by(|(left_declared, left), (right_declared, right)| {
        right_declared
            .votes
            .cmp(&left_declared.votes)
            .then_with(|| Ranked::compare(left, right))
    });
    Detection {
        main: None,
        decision: Decision::Ask,
        source: declared
            .first()
            .map_or(DetectionSource::Scan, |(declaration, _)| declaration.source),
        candidates: declared
            .into_iter()
            .map(|(_, ranked)| ranked.candidate)
            .chain(
                others
                    .iter()
                    .filter(|other| {
                        !declarations
                            .iter()
                            .any(|declaration| declaration.path == other.candidate.path)
                    })
                    .map(|other| other.candidate.clone()),
            )
            .collect(),
        truncated: scan.truncated,
        compile_dir: None,
    }
}
