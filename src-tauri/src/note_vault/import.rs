use super::*;

#[derive(Debug, Clone)]
pub(super) struct VaultFile {
    pub(super) rel: String,
    pub(super) path: PathBuf,
    pub(super) size: u64,
}

#[derive(Debug, Default)]
pub(super) struct Vault {
    pub(super) notes: Vec<VaultFile>,
    pub(super) files: Vec<VaultFile>,
    pub(super) skipped: usize,
    pub(super) skipped_notes: Vec<String>,
    pub(super) beside_only: bool,
}

impl Vault {
    pub(super) fn skip_note(&mut self, name: String) {
        self.skipped += 1;
        add_listed(&mut self.skipped_notes, name);
    }
}

pub(super) struct Lookup {
    pub(super) keys: Vec<String>,
    pub(super) exact: HashMap<String, usize>,
    pub(super) names: HashMap<String, Vec<usize>>,
}

impl Lookup {
    pub(super) fn new(keys: Vec<String>) -> Self {
        let mut exact = HashMap::new();
        let mut names: HashMap<String, Vec<usize>> = HashMap::new();
        for (index, key) in keys.iter().enumerate() {
            names
                .entry(base_name(key).to_string())
                .or_default()
                .push(index);
            exact.entry(key.clone()).or_insert(index);
        }
        Self { keys, exact, names }
    }

    pub(super) fn find(&self, key: &str, source_dir: &str) -> Option<usize> {
        if !source_dir.is_empty() {
            if let Some(found) = normalize_path(&format!("{source_dir}/{key}"))
                .and_then(|path| self.exact.get(&path))
            {
                return Some(*found);
            }
        }
        let path = normalize_path(key)?;
        if let Some(found) = self.exact.get(&path) {
            return Some(*found);
        }
        let suffix = format!("/{path}");
        let mut candidates = self
            .names
            .get(base_name(&path))?
            .iter()
            .copied()
            .filter(|&index| self.keys[index] == path || self.keys[index].ends_with(&suffix));
        let first = candidates.next()?;
        candidates.next().is_none().then_some(first)
    }

    pub(super) fn find_beside(&self, key: &str, source_dir: &str) -> Option<usize> {
        if source_dir.is_empty() {
            return self.exact.get(&normalize_path(key)?).copied();
        }
        let path = normalize_path(&format!("{source_dir}/{key}"))?;
        path.starts_with(&format!("{source_dir}/"))
            .then(|| self.exact.get(&path).copied())
            .flatten()
    }
}

pub(super) enum Target {
    Note(usize),
    File(usize),
}

pub(super) struct Lookups {
    pub(super) notes: Lookup,
    pub(super) files: Lookup,
    pub(super) beside_only: bool,
}

impl Lookups {
    pub(super) fn new(vault: &Vault) -> Self {
        let note_keys = vault
            .notes
            .iter()
            .map(|file| {
                let key = fold(&file.rel);
                key.strip_suffix(".md").unwrap_or(&key).to_string()
            })
            .collect();
        let file_keys = vault.files.iter().map(|file| fold(&file.rel)).collect();
        Self {
            notes: Lookup::new(note_keys),
            files: Lookup::new(file_keys),
            beside_only: vault.beside_only,
        }
    }

    pub(super) fn resolve(&self, raw: &str, source_dir: &str) -> Option<Target> {
        let cleaned = fold(&raw.trim().replace('\\', "/"));
        if cleaned.is_empty() {
            return None;
        }
        let note_key = cleaned.strip_suffix(".md").unwrap_or(&cleaned);
        if let Some(index) = self.notes.find(note_key, source_dir) {
            return Some(Target::Note(index));
        }
        if self.beside_only {
            return self
                .files
                .find_beside(&cleaned, source_dir)
                .map(Target::File);
        }
        self.files.find(&cleaned, source_dir).map(Target::File)
    }
}

pub(super) struct ImportShared {
    pub(super) hashes: RefCell<HashMap<usize, Option<String>>>,
    pub(super) reserved: RefCell<HashSet<usize>>,
    pub(super) planned: Cell<u64>,
    pub(super) budget: u64,
}

impl Default for ImportShared {
    fn default() -> Self {
        Self::with_budget(MAX_IMPORT_ATTACHMENT_BYTES)
    }
}

