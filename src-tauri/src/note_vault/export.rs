use super::*;

pub(crate) fn safe_stem(title: &str) -> String {
    let stem = oleafly_core::portable::safe_stem(title, MAX_STEM_BYTES, " note");
    if stem.is_empty() {
        UNTITLED.to_string()
    } else {
        stem
    }
}

pub(super) fn safe_file_name(name: &str) -> String {
    let base = base_name(&name.replace('\\', "/")).to_string();
    let (stem, extension) = match base.rsplit_once('.') {
        Some((stem, extension)) if !stem.is_empty() => (stem.to_string(), extension.to_string()),
        _ => (base.clone(), String::new()),
    };
    let extension: String = extension
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .take(12)
        .collect::<String>()
        .to_ascii_lowercase();
    let stem = safe_stem(&stem);
    if extension.is_empty() {
        stem
    } else {
        format!("{stem}.{extension}")
    }
}

pub(super) fn numbered(name: &str, attempt: usize) -> String {
    if attempt <= 1 {
        return name.to_string();
    }
    match name.rsplit_once('.') {
        Some((stem, extension)) if !stem.is_empty() => format!("{stem} {attempt}.{extension}"),
        _ => format!("{name} {attempt}"),
    }
}

#[derive(Debug, Clone)]
pub(crate) struct ExportAsset {
    pub rel: String,
    pub path: PathBuf,
    pub original: Option<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct ExportNote {
    pub note_id: Option<String>,
    pub title: String,
    pub text: String,
    pub assets: Vec<ExportAsset>,
}

#[derive(Debug, Clone)]
pub(crate) struct OutsideNote {
    pub title: String,
    pub text: String,
}

pub(super) struct LinkTarget {
    pub(super) stem: String,
    pub(super) title: String,
    pub(super) headings: Vec<(String, String)>,
}

pub(super) struct ExportConversion<'a> {
    pub(super) targets: &'a HashMap<String, LinkTarget>,
    pub(super) assets: &'a HashMap<String, String>,
    pub(super) paper_links: &'a mut Vec<String>,
}

pub(super) fn wiki_safe(text: &str) -> String {
    text.replace("[[", "[")
        .replace("]]", "]")
        .replace('|', "-")
        .replace('\n', " ")
}

pub(super) fn note_destination(destination: &str) -> Option<(&str, Option<&str>)> {
    let trimmed = destination.trim();
    let head = trimmed.get(..NOTE_SCHEME.len())?;
    if !head.eq_ignore_ascii_case(NOTE_SCHEME) {
        return None;
    }
    let rest = &trimmed[NOTE_SCHEME.len()..];
    let (path, fragment) = match rest.split_once('#') {
        Some((path, fragment)) => (path, Some(fragment)),
        None => (rest, None),
    };
    let id = path.strip_suffix('/').unwrap_or(path);
    is_linkable_id(id).then_some((id, fragment.filter(|fragment| !fragment.is_empty())))
}

pub(super) fn asset_key(destination: &str) -> Option<String> {
    let decoded = percent_decode(destination.trim());
    let clean = decoded.strip_prefix("./").unwrap_or(&decoded);
    let path = normalize_path(clean)?;
    path.starts_with(&format!("{NOTE_ASSETS}/")).then_some(path)
}

