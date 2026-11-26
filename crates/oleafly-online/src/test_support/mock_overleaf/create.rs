use std::collections::{BTreeMap, HashMap};
use std::io::Read;
use std::time::Duration;

use serde_json::{json, Value};

use super::{
    content_hash, json_reply, multipart_file, object_id, text_reply, uploaded_text, Blob, Doc,
    Folder, MockOverleaf, Reply, State, WithStatus, RATE_LIMITED,
};

const CREATE_ROUTE: &str = "/project/new/upload";
const CREATES_PER_MINUTE: usize = 20;
const IGNORED_FOLDERS: [&str; 6] = ["__MACOSX", ".git", ".texpadtmp", ".R", ".venv", "venv"];
const IGNORED_EXTENSIONS: [&str; 21] = [
    "dvi",
    "aux",
    "log",
    "toc",
    "out",
    "pdfsync",
    "synctex",
    "fdb_latexmk",
    "fls",
    "nlo",
    "ind",
    "glo",
    "gls",
    "glg",
    "bbl",
    "blg",
    "doc",
    "docx",
    "gz",
    "swp",
    "synctex(busy)",
];

#[derive(Clone, Debug)]
pub struct Created {
    pub project_id: String,
    pub name: String,
    pub entries: Vec<String>,
}

fn failed(status: u16, error: &str) -> Reply {
    json_reply(&json!({ "success": false, "error": error })).with_status(status)
}

fn ignored(path: &str) -> bool {
    let parts: Vec<&str> = path.split('/').collect();
    let Some(name) = parts.last() else {
        return true;
    };
    if parts[..parts.len() - 1]
        .iter()
        .any(|folder| IGNORED_FOLDERS.contains(folder))
    {
        return true;
    }
    if name.starts_with('.') && *name != ".latexmkrc" {
        return true;
    }
    name.rsplit_once('.').is_some_and(|(_, extension)| {
        IGNORED_EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str())
    })
}

fn entries(bytes: &[u8]) -> Option<BTreeMap<String, Vec<u8>>> {
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).ok()?;
    let mut found = BTreeMap::new();
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).ok()?;
        if entry.is_dir() {
            continue;
        }
        let name = entry.name().ok()?.replace('\\', "/");
        if name.split('/').any(|part| part == "..") || ignored(&name) {
            continue;
        }
        let mut body = Vec::new();
        entry.read_to_end(&mut body).ok()?;
        found.insert(name, body);
    }
    let top: Vec<&str> = found
        .keys()
        .map(|path| path.split('/').next().unwrap_or_default())
        .collect();
    let single = top.first().copied().filter(|first| {
        top.iter().all(|other| other == first) && found.keys().all(|path| path.contains('/'))
    });
    if let Some(folder) = single.map(str::to_owned) {
        found = found
            .into_iter()
            .map(|(path, body)| (path[folder.len() + 1..].to_string(), body))
            .collect();
    }
    Some(found)
}

fn title_of(text: &str) -> Option<String> {
    let at = text.find("\\title{")?;
    let rest = &text[at + "\\title{".len()..];
    let title = rest[..rest.find('}')?].trim();
    (!title.is_empty()).then(|| title.to_string())
}

impl State {
    pub(super) fn create_route(
        &mut self,
        method: &str,
        path: &str,
        headers: &HashMap<String, String>,
        body: &[u8],
    ) -> Option<Reply> {
        if method != "POST" || path != CREATE_ROUTE {
            return None;
        }
        let Some(user) = self.user_for(headers) else {
            return Some(Reply::status(302).header("Location", "/login"));
        };
        if headers.get("x-csrf-token") != Some(&self.csrf) {
            return Some(text_reply(403, "Forbidden"));
        }
        if !self.allow(
            &format!("create:{user}"),
            CREATES_PER_MINUTE,
            Duration::from_secs(60),
        ) {
            return Some(text_reply(429, RATE_LIMITED));
        }
        let content_type = headers.get("content-type").cloned().unwrap_or_default();
        let Some((name, bytes)) = multipart_file(&content_type, body) else {
            return Some(failed(400, "invalid_upload_request"));
        };
        if bytes.len() as u64 > self.config.max_upload_bytes {
            return Some(failed(422, "File too large"));
        }
        let Some(found) = entries(&bytes).filter(|found| !found.is_empty()) else {
            return Some(failed(422, "Invalid zip file"));
        };
        let project_id = self.replace_project(&user, &name, found);
        Some(json_reply(
            &json!({ "success": true, "project_id": project_id }),
        ))
    }