impl ImportShared {
    pub(super) fn with_budget(budget: u64) -> Self {
        Self {
            hashes: RefCell::new(HashMap::new()),
            reserved: RefCell::new(HashSet::new()),
            planned: Cell::new(0),
            budget,
        }
    }

    pub(super) fn hash(&self, index: usize, file: &VaultFile) -> Option<String> {
        if let Some(known) = self.hashes.borrow().get(&index) {
            return known.clone();
        }
        let sha = crate::project::file_sha256(&file.path);
        self.hashes.borrow_mut().insert(index, sha.clone());
        sha
    }

    pub(super) fn reserve(&self, index: usize, bytes: u64) -> bool {
        if self.reserved.borrow().contains(&index) {
            return true;
        }
        let total = self.planned.get().saturating_add(bytes);
        if total > self.budget {
            return false;
        }
        self.planned.set(total);
        self.reserved.borrow_mut().insert(index);
        true
    }
}

#[derive(Default)]
pub(super) struct AssetPlanner {
    pub(super) planned: HashMap<usize, Option<String>>,
    pub(super) taken: HashMap<String, (String, String)>,
    pub(super) copies: Vec<(usize, String)>,
    pub(super) skipped: usize,
}

impl AssetPlanner {
    pub(super) fn path_for(
        &mut self,
        shared: &ImportShared,
        files: &[VaultFile],
        index: usize,
    ) -> Option<String> {
        if let Some(known) = self.planned.get(&index) {
            return known.clone();
        }
        let planned = self.plan(shared, files, index);
        let path = planned.as_ref().map(|(path, _)| path.clone());
        match &planned {
            Some((path, true)) => self.copies.push((index, path.clone())),
            Some(_) => {}
            None => self.skipped += 1,
        }
        self.planned.insert(index, path.clone());
        path
    }

    pub(super) fn plan(
        &mut self,
        shared: &ImportShared,
        files: &[VaultFile],
        index: usize,
    ) -> Option<(String, bool)> {
        let file = &files[index];
        if file.size > MAX_ATTACHMENT_BYTES {
            return None;
        }
        let sha = shared.hash(index, file)?;
        let name = base_name(&file.rel);
        for attempt in 1..=99 {
            let path = crate::project::note_asset_path(name, &sha, attempt);
            match self.taken.get(&fold(&path)) {
                None => {
                    if !shared.reserve(index, file.size) {
                        return None;
                    }
                    self.taken.insert(fold(&path), (path.clone(), sha.clone()));
                    return Some((path, true));
                }
                Some((existing, hash)) if *hash == sha => {
                    return Some((existing.clone(), false));
                }
                Some(_) => {}
            }
        }
        None
    }
}

pub(super) struct ImportContext<'a> {
    pub(super) vault: &'a Vault,
    pub(super) lookups: &'a Lookups,
    pub(super) ids: &'a [Option<String>],
    pub(super) shared: &'a ImportShared,
}

pub(super) struct NoteConversion<'a> {
    pub(super) context: &'a ImportContext<'a>,
    pub(super) self_id: &'a str,
    pub(super) source_dir: String,
    pub(super) assets: AssetPlanner,
    pub(super) unresolved: usize,
    pub(super) not_copied: Vec<String>,
}

pub(super) enum LinkResult {
    Keep,
    Replace(String),
    Unresolved,
}

impl<'a> NoteConversion<'a> {
    pub(super) fn new(context: &'a ImportContext<'a>, self_id: &'a str, rel: &str) -> Self {
        let source_dir = rel
            .rsplit_once('/')
            .map_or(String::new(), |(dir, _)| fold(dir));
        Self {
            context,
            self_id,
            source_dir,
            assets: AssetPlanner::default(),
            unresolved: 0,
            not_copied: Vec::new(),
        }
    }

    pub(super) fn missed_file(&mut self, target: &str) {
        let target = target.trim();
        if !self.context.lookups.beside_only
            || is_markdown(base_name(target))
            || extension_of(base_name(target)).is_none()
        {
            return;
        }
        if !self.not_copied.iter().any(|known| known == target) {
            self.not_copied.push(target.to_string());
        }
    }