impl ExportConversion<'_> {
    pub(super) fn body(&mut self, body: &str) -> String {
        let mut parts = Vec::new();
        for block in blocks(body) {
            match block {
                Block::Line(line) => {
                    let table = line.trim_start().starts_with('|');
                    parts.push(rewrite_inline(line, |token| match token {
                        Token::Link {
                            embed,
                            label,
                            destination,
                        } => self.link(*embed, label, destination, table),
                        Token::Wiki { .. } => None,
                    }));
                }
                Block::Fence {
                    open,
                    info,
                    lines,
                    close,
                } => parts.push(self.fence(open, info, &lines, close)),
            }
        }
        join_blocks(parts)
    }

    pub(super) fn fence(
        &self,
        open: &str,
        info: &str,
        lines: &[&str],
        close: Option<&str>,
    ) -> String {
        let mut out: Vec<String> = lines.iter().map(|line| (*line).to_string()).collect();
        let Some(asset) = fence_asset(info, lines) else {
            return fence_lines(open, &out, close);
        };
        let Some(name) = asset_key(&asset.value).and_then(|key| self.assets.get(&key)) else {
            return fence_lines(open, &out, close);
        };
        let filled = lines.iter().filter(|line| !line.trim().is_empty()).count();
        if is_notebook_info(info) && filled == 1 && close.is_some() {
            let indent = &open[..open.len() - open.trim_start().len()];
            return format!("{indent}![[{name}]]");
        }
        out[asset.at] = asset.replaced(&format!("{ATTACHMENTS}/{name}"));
        fence_lines(open, &out, close)
    }

    pub(super) fn link(
        &mut self,
        embed: bool,
        label: &str,
        destination: &str,
        table: bool,
    ) -> Option<String> {
        let pipe = if table { "\\|" } else { "|" };
        let bang = if embed { "!" } else { "" };
        let text = unescape(label).trim().to_string();
        if let Some((LinkKind::Project, id)) = parse_note_link(destination) {
            add_listed(self.paper_links, if text.is_empty() { id } else { text });
            return Some(label.to_string());
        }
        if let Some((id, fragment)) = note_destination(destination) {
            let target = self.targets.get(id)?;
            let heading = fragment.map(|fragment| {
                let slug = percent_decode(fragment);
                target
                    .headings
                    .iter()
                    .find(|(candidate, _)| *candidate == slug)
                    .map_or(slug, |(_, text)| text.clone())
            });
            let mut defaults = vec![target.stem.clone(), target.title.clone()];
            let link = match &heading {
                Some(heading) => {
                    defaults.push(format!("{} > {heading}", target.stem));
                    defaults.push(format!("{} > {heading}", target.title));
                    defaults.push(heading.clone());
                    format!("{}#{}", target.stem, wiki_safe(heading).replace('#', " "))
                }
                None => target.stem.clone(),
            };
            let alias = if text.is_empty() || defaults.contains(&text) {
                String::new()
            } else {
                format!("{pipe}{}", wiki_safe(&text))
            };
            return Some(format!("{bang}[[{link}{alias}]]"));
        }
        let key = asset_key(destination)?;
        let name = self.assets.get(&key)?;
        let defaults = [name.clone(), base_name(&key).to_string()];
        let alias = if text.is_empty() || defaults.contains(&text) {
            String::new()
        } else {
            format!("{pipe}{}", wiki_safe(&text))
        };
        Some(format!("{bang}[[{name}{alias}]]"))
    }
}

pub(super) fn create_new(path: &Path) -> std::io::Result<std::fs::File> {
    std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
}

pub(super) fn copy_new(from: &Path, to: &Path) -> std::io::Result<()> {
    let mut source = std::fs::File::open(from)?;
    let mut target = create_new(to)?;
    if let Err(error) = std::io::copy(&mut source, &mut target) {
        drop(target);
        let _ = std::fs::remove_file(to);
        return Err(error);
    }
    Ok(())
}

pub(super) fn reserve_note_files(
    selected: &[ExportNote],
    folder: &Path,
    created: &mut Vec<PathBuf>,
) -> Result<Vec<String>, String> {
    let mut stems = Vec::with_capacity(selected.len());
    let mut taken: HashSet<String> = HashSet::new();
    let mut next: HashMap<String, usize> = HashMap::new();
    for note in selected {
        let base = safe_stem(&note.title);
        let attempt = next.entry(fold(&base)).or_insert(1);
        let mut on_disk = 0;
        let chosen = loop {
            let candidate = numbered(&base, *attempt);
            *attempt += 1;
            if !taken.insert(fold(&candidate)) {
                continue;
            }
            let path = folder.join(format!("{candidate}.md"));
            match create_new(&path) {
                Ok(_) => {
                    created.push(path);
                    break candidate;
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                    on_disk += 1;
                    if on_disk >= MAX_NAME_ATTEMPTS {
                        return Err(AppError::new("notes.export_too_many_titles").into());
                    }
                }
                Err(error) => {
                    return Err(AppError::new("notes.export_write_failed")
                        .param("name", format!("{candidate}.md"))
                        .detail(error)
                        .into())
                }
            }
        };
        stems.push(chosen);
    }
    Ok(stems)
}

pub(super) struct ExportedAttachments {
    pub(super) folder: PathBuf,
    pub(super) names: HashSet<String>,
    pub(super) by_hash: HashMap<(String, String), String>,
    pub(super) next: HashMap<String, usize>,
    pub(super) copied: usize,
    pub(super) skipped: usize,
}

impl ExportedAttachments {
    pub(super) fn new(folder: PathBuf) -> Self {
        Self {
            folder,
            names: HashSet::new(),
            by_hash: HashMap::new(),
            next: HashMap::new(),
            copied: 0,
            skipped: 0,
        }
    }

