//! Files attached to a CLI-agent message. Agents read files themselves, so
//! a stored attachment is copied into `<project>/.oleafly/attachments/
//! <session>/` and linked; project files are linked in place. Small text
//! files are also embedded for agents that take embedded context.
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

use oleafly_acp::prompt::{EmbeddedText, ImagePrompt, ResourceLink, MAX_ATTACHMENTS};

use super::types::Capabilities;

const MAX_COPY_BYTES: usize = 32 * 1024 * 1024;
const MAX_EMBEDDED_TEXT: usize = 64 * 1024;
const MAX_NAME: usize = 120;
const MAX_SELECTION: usize = 64 * 1024;

#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum PromptFile {
    /// A file in Oleafly's attachment store (dropped or pasted files).
    Stored {
        sha256: String,
        name: String,
        mime: String,
    },
    /// A file of the project, by project-relative path.
    Project { path: String },
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromptSelection {
    pub path: Option<String>,
    pub text: String,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct PromptInput {
    pub text: String,
    pub images: Vec<ImagePrompt>,
    pub files: Vec<PromptFile>,
    pub selections: Vec<PromptSelection>,
    pub skill_id: Option<String>,
}

/// What the `user_message` event keeps about a file: never bytes or paths
/// outside the project.
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileNote {
    pub name: String,
    pub mime: Option<String>,
    pub size: Option<u64>,
}

pub(super) fn attachment_dir(root: &Path, session_id: &str) -> PathBuf {
    root.join(".oleafly").join("attachments").join(session_id)
}

/// A file name safe on every system: reserved characters and controls
/// become `_`, trailing dots and spaces go, Windows device names get a `_`.
pub(super) fn safe_file_name(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or(name);
    let mut clean: String = base
        .chars()
        .map(|c| {
            if c.is_control() || matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') {
                '_'
            } else {
                c
            }
        })
        .collect();
    while clean.ends_with(['.', ' ']) {
        clean.pop();
    }
    let clean = clean.trim_start().to_string();
    let stem = clean.split('.').next().unwrap_or("").to_ascii_uppercase();
    let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ((stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.len() == 4
            && stem.as_bytes()[3].is_ascii_digit()
            && stem.as_bytes()[3] != b'0');
    let clean = if reserved { format!("_{clean}") } else { clean };
    let mut bounded: String = clean.chars().take(MAX_NAME).collect();
    while bounded.ends_with(['.', ' ']) {
        bounded.pop();
    }
    if bounded.is_empty() || bounded == "." || bounded == ".." {
        "attachment".into()
    } else {
        bounded
    }
}

fn numbered(name: &str, index: usize) -> String {
    if index == 1 {
        return name.to_owned();
    }
    match name.rfind('.').filter(|dot| *dot > 0) {
        Some(dot) => format!("{} ({index}){}", &name[..dot], &name[dot..]),
        None => format!("{name} ({index})"),
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn same_file(path: &Path, size: usize, sha256: &str) -> bool {
    std::fs::metadata(path)
        .is_ok_and(|metadata| metadata.is_file() && metadata.len() == size as u64)
        && std::fs::read(path).is_ok_and(|bytes| sha256_hex(&bytes) == sha256)
}

/// Copies a stored attachment into the session's folder. The same bytes
/// already copied under `name`, `name (2)`, … are reused; otherwise the
/// first free name is written.
pub(super) fn copy_into_session(
    root: &Path,
    session_id: &str,
    bytes: &[u8],
    name: &str,
    sha256: &str,
) -> Result<PathBuf, String> {
    if bytes.len() > MAX_COPY_BYTES {
        return Err("This attachment is larger than 32 MB.".into());
    }
    let folder = attachment_dir(root, session_id);
    std::fs::create_dir_all(&folder)
        .map_err(|_| "Oleafly couldn't save the attachment for the agent.")?;
    let name = safe_file_name(name);
    for index in 1..10_000 {
        let candidate = folder.join(numbered(&name, index));
        if candidate.exists() {
            if same_file(&candidate, bytes.len(), sha256) {
                return Ok(candidate);
            }
            continue;
        }
        let temporary = folder.join(format!(".{}.part", super::types::new_id()));
        std::fs::write(&temporary, bytes)
            .map_err(|_| "Oleafly couldn't save the attachment for the agent.")?;
        return match std::fs::rename(&temporary, &candidate) {
            Ok(()) => Ok(candidate),
            Err(_) => {
                let _ = std::fs::remove_file(&temporary);
                Err("Oleafly couldn't save the attachment for the agent.".into())
            }
        };
    }
    Err("Oleafly couldn't save the attachment for the agent.".into())
}

fn text_like(name: &str, mime: Option<&str>) -> bool {
    let lower = name.to_ascii_lowercase();
    mime.is_some_and(|mime| mime.starts_with("text/") || mime == "application/json")
        || [
            ".tex", ".bib", ".md", ".csv", ".typ", ".txt", ".json", ".sty", ".cls",
        ]
        .iter()
        .any(|extension| lower.ends_with(extension))
}

fn embedded(path: &Path, name: &str, mime: Option<&str>, uri: &str) -> Option<EmbeddedText> {
    if !text_like(name, mime) {
        return None;
    }
    let metadata = std::fs::metadata(path).ok()?;
    if metadata.len() as usize > MAX_EMBEDDED_TEXT {
        return None;
    }
    let text = String::from_utf8(std::fs::read(path).ok()?).ok()?;
    Some(EmbeddedText {
        uri: Some(uri.to_owned()),
        name: name.to_owned(),
        mime_type: mime
            .map(str::to_owned)
            .or_else(|| Some("text/plain".into())),
        text,
    })
}

/// Resolved files: links for every file, embedded texts for small text
/// files, and what the transcript keeps about them.
pub(super) struct Resolved {
    pub links: Vec<ResourceLink>,
    pub texts: Vec<EmbeddedText>,
    pub notes: Vec<FileNote>,
}

/// What resolving one message's files needs.
struct FileScope<'a> {
    project_id: &'a str,
    root: &'a Path,
    /// The project folder as the agent spells it.
    spelled: PathBuf,
    data_root: &'a Path,
    session_id: &'a str,
    caps: &'a Capabilities,
}

impl FileScope<'_> {
    /// A file from Oleafly's attachment store: copied into the session
    /// folder, then linked.
    fn add_stored(
        &self,
        resolved: &mut Resolved,
        sha256: &str,
        name: &str,
        mime: &str,
    ) -> Result<(), String> {
        let scope = crate::attachments::locate(self.data_root, Some(self.project_id), sha256)
            .ok_or("An attachment is no longer stored. Attach the file again.")?;
        let bytes = crate::attachments::read_bytes(self.data_root, &scope, sha256)
            .map_err(|_| "An attachment is no longer stored. Attach the file again.")?;
        let path = copy_into_session(self.root, self.session_id, &bytes, name, sha256)?;
        let display = path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| safe_file_name(name));
        let uri = oleafly_acp::paths::file_uri(
            &self
                .spelled
                .join(path.strip_prefix(self.root).unwrap_or(&path)),
        )?;
        let mime = Some(mime.to_owned()).filter(|mime| !mime.is_empty() && mime.len() <= 100);
        if self.caps.embedded_context {
            if let Some(text) = embedded(&path, &display, mime.as_deref(), &uri) {
                resolved.texts.push(text);
            }
        }
        resolved.links.push(ResourceLink {
            uri,
            name: display.clone(),
            mime_type: mime.clone(),
            size: Some(bytes.len() as u64),
        });
        resolved.notes.push(FileNote {
            name: display,
            mime,
            size: Some(bytes.len() as u64),
        });
        Ok(())
    }

    /// A file of the project, linked in place.
    fn add_project(&self, resolved: &mut Resolved, path: &str) -> Result<(), String> {
        let relative = Path::new(path);
        if path.is_empty()
            || relative.is_absolute()
            || !oleafly_acp::paths::path_within(self.root, &self.spelled, relative)
        {
            return Err("Attach files from inside this project.".into());
        }
        let absolute = self.root.join(relative);
        let metadata = std::fs::metadata(&absolute)
            .map_err(|_| "An attached project file no longer exists.")?;
        if !metadata.is_file() {
            return Err("Attach files, not folders.".into());
        }
        let name = absolute
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.to_owned());
        let uri = oleafly_acp::paths::file_uri(&self.spelled.join(relative))?;
        if self.caps.embedded_context {
            if let Some(text) = embedded(&absolute, &name, None, &uri) {
                resolved.texts.push(text);
            }
        }
        resolved.links.push(ResourceLink {
            uri,
            name: name.clone(),
            mime_type: None,
            size: Some(metadata.len()),
        });
        resolved.notes.push(FileNote {
            name: path.to_owned(),
            mime: None,
            size: Some(metadata.len()),
        });
        Ok(())
    }

    /// A selection quoted as text; `None` for a blank one.
    fn selection_text(&self, selection: &PromptSelection) -> Option<EmbeddedText> {
        let text: String = selection.text.chars().take(MAX_SELECTION).collect();
        if text.trim().is_empty() {
            return None;
        }
        let (name, uri) = match selection.path.as_deref().filter(|path| !path.is_empty()) {
            Some(path)
                if !Path::new(path).is_absolute()
                    && oleafly_acp::paths::path_within(
                        self.root,
                        &self.spelled,
                        Path::new(path),
                    ) =>
            {
                (
                    format!("Selection from {path}"),
                    oleafly_acp::paths::file_uri(&self.spelled.join(path)).ok(),
                )
            }
            _ => ("Selection".to_string(), None),
        };
        Some(EmbeddedText {
            // A selection is quoted, not linked: the link would bring the
            // whole file.
            uri: uri.filter(|_| self.caps.embedded_context),
            name,
            mime_type: Some("text/plain".into()),
            text,
        })
    }
}

