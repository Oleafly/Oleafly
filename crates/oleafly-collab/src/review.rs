use std::collections::BTreeSet;

use oleafly_collab_protocol::crypto::{b64url_decode, b64url_encode};

use crate::doc::{decode_version, NodeKind, ProjectDoc};
use crate::materialize::{self, Layout};
use crate::CollabError;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReviewedFile {
    pub id: String,
    pub path: String,
    pub before: Option<String>,
    pub after: Option<String>,
}

pub fn encode_mark(version: &[u8]) -> String {
    b64url_encode(version)
}

pub fn decode_mark(mark: &str) -> Result<Vec<u8>, CollabError> {
    b64url_decode(mark)
        .map_err(|_| CollabError::Corrupt("a version mark does not decode".to_owned()))
}

fn texts(doc: &ProjectDoc, layout: &Layout, id: &str) -> Option<String> {
    layout
        .get(id)
        .filter(|placed| placed.kind == NodeKind::Text)
        .and_then(|_| doc.text(id).ok())
}

pub fn changed_files(
    doc: &ProjectDoc,
    before: &[u8],
    after: &[u8],
) -> Result<Vec<ReviewedFile>, CollabError> {
    let old = doc.at_version(&decode_version(before)?)?;
    let new = doc.at_version(&decode_version(after)?)?;
    let old_layout = materialize::layout(&old.nodes()?);
    let new_layout = materialize::layout(&new.nodes()?);
    let ids: BTreeSet<&String> = old_layout.keys().chain(new_layout.keys()).collect();
    let mut changed: Vec<ReviewedFile> = ids
        .into_iter()
        .filter_map(|id| {
            let before = texts(&old, &old_layout, id);
            let after = texts(&new, &new_layout, id);
            if before == after {
                return None;
            }
            let path = new_layout
                .get(id)
                .or_else(|| old_layout.get(id))
                .map(|placed| placed.path.clone())?;
            Some(ReviewedFile {
                id: id.clone(),
                path,
                before,
                after,
            })
        })
        .collect();
    changed.sort_by(|a, b| a.path.cmp(&b.path).then_with(|| a.id.cmp(&b.id)));
    Ok(changed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::doc::{encode_version, NodeKind, ProjectDoc};

    fn file(id: &str, path: &str, before: Option<&str>, after: Option<&str>) -> ReviewedFile {
        ReviewedFile {
            id: id.to_owned(),
            path: path.to_owned(),
            before: before.map(str::to_owned),
            after: after.map(str::to_owned),
        }
    }

    #[test]
    fn each_text_file_that_changed_comes_with_its_text_before_and_after() {
        let mut doc = ProjectDoc::create().unwrap();
        let main = doc
            .add_node(None, "main.tex", NodeKind::Text, None, "abc")
            .unwrap();
        let gone = doc
            .add_node(None, "old.tex", NodeKind::Text, None, "bye")
            .unwrap();
        doc.add_node(None, "same.tex", NodeKind::Text, None, "keep")
            .unwrap();
        let figure = doc
            .add_node(None, "fig.png", NodeKind::Blob, Some("one"), "")
            .unwrap();
        let before = encode_version(&doc.version());
        doc.set_text(&main, "abcd").unwrap();
        doc.trash(&gone).unwrap();
        let fresh = doc
            .add_node(None, "new.tex", NodeKind::Text, None, "hi")
            .unwrap();
        doc.set_blob(&figure, "two").unwrap();
        let after = encode_version(&doc.version());
        doc.set_text(&main, "abcd typed later").unwrap();
        assert_eq!(
            changed_files(&doc, &before, &after).unwrap(),
            vec![
                file(&main, "main.tex", Some("abc"), Some("abcd")),
                file(&fresh, "new.tex", None, Some("hi")),
                file(&gone, "old.tex", Some("bye"), None),
            ]
        );
    }

    #[test]
    fn a_version_this_document_never_had_is_refused() {
        let doc = ProjectDoc::create().unwrap();
        let mut other = ProjectDoc::create().unwrap();
        other
            .add_node(None, "main.tex", NodeKind::Text, None, "x")
            .unwrap();
        let here = encode_version(&doc.version());
        assert!(changed_files(&doc, &encode_version(&other.version()), &here).is_err());
        assert!(changed_files(&doc, b"not a version", &here).is_err());
    }

    #[test]
    fn version_marks_travel_as_text_and_come_back_unchanged() {
        let doc = ProjectDoc::create().unwrap();
        let bytes = encode_version(&doc.version());
        assert_eq!(decode_mark(&encode_mark(&bytes)).unwrap(), bytes);
        assert!(decode_mark("not base64!").is_err());
    }
}