    fn replace_project(
        &mut self,
        user: &str,
        upload_name: &str,
        found: BTreeMap<String, Vec<u8>>,
    ) -> String {
        self.created += 1;
        let project_id = object_id(&format!("project:upload:{}", self.created));
        self.project_id.clone_from(&project_id);
        let uploader = self.people().find(|person| person.id == user).cloned();
        if let Some(uploader) = uploader.filter(|uploader| uploader.id != self.owner.id) {
            let previous = std::mem::replace(&mut self.owner, uploader.clone());
            self.outsiders.retain(|outsider| outsider.id != uploader.id);
            self.token_viewers.retain(|viewer| viewer.id != uploader.id);
            self.members.retain(|(member, _)| member.id != uploader.id);
            self.outsiders.push(previous);
        }
        let members = std::mem::take(&mut self.members);
        self.outsiders
            .extend(members.into_iter().map(|(member, _)| member));
        self.outsiders.append(&mut self.token_viewers);
        self.docs.clear();
        self.files.clear();
        self.threads.clear();
        self.chat.clear();
        self.invites.clear();
        self.labels.clear();
        self.history.clear();
        self.root = Folder {
            id: self.new_id(),
            name: "rootFolder".into(),
            ..Folder::default()
        };
        let mut root_doc = None;
        let mut title = None;
        let mut entries = Vec::new();
        for (path, bytes) in found {
            let (folder, name) = self.folder_for_path(&path);
            let id = self.new_id();
            match uploaded_text(&name, &bytes) {
                Some(text) => {
                    if root_doc.is_none() && text.contains("\\documentclass") {
                        root_doc = Some(id.clone());
                        title = title_of(&text);
                    }
                    self.docs
                        .insert(id.clone(), Doc::new(&name, &text, self.format));
                    self.root.find_mut(&folder).unwrap().docs.push(id);
                }
                None => {
                    self.files.insert(
                        id.clone(),
                        Blob {
                            name,
                            hash: content_hash(&bytes),
                            bytes,
                        },
                    );
                    self.root.find_mut(&folder).unwrap().files.push(id);
                }
            }
            entries.push(path);
        }
        self.root_doc = root_doc;
        let wanted = title.unwrap_or_else(|| {
            upload_name
                .strip_suffix(".zip")
                .unwrap_or(upload_name)
                .to_string()
        });
        self.project_name = if self.taken_names.contains(&wanted) {
            format!("{wanted} (1)")
        } else {
            wanted
        };
        self.taken_names.push(self.project_name.clone());
        self.snapshots = vec![self.snapshot()];
        self.created_projects.push(Created {
            project_id: project_id.clone(),
            name: self.project_name.clone(),
            entries,
        });
        project_id
    }

    pub(super) fn rename_project(&mut self, body: &Value) -> Reply {
        let Some(name) = body
            .get("newProjectName")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|name| !name.is_empty())
        else {
            return text_reply(400, "invalid name");
        };
        self.project_name = name.to_string();
        self.emit_room("projectNameUpdated", &[json!(name)], None);
        Reply::status(204)
    }
}

impl MockOverleaf {
    pub fn created(&self) -> Vec<Created> {
        self.state().created_projects.clone()
    }

    pub fn project_name(&self) -> String {
        self.state().project_name.clone()
    }

    pub fn root_doc_path(&self) -> Option<String> {
        let state = self.state();
        state.path_of(state.root_doc.as_deref()?)
    }

    pub fn compiler(&self) -> String {
        self.state().compiler.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::{entries, ignored, title_of};
    use crate::test_support::zip_bytes;

    #[test]
    fn uploads_drop_what_overleaf_ignores_and_one_top_folder() {
        assert!(ignored("main.bbl") && ignored(".DS_Store") && ignored("__MACOSX/._main.tex"));
        assert!(!ignored(".latexmkrc") && !ignored("figures/pixel.png"));
        let found = entries(&zip_bytes(&[
            ("repo-main/main.tex", "x"),
            ("repo-main/img/pixel.png", "y"),
        ]))
        .unwrap();
        assert_eq!(
            found.keys().cloned().collect::<Vec<_>>(),
            ["img/pixel.png", "main.tex"]
        );
        assert_eq!(
            title_of("\\title{ Uploaded From Oleafly }\n").as_deref(),
            Some("Uploaded From Oleafly")
        );
        assert!(entries(b"not a zip").is_none());
    }
}