    pub(super) fn place(
        &mut self,
        asset: &ExportAsset,
        created: &mut Vec<PathBuf>,
    ) -> Result<Option<String>, String> {
        let Some(sha) = crate::project::file_sha256(&asset.path) else {
            self.skipped += 1;
            return Ok(None);
        };
        let base = safe_file_name(asset.original.as_deref().unwrap_or(base_name(&asset.rel)));
        let key = (fold(&base), sha);
        if let Some(existing) = self.by_hash.get(&key) {
            return Ok(Some(existing.clone()));
        }
        let attempt = self.next.entry(key.0.clone()).or_insert(1);
        let mut on_disk = 0;
        loop {
            let candidate = numbered(&base, *attempt);
            *attempt += 1;
            if !self.names.insert(fold(&candidate)) {
                continue;
            }
            std::fs::create_dir_all(&self.folder).map_err(|error| {
                String::from(AppError::new("notes.export_attachments_failed").detail(error))
            })?;
            let target = self.folder.join(&candidate);
            match copy_new(&asset.path, &target) {
                Ok(()) => {
                    created.push(target);
                    self.by_hash.insert(key, candidate.clone());
                    self.copied += 1;
                    return Ok(Some(candidate));
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                    on_disk += 1;
                    if on_disk >= MAX_NAME_ATTEMPTS {
                        self.skipped += 1;
                        return Ok(None);
                    }
                }
                Err(error) => {
                    return Err(AppError::new("notes.export_copy_failed")
                        .param("name", candidate)
                        .detail(error)
                        .into())
                }
            }
        }
    }
}

pub(super) fn referenced_assets(text: &str) -> HashSet<String> {
    let mut keys = HashSet::new();
    for block in blocks(split_front_matter(text).body) {
        match block {
            Block::Line(line) => {
                rewrite_inline(line, |token| {
                    if let Token::Link { destination, .. } = token {
                        keys.extend(asset_key(destination));
                    }
                    None
                });
            }
            Block::Fence { info, lines, .. } => {
                if let Some(asset) = fence_asset(info, &lines) {
                    keys.extend(asset_key(&asset.value));
                }
            }
        }
    }
    keys
}

pub(crate) fn export_notes(
    selected: &[ExportNote],
    outside: &HashMap<String, OutsideNote>,
    folder: &Path,
) -> Result<ExportSummary, String> {
    let mut created = Vec::new();
    let exported = write_export(selected, outside, folder, &mut created);
    if exported.is_err() {
        for path in created.iter().rev() {
            let _ = std::fs::remove_file(path);
        }
        let _ = std::fs::remove_dir(folder.join(ATTACHMENTS));
    }
    exported
}

