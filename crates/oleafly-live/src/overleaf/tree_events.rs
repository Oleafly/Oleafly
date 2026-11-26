use serde::Serialize;

pub const TREE_EVENT: &str = "overleaf-live-tree";

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeNotice {
    pub project_id: String,
    #[serde(flatten)]
    pub kind: TreeNoticeKind,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TreeNoticeKind {
    DeleteAsked { paths: Vec<String> },
    NotAllowed { paths: Vec<String> },
    KeptAway { paths: Vec<String> },
    StoredAsFiles { paths: Vec<String> },
    Linked { files: Vec<LinkedFile> },
    LinkedKept { paths: Vec<String> },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkedFile {
    pub path: String,
    pub provider: String,
    pub url: Option<String>,
    pub source_project: Option<String>,
    pub source_path: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_tree_notice_reads_as_one_flat_object() {
        let notice = TreeNotice {
            project_id: "p".into(),
            kind: TreeNoticeKind::DeleteAsked {
                paths: vec!["figures.tex".into()],
            },
        };
        assert_eq!(
            serde_json::to_value(&notice).unwrap(),
            serde_json::json!({ "projectId": "p", "kind": "delete_asked", "paths": ["figures.tex"] })
        );
    }

    #[test]
    fn the_files_stored_as_binaries_read_as_one_flat_object() {
        let notice = TreeNotice {
            project_id: "p".into(),
            kind: TreeNoticeKind::StoredAsFiles { paths: Vec::new() },
        };
        assert_eq!(
            serde_json::to_value(&notice).unwrap(),
            serde_json::json!({ "projectId": "p", "kind": "stored_as_files", "paths": [] })
        );
    }

    #[test]
    fn linked_files_read_as_one_flat_object_with_their_sources() {
        let notice = TreeNotice {
            project_id: "p".into(),
            kind: TreeNoticeKind::Linked {
                files: vec![LinkedFile {
                    path: "refs.bib".into(),
                    provider: "project_file".into(),
                    url: None,
                    source_project: Some("p2".into()),
                    source_path: Some("/sample.bib".into()),
                }],
            },
        };
        assert_eq!(
            serde_json::to_value(&notice).unwrap(),
            serde_json::json!({
                "projectId": "p",
                "kind": "linked",
                "files": [{ "path": "refs.bib", "provider": "project_file", "url": null, "sourceProject": "p2", "sourcePath": "/sample.bib" }],
            })
        );
        let kept = TreeNotice {
            project_id: "p".into(),
            kind: TreeNoticeKind::LinkedKept {
                paths: vec!["refs.bib".into()],
            },
        };
        assert_eq!(
            serde_json::to_value(&kept).unwrap(),
            serde_json::json!({ "projectId": "p", "kind": "linked_kept", "paths": ["refs.bib"] })
        );
    }
}