/// Turns the message's files and selections into links and texts.
/// `data_root` is Oleafly's data folder (the attachment store).
pub(super) fn resolve(
    input: &PromptInput,
    project_id: &str,
    root: &Path,
    data_root: &Path,
    session_id: &str,
    caps: &Capabilities,
) -> Result<Resolved, String> {
    let count = input.files.len() + input.images.len() + input.selections.len();
    if count > MAX_ATTACHMENTS {
        return Err("Attach at most 10 files to one message.".into());
    }
    let scope = FileScope {
        project_id,
        root,
        spelled: super::runtime::launch_root_for(root),
        data_root,
        session_id,
        caps,
    };
    let mut resolved = Resolved {
        links: Vec::new(),
        texts: Vec::new(),
        notes: Vec::new(),
    };
    for file in &input.files {
        match file {
            PromptFile::Stored { sha256, name, mime } => {
                scope.add_stored(&mut resolved, sha256, name, mime)?
            }
            PromptFile::Project { path } => scope.add_project(&mut resolved, path)?,
        }
    }
    resolved.texts.extend(
        input
            .selections
            .iter()
            .filter_map(|selection| scope.selection_text(selection)),
    );
    // Without embedded context, file texts would only repeat the link.
    if !caps.embedded_context {
        resolved
            .texts
            .retain(|text| text.name.starts_with("Selection"));
    }
    Ok(resolved)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn name_collisions_get_a_number() {
        let temp = tempfile::tempdir().unwrap();
        let first =
            copy_into_session(temp.path(), "s", b"one", "a.pdf", &sha256_hex(b"one")).unwrap();
        let second =
            copy_into_session(temp.path(), "s", b"two", "a.pdf", &sha256_hex(b"two")).unwrap();
        assert!(first.ends_with("a.pdf"));
        assert!(second.ends_with("a (2).pdf"));
    }

    #[test]
    fn the_same_file_twice_is_copied_once() {
        let temp = tempfile::tempdir().unwrap();
        let hash = sha256_hex(b"same");
        let first = copy_into_session(temp.path(), "s", b"same", "x.pdf", &hash).unwrap();
        let second = copy_into_session(temp.path(), "s", b"same", "x.pdf", &hash).unwrap();
        assert_eq!(first, second);
        assert_eq!(
            std::fs::read_dir(attachment_dir(temp.path(), "s"))
                .unwrap()
                .count(),
            1
        );
    }

    #[test]
    fn reserved_names_and_characters_are_made_safe() {
        assert_eq!(safe_file_name("CON.pdf"), "_CON.pdf");
        assert_eq!(safe_file_name("a<b>:c?.pdf"), "a_b__c_.pdf");
        assert_eq!(safe_file_name("notes. "), "notes");
        assert_eq!(safe_file_name("../../etc/passwd"), "passwd");
        assert_eq!(safe_file_name(""), "attachment");
        assert_eq!(safe_file_name("lpt1"), "_lpt1");
        assert_eq!(safe_file_name("COM0.txt"), "COM0.txt");
    }

    #[test]
    fn project_files_are_linked_in_place() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().canonicalize().unwrap();
        std::fs::write(root.join("main.tex"), "\\section{A}").unwrap();
        let input = PromptInput {
            files: vec![PromptFile::Project {
                path: "main.tex".into(),
            }],
            ..Default::default()
        };
        let caps = Capabilities {
            embedded_context: true,
            ..Default::default()
        };
        let resolved = resolve(&input, "p", &root, &root, "s", &caps).unwrap();
        assert!(resolved.links[0].uri.ends_with("/main.tex"));
        assert_eq!(resolved.texts[0].text, "\\section{A}");
        assert!(!attachment_dir(&root, "s").exists());
    }

    #[test]
    fn project_paths_outside_the_project_are_refused() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().canonicalize().unwrap();
        for path in ["../x", "/etc/hosts"] {
            let input = PromptInput {
                files: vec![PromptFile::Project { path: path.into() }],
                ..Default::default()
            };
            assert!(
                resolve(&input, "p", &root, &root, "s", &Capabilities::default()).is_err(),
                "{path}"
            );
        }
    }
}