pub(super) fn write_export(
    selected: &[ExportNote],
    outside: &HashMap<String, OutsideNote>,
    folder: &Path,
    created: &mut Vec<PathBuf>,
) -> Result<ExportSummary, String> {
    let stems = reserve_note_files(selected, folder, created)?;
    let mut targets = HashMap::new();
    for (id, note) in outside {
        let split = split_front_matter(&note.text);
        targets.insert(
            id.clone(),
            LinkTarget {
                stem: safe_stem(&note.title),
                title: note.title.clone(),
                headings: headings(split.body),
            },
        );
    }
    for (note, stem) in selected.iter().zip(&stems) {
        if let Some(id) = &note.note_id {
            let split = split_front_matter(&note.text);
            targets.insert(
                id.clone(),
                LinkTarget {
                    stem: stem.clone(),
                    title: note.title.clone(),
                    headings: headings(split.body),
                },
            );
        }
    }
    let mut attachments = ExportedAttachments::new(folder.join(ATTACHMENTS));
    let mut paper_links = Vec::new();
    let mut written = 0usize;
    for (note, stem) in selected.iter().zip(&stems) {
        let referenced = referenced_assets(&note.text);
        let mut assets = HashMap::new();
        for asset in note
            .assets
            .iter()
            .filter(|asset| referenced.contains(&asset.rel))
        {
            if let Some(name) = attachments.place(asset, created)? {
                assets.insert(asset.rel.clone(), name);
            }
        }
        let mut conversion = ExportConversion {
            targets: &targets,
            assets: &assets,
            paper_links: &mut paper_links,
        };
        let (front, body) = exported_front_matter(&note.text);
        let text = format!("{front}{}", conversion.body(body));
        let name = format!("{stem}.md");
        std::fs::write(folder.join(&name), text).map_err(|error| {
            String::from(
                AppError::new("notes.export_write_failed")
                    .param("name", name.as_str())
                    .detail(error),
            )
        })?;
        written += 1;
    }
    Ok(ExportSummary {
        folder: folder.to_string_lossy().into_owned(),
        notes: written,
        attachments: attachments.copied,
        skipped: attachments.skipped,
        paper_links,
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct OriginName {
    #[serde(default)]
    pub(super) file_name: Option<String>,
    #[serde(default)]
    pub(super) source_path: Option<String>,
}

pub(super) fn origin_name(project_id: &str, rel: &str) -> Option<String> {
    let path = crate::sandbox::resolve_readable(project_id, &crate::project::note_origin_path(rel))
        .ok()?;
    let mut bytes = Vec::new();
    std::fs::File::open(path)
        .and_then(|file| file.take(MAX_ORIGIN_BYTES).read_to_end(&mut bytes))
        .ok()?;
    let origin: OriginName = serde_json::from_slice(&bytes).ok()?;
    origin
        .file_name
        .or(origin.source_path)
        .map(|name| base_name(&name.replace('\\', "/")).to_string())
        .filter(|name| !name.trim().is_empty())
}

pub(super) fn note_assets(project_id: &str) -> Vec<ExportAsset> {
    let Ok(dir) = crate::sandbox::resolve_readable(project_id, NOTE_ASSETS) else {
        return Vec::new();
    };
    let Ok(read) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut assets: Vec<ExportAsset> = read
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_str()?.to_string();
            let metadata = std::fs::symlink_metadata(entry.path()).ok()?;
            if name.starts_with('.') || !metadata.is_file() || metadata.file_type().is_symlink() {
                return None;
            }
            let rel = format!("{NOTE_ASSETS}/{name}");
            Some(ExportAsset {
                original: origin_name(project_id, &rel),
                path: entry.path(),
                rel,
            })
        })
        .collect();
    assets.sort_by(|left, right| left.rel.cmp(&right.rel));
    assets
}

pub(super) fn library_notes() -> Result<Vec<crate::project::ProjectInfo>, String> {
    Ok(crate::project::list_projects_blocking()?
        .into_iter()
        .filter(|project| project.kind == NOTE_KIND && !project.recovery_pending)
        .collect())
}

pub(super) fn read_note_text(project: &crate::project::ProjectInfo) -> Result<String, String> {
    crate::project::read_file_blocking(&project.id, &project.main_doc)
        .map(|text| normalize_text(&text))
}

pub(crate) fn collect_export(
    selection: Option<&str>,
) -> Result<(Vec<ExportNote>, HashMap<String, OutsideNote>), String> {
    let projects = library_notes()?;
    if let Some(id) = selection {
        if !projects.iter().any(|project| project.id == id) {
            return Err(AppError::new("notes.export_note_missing").into());
        }
    }
    let mut selected = Vec::new();
    for project in projects
        .iter()
        .filter(|project| selection.is_none_or(|id| project.id == id))
    {
        let text = match read_note_text(project) {
            Ok(text) => text,
            Err(error) if selection.is_some() => return Err(error),
            Err(error) => {
                let _ = crate::project::append_app_log(format!(
                    "Skipping note {:?} in the Markdown export: {error}",
                    project.id
                ));
                continue;
            }
        };
        let scanned = scan_note(project.id.clone(), project.name.clone(), &text);
        selected.push(ExportNote {
            note_id: scanned.note_id,
            title: project.name.clone(),
            assets: note_assets(&project.id),
            text,
        });
    }
    let mut outside = HashMap::new();
    if selection.is_none() {
        return Ok((selected, outside));
    }
    let wanted: HashSet<String> = selected
        .iter()
        .flat_map(|note| scan_note(String::new(), String::new(), &note.text).links)
        .filter(|link| link.kind == LinkKind::Note)
        .map(|link| link.id)
        .collect();
    if wanted.is_empty() {
        return Ok((selected, outside));
    }
    for listed in crate::note_links::note_links_blocking()? {
        if Some(listed.project_id.as_str()) == selection {
            continue;
        }
        let Some(note_id) = listed.note_id else {
            continue;
        };
        if !wanted.contains(&note_id) {
            continue;
        }
        let Some(project) = projects
            .iter()
            .find(|project| project.id == listed.project_id)
        else {
            continue;
        };
        if let Ok(text) = read_note_text(project) {
            outside.insert(
                note_id,
                OutsideNote {
                    title: project.name.clone(),
                    text,
                },
            );
        }
    }
    Ok((selected, outside))
}

pub(crate) fn create_export_folder(parent: &Path, name: &str) -> Result<PathBuf, String> {
    let parent = chosen_folder(parent, FolderUse::ExportParent)?;
    let base = safe_stem(name);
    for attempt in 1..=MAX_NAME_ATTEMPTS {
        let candidate = parent.join(numbered(&base, attempt));
        match std::fs::create_dir(&candidate) {
            Ok(()) => {
                return candidate.canonicalize().map_err(|error| {
                    String::from(AppError::new("notes.folder_unopenable").detail(error))
                });
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(AppError::new("notes.folder_create_failed")
                    .detail(error)
                    .into())
            }
        }
    }
    Err(AppError::new("notes.folder_no_free_name").into())
}
