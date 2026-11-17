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
}
