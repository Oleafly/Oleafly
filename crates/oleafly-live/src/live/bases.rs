use std::collections::{BTreeSet, HashMap, VecDeque};
use std::path::Path;
use std::sync::Mutex;

use oleafly_collab::doc::NodeKind;
use oleafly_collab::live::LiveProject;
use oleafly_ot::TextOperation;

use super::session::guard;
use crate::disk::{as_text, safe_target, sha256_hex, written_as, DiskState};

const WRITTEN_KEPT: usize = 4;

#[derive(Default)]
pub struct WrittenTexts {
    pub texts: HashMap<String, VecDeque<String>>,
    writing: BTreeSet<String>,
}

impl WrittenTexts {
    pub fn record(&mut self, path: &str, text: &str) {
        let kept = self.texts.entry(path.to_owned()).or_default();
        if kept.back().is_some_and(|last| last == text) {
            return;
        }
        kept.push_back(text.to_owned());
        while kept.len() > WRITTEN_KEPT {
            kept.pop_front();
        }
    }

    pub fn latest(&self, path: &str) -> Option<&String> {
        self.texts.get(path)?.back()
    }

    pub fn latest_settled(&self, path: &str) -> Option<&String> {
        if self.writing.contains(path) {
            return None;
        }
        self.latest(path)
    }

    pub fn writing(&mut self, path: &str, writing: bool) {
        if writing {
            self.writing.insert(path.to_owned());
        } else {
            self.writing.remove(path);
        }
    }

    pub fn kept(&self, path: &str) -> impl Iterator<Item = &String> {
        self.texts
            .get(path)
            .into_iter()
            .flat_map(|kept| kept.iter().rev())
    }

    pub fn base_for(&self, path: &str, found: &str) -> Option<&String> {
        let latest = self.latest(path)?;
        if self.kept(path).any(|text| text == found) {
            return Some(latest);
        }
        nearest(self.kept(path), found)
    }

    pub fn forget(&mut self, path: &str) {
        self.texts.remove(path);
    }

    pub fn rename(&mut self, from: &str, to: &str) {
        if let Some(kept) = self.texts.remove(from) {
            self.texts.insert(to.to_owned(), kept);
        }
    }
}

pub trait Bases {
    fn record(&mut self, path: &str, text: &str);
    fn writing(&mut self, path: &str, writing: bool);
    fn forget(&mut self, path: &str);
    fn rename(&mut self, from: &str, to: &str);
}

impl Bases for WrittenTexts {
    fn record(&mut self, path: &str, text: &str) {
        WrittenTexts::record(self, path, text);
    }

    fn writing(&mut self, path: &str, writing: bool) {
        WrittenTexts::writing(self, path, writing);
    }

    fn forget(&mut self, path: &str) {
        WrittenTexts::forget(self, path);
    }

    fn rename(&mut self, from: &str, to: &str) {
        WrittenTexts::rename(self, from, to);
    }
}

impl Bases for &Mutex<WrittenTexts> {
    fn record(&mut self, path: &str, text: &str) {
        guard(self).record(path, text);
    }

    fn writing(&mut self, path: &str, writing: bool) {
        guard(self).writing(path, writing);
    }

    fn forget(&mut self, path: &str) {
        guard(self).forget(path);
    }

    fn rename(&mut self, from: &str, to: &str) {
        guard(self).rename(from, to);
    }
}

pub fn nearest<'a>(
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
        .min_by_key(|candidate| oleafly_ot::distance(candidate, found))
}

pub fn initial_bases(root: &Path, disk: &DiskState, live: &LiveProject) -> WrittenTexts {
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

pub fn merged_onto(base: &str, disk: &str, current: &str) -> Option<TextOperation> {
    if base == current {
        return None;
    }
    oleafly_ot::rebase(base, disk, current).map(|rebased| rebased.operation)
}