    pub(super) fn body(&mut self, body: &str) -> String {
        let mut parts = Vec::new();
        for block in blocks(body) {
            match block {
                Block::Line(line) => parts.push(self.line(line)),
                Block::Fence {
                    open,
                    info,
                    lines,
                    close,
                } => {
                    let rewritten = self.asset_fence(info, &lines);
                    parts.push(fence_lines(open, &rewritten, close));
                }
            }
        }
        join_blocks(parts)
    }

    pub(super) fn asset_fence(&mut self, info: &str, lines: &[&str]) -> Vec<String> {
        let mut out: Vec<String> = lines.iter().map(|line| (*line).to_string()).collect();
        let Some(asset) = fence_asset(info, lines) else {
            return out;
        };
        if !relative_destination(&asset.value) {
            return out;
        }
        let decoded = percent_decode(&asset.value);
        match self.file_path(&decoded) {
            Some(path) => out[asset.at] = asset.replaced(&path),
            None => {
                self.unresolved += 1;
                self.missed_file(&decoded);
            }
        }
        out
    }

    pub(super) fn file_path(&mut self, raw: &str) -> Option<String> {
        match self.context.lookups.resolve(raw, &self.source_dir)? {
            Target::File(index) => {
                self.assets
                    .path_for(self.context.shared, &self.context.vault.files, index)
            }
            Target::Note(_) => None,
        }
    }

    pub(super) fn notebook_line(&mut self, line: &str) -> Option<String> {
        let trimmed = line.trim();
        let indent = &line[..line.len() - line.trim_start().len()];
        let target = if let Some(inner) = trimmed
            .strip_prefix("![[")
            .and_then(|rest| rest.strip_suffix("]]"))
        {
            let (target, _) = split_wiki(inner);
            split_fragment(target).0.to_string()
        } else {
            if !trimmed.starts_with("![") {
                return None;
            }
            let (
                Token::Link {
                    embed: true,
                    destination,
                    ..
                },
                end,
            ) = token_at(trimmed, 1, true, &LineMarks::of(trimmed))?
            else {
                return None;
            };
            if end != trimmed.len() || !relative_destination(&destination) {
                return None;
            }
            percent_decode(&destination)
        };
        if !is_notebook(&target) {
            return None;
        }
        let Some(Target::File(index)) = self.context.lookups.resolve(&target, &self.source_dir)
        else {
            return None;
        };
        let path = self
            .assets
            .path_for(self.context.shared, &self.context.vault.files, index)?;
        Some(format!(
            "{indent}```{NOTEBOOK_INFO}\n{indent}{path}\n{indent}```"
        ))
    }

    pub(super) fn line(&mut self, line: &str) -> String {
        if let Some(fence) = self.notebook_line(line) {
            return fence;
        }
        let mut unresolved = 0;
        let rewritten = rewrite_inline(line, |token| {
            let result = match token {
                Token::Wiki { embed, inner } => self.wiki(*embed, inner),
                Token::Link {
                    embed,
                    label,
                    destination,
                } => self.markdown_link(*embed, label, destination),
            };
            match result {
                LinkResult::Keep => None,
                LinkResult::Replace(text) => Some(text),
                LinkResult::Unresolved => {
                    unresolved += 1;
                    None
                }
            }
        });
        self.unresolved += unresolved;
        rewritten
    }

    pub(super) fn note_link(
        embed: bool,
        text: &str,
        id: &str,
        fragment: Option<&LinkFragment>,
    ) -> String {
        let fragment = fragment.map(LinkFragment::href).unwrap_or_default();
        let label = escape_label(text);
        let label = if label.starts_with('^') {
            format!("\\{label}")
        } else {
            label
        };
        format!(
            "{}[{label}]({NOTE_SCHEME}{id}{fragment})",
            if embed { "!" } else { "" }
        )
    }

    pub(super) fn note_id(&self, index: usize) -> Option<&str> {
        self.context.ids.get(index)?.as_deref()
    }

