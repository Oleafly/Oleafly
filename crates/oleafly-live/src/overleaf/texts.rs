use std::collections::{BTreeMap, BTreeSet};
use std::io::Write;
use std::path::{Path, PathBuf};

use oleafly_core::app_log::AppLog;

use crate::disk::{as_text, sha256_hex};

const TEXTS_DIR: &str = "texts";

fn dir_of(mirror_dir: &Path) -> PathBuf {
    mirror_dir.join(TEXTS_DIR)
}

pub fn last_written(mirror_dir: &Path, hash: &str) -> Option<String> {
    let bytes = std::fs::read(dir_of(mirror_dir).join(hash)).ok()?;
    (sha256_hex(&bytes) == hash)
        .then(|| as_text(&bytes))
        .flatten()
}

#[derive(Default)]
pub struct LastTexts {
    kept: Option<BTreeSet<String>>,
    unknown: BTreeSet<String>,
}

impl LastTexts {
    pub fn keep(
        &mut self,
        mirror_dir: &Path,
        hashes: &BTreeMap<String, String>,
        bytes_of: impl Fn(&str, &str) -> Option<Vec<u8>>,
        log: &AppLog,
    ) {
        let dir = dir_of(mirror_dir);
        let kept = self.kept.get_or_insert_with(|| listed(&dir));
        for (path, hash) in hashes {
            if kept.contains(hash) || self.unknown.contains(hash) {
                continue;
            }
            let Some(bytes) = bytes_of(path, hash) else {
                self.unknown.insert(hash.clone());
                continue;
            };
            match write(&dir, hash, &bytes) {
                Ok(()) => {
                    kept.insert(hash.clone());
                }
                Err(error) => {
                    let _ = log.write(&format!(
                        "Live editing could not keep the last text of {path} in {}: {error}",
                        dir.display()
                    ));
                    return;
                }
            }
        }
    }

    pub fn prune(&mut self, mirror_dir: &Path, hashes: &BTreeMap<String, String>) {
        let dir = dir_of(mirror_dir);
        let wanted: BTreeSet<&String> = hashes.values().collect();
        self.unknown.retain(|hash| wanted.contains(hash));
        if let Some(kept) = self.kept.as_mut() {
            kept.retain(|hash| {
                wanted.contains(hash) || std::fs::remove_file(dir.join(hash)).is_err()
            });
        }
    }
}

fn listed(dir: &Path) -> BTreeSet<String> {
    std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter_map(|entry| entry.file_name().into_string().ok())
        .collect()
}

fn write(dir: &Path, hash: &str, bytes: &[u8]) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let mut staged = tempfile::NamedTempFile::new_in(dir)?;
    staged.write_all(bytes)?;
    let mut staged = Some(staged);
    oleafly_core::atomic::persist_with_retry(|| {
        let file = staged
            .take()
            .ok_or_else(|| std::io::Error::other("the staged text is gone"))?;
        file.persist(dir.join(hash)).map(drop).map_err(|failed| {
            staged = Some(failed.file);
            failed.error
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_text_is_kept_under_its_hash_until_the_index_stops_naming_it() {
        let dir = tempfile::tempdir().unwrap();
        let log = AppLog::at(dir.path());
        let hashes =
            |text: &str| BTreeMap::from([("main.tex".to_owned(), sha256_hex(text.as_bytes()))]);
        let mut texts = LastTexts::default();
        for text in ["one\r\ntwo\r\n", "three\n"] {
            let hashes = hashes(text);
            texts.keep(
                dir.path(),
                &hashes,
                |_, _| Some(text.as_bytes().to_vec()),
                &log,
            );
            texts.prune(dir.path(), &hashes);
        }
        let hash = |text: &str| sha256_hex(text.as_bytes());
        assert_eq!(
            last_written(dir.path(), &hash("three\n")).as_deref(),
            Some("three\n")
        );
        assert_eq!(last_written(dir.path(), &hash("one\r\ntwo\r\n")), None);
        std::fs::write(dir.path().join(TEXTS_DIR).join(hash("three\n")), "torn").unwrap();
        assert_eq!(last_written(dir.path(), &hash("three\n")), None);
    }
}
