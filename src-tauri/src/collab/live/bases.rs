use std::collections::HashMap;
use std::path::Path;

use oleafly_collab::doc::NodeKind;
use oleafly_collab::live::LiveProject;
use oleafly_collab::ot::TextOperation;

use crate::collab::disk::{as_text, safe_target, sha256_hex, written_as, DiskState};

const WRITTEN_KEPT: usize = 4;

#[derive(Default)]
pub(super) struct WrittenTexts(pub(super) HashMap<String, std::collections::VecDeque<String>>);

impl WrittenTexts {
    pub(super) fn record(&mut self, path: &str, text: &str) {
        let kept = self.0.entry(path.to_owned()).or_default();
        if kept.back().is_some_and(|last| last == text) {
            return;
        }
        kept.push_back(text.to_owned());
        while kept.len() > WRITTEN_KEPT {
            kept.pop_front();
        }
    }

    pub(super) fn latest(&self, path: &str) -> Option<&String> {
        self.0.get(path)?.back()
    }

    pub(super) fn kept(&self, path: &str) -> impl Iterator<Item = &String> {
        self.0
            .get(path)
            .into_iter()
            .flat_map(|kept| kept.iter().rev())
    }

    pub(super) fn base_for(&self, path: &str, found: &str) -> Option<&String> {
        let latest = self.latest(path)?;
        if self.kept(path).any(|text| text == found) {
            return Some(latest);
        }
        nearest(self.kept(path), found)
    }

    pub(super) fn forget(&mut self, path: &str) {
        self.0.remove(path);
    }

    pub(super) fn rename(&mut self, from: &str, to: &str) {
        if let Some(kept) = self.0.remove(from) {
            self.0.insert(to.to_owned(), kept);
        }
    }
}

pub(super) fn nearest<'a>(
    candidates: impl Iterator<Item = &'a String>,
    found: &str,
) -> Option<&'a String> {
    let mut distinct: Vec<&'a String> = Vec::new();
    for candidate in candidates {
        if candidate == found {
            return Some(candidate);
        }
        if !distinct.contains(&candidate) {
            distinct.push(candidate);
        }
    }
    distinct
        .into_iter()
        .min_by_key(|candidate| oleafly_collab::merge::distance(candidate, found))
}

pub(super) fn initial_bases(root: &Path, disk: &DiskState, live: &LiveProject) -> WrittenTexts {
    let mut bases = WrittenTexts::default();
    for (id, placed) in disk
        .layout
        .iter()
        .filter(|(_, placed)| placed.kind == NodeKind::Text)
    {
        let Some(known) = disk.hashes.get(&placed.path) else {
            continue;
        };
        let on_disk = safe_target(root, &placed.path)
            .and_then(|target| std::fs::read(target).ok())
            .filter(|bytes| sha256_hex(bytes) == *known)
            .and_then(|bytes| as_text(&bytes));
        let text = on_disk.or_else(|| {
            live.doc()
                .text(id)
                .ok()
                .filter(|text| written_as(text, known))
        });
        if let Some(text) = text {
            bases.record(&placed.path, &text);
        }
    }
    bases
}

pub(super) fn merged_onto(base: &str, disk: &str, current: &str) -> Option<TextOperation> {
    if base == current {
        return None;
    }
    oleafly_collab::merge::rebase(base, disk, current)
}