    pub(super) fn wiki(&mut self, embed: bool, inner: &str) -> LinkResult {
        let (target, alias) = split_wiki(inner);
        let alias = alias.filter(|alias| !alias.is_empty());
        let (name, fragment) = split_fragment(target);
        let fragment = link_fragment(fragment);
        if name.is_empty() {
            let Some(fragment) = fragment else {
                return LinkResult::Unresolved;
            };
            let text = alias.map_or_else(|| fragment.label(), str::to_string);
            return LinkResult::Replace(Self::note_link(
                embed,
                &text,
                self.self_id,
                Some(&fragment),
            ));
        }
        match self.context.lookups.resolve(name, &self.source_dir) {
            Some(Target::Note(index)) => {
                let Some(id) = self.note_id(index).map(str::to_string) else {
                    return LinkResult::Unresolved;
                };
                let shown = display_name(name);
                let text = match (alias, &fragment) {
                    (Some(alias), _) => alias.to_string(),
                    (None, Some(fragment)) => format!("{shown} > {}", fragment.label()),
                    (None, None) => shown,
                };
                LinkResult::Replace(Self::note_link(embed, &text, &id, fragment.as_ref()))
            }
            Some(Target::File(index)) => {
                let Some(path) =
                    self.assets
                        .path_for(self.context.shared, &self.context.vault.files, index)
                else {
                    self.missed_file(name);
                    return LinkResult::Unresolved;
                };
                let written = base_name(name).to_string();
                let text = alias
                    .filter(|alias| !size_alias(alias))
                    .map_or(written, str::to_string);
                let image = embed && is_image(name);
                LinkResult::Replace(format!(
                    "{}[{}]({path})",
                    if image { "!" } else { "" },
                    escape_label(&text)
                ))
            }
            None => {
                self.missed_file(name);
                LinkResult::Unresolved
            }
        }
    }

    pub(super) fn markdown_link(
        &mut self,
        embed: bool,
        label: &str,
        destination: &str,
    ) -> LinkResult {
        if !relative_destination(destination) {
            return LinkResult::Keep;
        }
        let decoded = percent_decode(destination);
        let (path, fragment) = split_fragment(&decoded);
        if path.is_empty() {
            return LinkResult::Keep;
        }
        match self.context.lookups.resolve(path, &self.source_dir) {
            Some(Target::Note(index)) => {
                let Some(id) = self.note_id(index).map(str::to_string) else {
                    return LinkResult::Unresolved;
                };
                let fragment = link_fragment(fragment)
                    .map(|fragment| fragment.href())
                    .unwrap_or_default();
                LinkResult::Replace(format!(
                    "{}[{label}]({NOTE_SCHEME}{id}{fragment})",
                    if embed { "!" } else { "" }
                ))
            }
            Some(Target::File(index)) => {
                let Some(asset) =
                    self.assets
                        .path_for(self.context.shared, &self.context.vault.files, index)
                else {
                    self.missed_file(path);
                    return LinkResult::Unresolved;
                };
                let image = embed && is_image(path);
                let label = if label.trim().is_empty() && !image {
                    escape_label(base_name(path))
                } else {
                    label.to_string()
                };
                LinkResult::Replace(format!(
                    "{}[{label}]({asset})",
                    if image { "!" } else { "" }
                ))
            }
            None => {
                self.missed_file(path);
                LinkResult::Unresolved
            }
        }
    }
}

pub(super) fn reparse_allows_import(class: std::io::Result<crate::paths::ReparseClass>) -> bool {
    matches!(
        class,
        Ok(crate::paths::ReparseClass::None | crate::paths::ReparseClass::Cloud)
    )
}

pub(super) fn imports_entry(path: &Path, metadata: &std::fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return false;
    }
    !crate::paths::is_reparse_point(metadata)
        || reparse_allows_import(crate::paths::reparse_class(path))
}

pub(super) fn scan_vault(root: &Path, cancel: &AtomicBool) -> Result<Option<Vault>, String> {
    scan_vault_within(root, cancel, MAX_ENTRIES)
}

type VaultFolder = (PathBuf, String, usize);

fn read_vault_folder(
    dir: &Path,
    top: bool,
    vault: &mut Vault,
) -> Result<Option<std::fs::ReadDir>, String> {
    match std::fs::read_dir(dir) {
        Ok(read) => Ok(Some(read)),
        Err(error) if top => Err(AppError::new("notes.import_folder_unreadable")
            .detail(error)
            .into()),
        Err(_) => {
            vault.skipped += 1;
            Ok(None)
        }
    }
}

fn scan_vault_entry(
    vault: &mut Vault,
    stack: &mut Vec<VaultFolder>,
    entry: &std::fs::DirEntry,
    prefix: &str,
    depth: usize,
) {
    let name = entry.file_name().to_string_lossy().into_owned();
    if name.starts_with('.') {
        return;
    }
    let Ok(metadata) = std::fs::symlink_metadata(entry.path()) else {
        return;
    };
    if !imports_entry(&entry.path(), &metadata) {
        return;
    }
    let rel = if prefix.is_empty() {
        name.clone()
    } else {
        format!("{prefix}/{name}")
    };
    if metadata.is_dir() {
        if depth < MAX_DEPTH {
            stack.push((entry.path(), rel, depth + 1));
        }
        return;
    }
    if !metadata.is_file() {
        return;
    }
    let file = VaultFile {
        rel,
        path: entry.path(),
        size: metadata.len(),
    };
    if !is_markdown(&name) {
        vault.files.push(file);
    } else if file.size > MAX_NOTE_BYTES {
        vault.skip_note(file.rel);
    } else {
        vault.notes.push(file);
    }
}

pub(super) fn scan_vault_within(
    root: &Path,
    cancel: &AtomicBool,
    max_entries: usize,
) -> Result<Option<Vault>, String> {
    let mut vault = Vault::default();
    let mut stack: Vec<VaultFolder> = vec![(root.to_path_buf(), String::new(), 0usize)];
    let mut entries = 0usize;
    while let Some((dir, prefix, depth)) = stack.pop() {
        if cancel.load(Ordering::SeqCst) {
            return Ok(None);
        }
        let Some(read) = read_vault_folder(&dir, prefix.is_empty(), &mut vault)? else {
            continue;
        };
        for entry in read.flatten() {
            entries += 1;
            if entries > max_entries {
                return Err(AppError::new("notes.import_too_many_files").into());
            }
            scan_vault_entry(&mut vault, &mut stack, &entry, &prefix, depth);
        }
    }
    vault.notes.sort_by(|left, right| left.rel.cmp(&right.rel));
    vault.files.sort_by(|left, right| left.rel.cmp(&right.rel));
    Ok(Some(vault))
}

pub(super) fn common_folder(paths: &[PathBuf]) -> Option<PathBuf> {
    let mut parents = paths.iter().filter_map(|path| path.parent());
    let first = parents.next()?.to_path_buf();
    Some(parents.fold(first, |common, parent| {
        let mut shared = PathBuf::new();
        for (left, right) in common.components().zip(parent.components()) {
            if left != right {
                break;
            }
            shared.push(left.as_os_str());
        }
        shared
    }))
}

pub(super) fn relative_name(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .components()
        .map(|part| part.as_os_str().to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join("/")
}

pub(super) fn collect_attachments(
    vault: &mut Vault,
    root: &Path,
    dir: &Path,
    depth: usize,
    entries: &mut usize,
    cancel: &AtomicBool,
) -> bool {
    if cancel.load(Ordering::SeqCst) {
        return false;
    }
    let Ok(read) = std::fs::read_dir(dir) else {
        vault.skipped += 1;
        return true;
    };
    for entry in read.flatten() {
        if *entries >= MAX_ENTRIES {
            vault.skipped += 1;
            return true;
        }
        *entries += 1;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let Ok(metadata) = std::fs::symlink_metadata(entry.path()) else {
            continue;
        };
        if !imports_entry(&entry.path(), &metadata) {
            continue;
        }
        if metadata.is_dir() {
            if depth < FILE_IMPORT_DEPTH
                && !collect_attachments(vault, root, &entry.path(), depth + 1, entries, cancel)
            {
                return false;
            }
        } else if metadata.is_file() && (is_image(&name) || is_notebook(&name)) {
            vault.files.push(VaultFile {
                rel: relative_name(root, &entry.path()),
                path: entry.path(),
                size: metadata.len(),
            });
        }
    }
    true
}

pub(super) fn scan_files(picked: &[PathBuf], cancel: &AtomicBool) -> Result<Option<Vault>, String> {
    let mut vault = Vault {
        beside_only: true,
        ..Vault::default()
    };
    let mut notes: Vec<(PathBuf, u64)> = Vec::new();
    for path in picked {
        let picked_name = path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default();
        let Ok(canonical) = path.canonicalize() else {
            vault.skip_note(picked_name);
            continue;
        };
        refuse_library_files(&canonical)?;
        let name = canonical
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default();
        let Ok(metadata) = std::fs::metadata(&canonical) else {
            vault.skip_note(picked_name);
            continue;
        };
        if !metadata.is_file() || !is_markdown(&name) || metadata.len() > MAX_NOTE_BYTES {
            vault.skip_note(picked_name);
            continue;
        }
        if !notes.iter().any(|(seen, _)| seen == &canonical) {
            notes.push((canonical, metadata.len()));
        }
    }
    let paths: Vec<PathBuf> = notes.iter().map(|(path, _)| path.clone()).collect();
    let Some(root) = common_folder(&paths) else {
        return Ok(Some(vault));
    };
    let mut folders: Vec<PathBuf> = Vec::new();
    for (path, size) in notes {
        if let Some(parent) = path.parent() {
            if !folders.iter().any(|folder| folder == parent) {
                folders.push(parent.to_path_buf());
            }
        }
        vault.notes.push(VaultFile {
            rel: relative_name(&root, &path),
            path,
            size,
        });
    }
    let mut entries = 0usize;
    for folder in &folders {
        if !collect_attachments(&mut vault, &root, folder, 0, &mut entries, cancel) {
            return Ok(None);
        }
    }
    vault.notes.sort_by(|left, right| left.rel.cmp(&right.rel));
    vault.files.sort_by(|left, right| left.rel.cmp(&right.rel));
    vault.files.dedup_by(|left, right| left.rel == right.rel);
    Ok(Some(vault))
}

pub(super) fn read_markdown(file: &VaultFile) -> Option<String> {
    let mut bytes = Vec::new();
    std::fs::File::open(&file.path)
        .and_then(|handle| handle.take(MAX_NOTE_BYTES + 1).read_to_end(&mut bytes))
        .ok()?;
    if bytes.len() as u64 > MAX_NOTE_BYTES {
        return None;
    }
    decode_text(bytes).map(|text| normalize_text(&text))
}

pub(super) struct ReadNote {
    pub(super) file: usize,
    pub(super) id: String,
    pub(super) title: String,
    pub(super) full_title: String,
    pub(super) text: String,
}

pub(super) fn cancelled_report(created: Vec<String>, skipped: usize) -> ImportReport {
    ImportReport {
        summary: ImportSummary {
            skipped,
            cancelled: true,
            ..ImportSummary::default()
        },
        created,
        ..ImportReport::default()
    }
}

#[derive(Debug, Clone, Default)]
pub(crate) struct CreatedNotes {
    pub(super) ids: Arc<Mutex<Vec<String>>>,
    pub(super) journal: Option<PathBuf>,
}

impl CreatedNotes {
    pub(super) fn recorded(run_id: &str, root: &Path) -> Result<Self, String> {
        let dir = journal_dir()?;
        std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
        let journal = dir.join(run_id);
        std::fs::write(&journal, format!("{}\n", folder_key(root)))
            .map_err(|error| error.to_string())?;
        Ok(Self {
            ids: Arc::default(),
            journal: Some(journal),
        })
    }

    pub(super) fn push(&self, project_id: &str) {
        self.ids
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(project_id.to_string());
        if let Some(journal) = &self.journal {
            let _ = std::fs::OpenOptions::new()
                .append(true)
                .open(journal)
                .and_then(|mut file| {
                    std::io::Write::write_all(&mut file, format!("{project_id}\n").as_bytes())
                });
        }
    }

    pub(super) fn take(&self) -> Vec<String> {
        std::mem::take(&mut *self.ids.lock().unwrap_or_else(PoisonError::into_inner))
    }

    pub(super) fn close(&self) {
        if let Some(journal) = &self.journal {
            let _ = std::fs::remove_file(journal);
        }
    }
}

pub(super) struct PlannedNote {
    pub(super) file: usize,
    pub(super) title: String,
    pub(super) source: String,
    pub(super) unresolved: usize,
    pub(super) skipped: usize,
    pub(super) copies: Vec<(usize, String)>,
    pub(super) not_copied: Vec<String>,
}

pub(super) fn size_text(bytes: u64) -> String {
    format!("{:.1}", bytes as f64 / 1_000_000_000.0)
}

pub(super) fn room_for(needed: u64, available: u64) -> Result<(), String> {
    let wanted = needed.saturating_add(KEEP_FREE_BYTES);
    if available >= wanted {
        return Ok(());
    }
    Err(AppError::new("notes.import_no_space")
        .param("size", size_text(wanted))
        .into())
}

pub(super) fn disk_room(needed: u64) -> Result<(), String> {
    let target = crate::paths::projects_root()?;
    match fs4::available_space(&target) {
        Ok(available) => room_for(needed, available),
        Err(_) => Ok(()),
    }
}

pub(super) fn import_vault_with(
    root: &Path,
    options: ImportOptions,
    cancel: &AtomicBool,
    progress: &mut dyn FnMut(ImportProgress),
    room: &dyn Fn(u64) -> Result<(), String>,
    journal: &CreatedNotes,
) -> Result<ImportReport, String> {
    let Some(vault) = scan_vault(root, cancel)? else {
        return Ok(cancelled_report(Vec::new(), 0));
    };
    import_scanned(vault, options, cancel, progress, room, journal)
}

pub(super) fn import_files_with(
    files: &[PathBuf],
    options: ImportOptions,
    cancel: &AtomicBool,
    progress: &mut dyn FnMut(ImportProgress),
    room: &dyn Fn(u64) -> Result<(), String>,
    journal: &CreatedNotes,
) -> Result<ImportReport, String> {
    let Some(vault) = scan_files(files, cancel)? else {
        return Ok(cancelled_report(Vec::new(), 0));
    };
    import_scanned(vault, options, cancel, progress, room, journal)
}

fn read_vault_notes(
    vault: &mut Vault,
    ids: &mut [Option<String>],
    cancel: &AtomicBool,
    progress: &mut dyn FnMut(ImportProgress),
) -> Option<Vec<ReadNote>> {
    let total = ids.len();
    let mut read = Vec::with_capacity(total);
    for (index, slot) in ids.iter_mut().enumerate() {
        if cancel.load(Ordering::SeqCst) {
            return None;
        }
        let rel = vault.notes[index].rel.clone();
        match read_markdown(&vault.notes[index]) {
            Some(text) => {
                let split = split_front_matter(&text);
                let full_title = full_note_title(split.lines.as_deref(), split.body, &rel);
                let title = note_title(split.lines.as_deref(), split.body, &rel);
                let id = new_note_id();
                *slot = Some(id.clone());
                read.push(ReadNote {
                    file: index,
                    id,
                    title,
                    full_title,
                    text,
                });
            }
            None => vault.skip_note(rel.clone()),
        }
        progress(ImportProgress {
            phase: ImportPhase::Read,
            done: index + 1,
            total,
            file: rel,
        });
    }
    Some(read)
}

fn copy_note_attachments(
    vault: &Vault,
    project_id: &str,
    copies: &[(usize, String)],
    report: &mut ImportReport,
    skipped: &mut usize,
) -> Vec<(String, String)> {
    let mut moved = Vec::new();
    for (index, planned) in copies {
        let attachment = &vault.files[*index];
        match crate::project::import_file_into_note(project_id, &attachment.path) {
            Ok(copy) => {
                if !copy.reused {
                    report.summary.attachments += 1;
                }
                if copy.path != *planned {
                    moved.push((planned.clone(), copy.path));
                }
            }
            Err(_) => {
                *skipped += 1;
                add_listed(&mut report.summary.not_copied, attachment.rel.clone());
            }
        }
    }
    moved
}

pub(super) fn import_scanned(
    mut vault: Vault,
    options: ImportOptions,
    cancel: &AtomicBool,
    progress: &mut dyn FnMut(ImportProgress),
    room: &dyn Fn(u64) -> Result<(), String>,
    journal: &CreatedNotes,
) -> Result<ImportReport, String> {
    let total = vault.notes.len();
    if options.confirm_above.is_some_and(|limit| total > limit) {
        return Ok(ImportReport {
            confirm: Some(total),
            ..ImportReport::default()
        });
    }
    let mut ids: Vec<Option<String>> = vec![None; total];
    let Some(read) = read_vault_notes(&mut vault, &mut ids, cancel, progress) else {
        return Ok(cancelled_report(Vec::new(), vault.skipped));
    };
    let mut skipped = vault.skipped;
    let skipped_notes = std::mem::take(&mut vault.skipped_notes);
    let lookups = Lookups::new(&vault);
    let shared = ImportShared::default();
    let context = ImportContext {
        vault: &vault,
        lookups: &lookups,
        ids: &ids,
        shared: &shared,
    };
    let mut plans = Vec::with_capacity(read.len());
    for note in read {
        if cancel.load(Ordering::SeqCst) {
            return Ok(cancelled_report(Vec::new(), skipped));
        }
        let file = &vault.notes[note.file];
        let split = split_front_matter(&note.text);
        let mut conversion = NoteConversion::new(&context, &note.id, &file.rel);
        let body = conversion.body(split.body);
        let tag = options.folder_tags.then(|| folder_tag(&file.rel)).flatten();
        let source = imported_source(
            split.lines.as_deref(),
            &note.full_title,
            &note.id,
            tag.as_deref(),
            &body,
        );
        plans.push(PlannedNote {
            file: note.file,
            title: note.title,
            source,
            unresolved: conversion.unresolved,
            skipped: conversion.assets.skipped,
            copies: std::mem::take(&mut conversion.assets.copies),
            not_copied: std::mem::take(&mut conversion.not_copied),
        });
    }
    let needed = plans
        .iter()
        .map(|plan| {
            let attachments: u64 = plan
                .copies
                .iter()
                .map(|(index, _)| vault.files[*index].size)
                .sum();
            plan.source.len() as u64 + attachments
        })
        .sum();
    room(needed)?;
    let mut report = ImportReport::default();
    report.summary.skipped_notes = skipped_notes;
    let count = plans.len();
    for (done, plan) in plans.into_iter().enumerate() {
        if cancel.load(Ordering::SeqCst) {
            return Ok(cancelled_report(report.created, skipped));
        }
        let file = &vault.notes[plan.file];
        let source = plan.source;
        let project_id =
            match crate::project::create_note_project_from(plan.title, source.clone(), None) {
                Ok(project_id) => project_id,
                Err(error) => {
                    report.error = Some(error);
                    return Ok(report);
                }
            };
        journal.push(&project_id);
        report.created.push(project_id.clone());
        report.summary.notes += 1;
        report.summary.unresolved += plan.unresolved;
        skipped += plan.skipped;
        for target in plan.not_copied {
            add_listed(&mut report.summary.not_copied, target);
        }
        let moved =
            copy_note_attachments(&vault, &project_id, &plan.copies, &mut report, &mut skipped);
        if !moved.is_empty() {
            let fixed = retarget_assets(&source, &moved);
            let written = crate::sandbox::resolve_readable(&project_id, crate::project::NOTE_FILE)
                .and_then(|target| crate::sandbox::atomic_write(&target, fixed.as_bytes()));
            if let Err(error) = written {
                report.error = Some(error);
                return Ok(report);
            }
        }
        progress(ImportProgress {
            phase: ImportPhase::Write,
            done: done + 1,
            total: count,
            file: file.rel.clone(),
        });
    }
    report.summary.skipped = skipped;
    Ok(report)
}

pub(super) fn retarget_assets(source: &str, moved: &[(String, String)]) -> String {
    let actual = |destination: &str| {
        moved
            .iter()
            .find(|(planned, _)| planned == destination)
            .map(|(_, actual)| actual.as_str())
    };
    let split = split_front_matter(source);
    let head = &source[..source.len() - split.body.len()];
    let mut parts = Vec::new();
    for block in blocks(split.body) {
        match block {
            Block::Line(line) => parts.push(rewrite_inline(line, |token| match token {
                Token::Link {
                    embed,
                    label,
                    destination,
                } => actual(destination)
                    .map(|path| format!("{}[{label}]({path})", if *embed { "!" } else { "" })),
                Token::Wiki { .. } => None,
            })),
            Block::Fence {
                open,
                info,
                lines,
                close,
            } => {
                let mut out: Vec<String> = lines.iter().map(|line| (*line).to_string()).collect();
                if let Some(asset) = fence_asset(info, &lines) {
                    if let Some(path) = actual(&asset.value) {
                        out[asset.at] = asset.replaced(path);
                    }
                }
                parts.push(fence_lines(open, &out, close));
            }
        }
    }
    format!("{head}{}", join_blocks(parts))
}
