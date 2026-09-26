use super::{display_name, reveal_path};
use crate::fs_identity::{CaseSensitivity, FsIdentity, IdentityMatch};
use crate::linked_registry::LinkRecord;
use std::path::{Path, PathBuf};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum RootState {
    Present,
    Missing,
    Different,
}

pub(crate) trait RootProbe {
    fn root_state(&self, record: &LinkRecord) -> RootState;
    fn remount_verified(&self, record: &LinkRecord, candidate: &Path) -> bool;
}

pub(crate) struct Candidate<'a> {
    pub(crate) path: &'a Path,
    pub(crate) identity: &'a FsIdentity,
    pub(crate) case: CaseSensitivity,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct OverlapChild {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) relative_path: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Decision {
    Inside { id: String, reveal: Option<String> },
    Existing { id: String },
    Moved { id: String, from: String },
    Remounted { id: String, from: String },
    Revived { id: String, from: String },
    Replace { displaced: String },
    New { removed_predecessor: Option<String> },
    Overlap { children: Vec<OverlapChild> },
}

pub(crate) fn same_folder(recorded: &FsIdentity, observed: &FsIdentity) -> bool {
    recorded == observed
        || crate::fs_identity::compare(recorded, observed) == IdentityMatch::FullMatch
}

fn stored(record: &LinkRecord) -> &Path {
    Path::new(&record.canonical_path)
}

fn below(root: &Path, path: &Path, case: CaseSensitivity) -> Option<PathBuf> {
    crate::fs_identity::path_is_within(path, root, case)
        .then(|| path.components().skip(root.components().count()).collect())
}

pub(crate) fn decide(
    candidate: &Candidate<'_>,
    records: &[LinkRecord],
    probe: &dyn RootProbe,
) -> Decision {
    let mut ordered: Vec<&LinkRecord> = records.iter().collect();
    ordered.sort_by_key(|record| std::cmp::Reverse(record.last_opened_at));
    let active: Vec<&LinkRecord> = ordered
        .iter()
        .copied()
        .filter(|record| record.is_current())
        .collect();
    if let Some(inside) = enclosing(candidate, &active, probe) {
        return inside;
    }
    let tentative = match_identity_or_path(candidate, &ordered, &active, probe);
    if matches!(tentative, Decision::Existing { .. }) {
        return tentative;
    }
    let keep = match &tentative {
        Decision::Moved { id, .. }
        | Decision::Remounted { id, .. }
        | Decision::Revived { id, .. } => Some(id.as_str()),
        _ => None,
    };
    let children = contained_children(candidate, &active, keep, probe);
    if children.is_empty() {
        tentative
    } else {
        Decision::Overlap { children }
    }
}

fn enclosing(
    candidate: &Candidate<'_>,
    active: &[&LinkRecord],
    probe: &dyn RootProbe,
) -> Option<Decision> {
    active
        .iter()
        .copied()
        .filter_map(|record| {
            let rest = below(stored(record), candidate.path, candidate.case)?;
            (rest.components().next().is_some()).then_some((record, rest))
        })
        .filter(|(record, _)| probe.root_state(record) == RootState::Present)
        .max_by_key(|(record, _)| stored(record).components().count())
        .map(|(record, rest)| Decision::Inside {
            id: record.id.clone(),
            reveal: reveal_path(&rest),
        })
}

fn match_identity_or_path(
    candidate: &Candidate<'_>,
    ordered: &[&LinkRecord],
    active: &[&LinkRecord],
    probe: &dyn RootProbe,
) -> Decision {
    let same_place = |record: &LinkRecord| {
        crate::fs_identity::same_path(stored(record), candidate.path, candidate.case)
    };
    let relation =
        |record: &LinkRecord| crate::fs_identity::compare(&record.identity, candidate.identity);
    let live = |record: &&LinkRecord| record.removed_at.is_none();
    if let Some(record) = ordered
        .iter()
        .copied()
        .filter(live)
        .find(|record| relation(record) == IdentityMatch::FullMatch)
    {
        return if same_place(record) && record.displaced.is_none() {
            Decision::Existing {
                id: record.id.clone(),
            }
        } else {
            Decision::Moved {
                id: record.id.clone(),
                from: record.canonical_path.clone(),
            }
        };
    }
    if let Some(record) = ordered.iter().copied().filter(live).find(|record| {
        relation(record) == IdentityMatch::SameObjectOtherVolume
            && probe.remount_verified(record, candidate.path)
    }) {
        return Decision::Remounted {
            id: record.id.clone(),
            from: record.canonical_path.clone(),
        };
    }
    if let Some(record) = ordered
        .iter()
        .copied()
        .find(|record| record.removed_at.is_some() && relation(record) == IdentityMatch::FullMatch)
    {
        return Decision::Revived {
            id: record.id.clone(),
            from: record.canonical_path.clone(),
        };
    }
    let path_only = |record: &LinkRecord| {
        record.identity.weak
            || candidate.identity.weak
            || same_folder(&record.identity, candidate.identity)
    };
    if let Some(record) = active.iter().copied().find(|record| same_place(record)) {
        return if path_only(record) {
            Decision::Existing {
                id: record.id.clone(),
            }
        } else {
            Decision::Replace {
                displaced: record.id.clone(),
            }
        };
    }
    if let Some(record) = ordered.iter().copied().find(|record| {
        record.removed_at.is_some() && record.displaced.is_none() && same_place(record)
    }) {
        return if path_only(record) {
            Decision::Revived {
                id: record.id.clone(),
                from: record.canonical_path.clone(),
            }
        } else {
            Decision::New {
                removed_predecessor: Some(record.id.clone()),
            }
        };
    }
    Decision::New {
        removed_predecessor: None,
    }
}

fn contained_children(
    candidate: &Candidate<'_>,
    active: &[&LinkRecord],
    keep: Option<&str>,
    probe: &dyn RootProbe,
) -> Vec<OverlapChild> {
    let mut children: Vec<OverlapChild> = active
        .iter()
        .copied()
        .filter(|record| Some(record.id.as_str()) != keep)
        .filter_map(|record| {
            let rest = below(candidate.path, stored(record), candidate.case)?;
            (rest.components().next().is_some()).then_some((record, rest))
        })
        .filter(|(record, _)| probe.root_state(record) == RootState::Present)
        .map(|(record, rest)| OverlapChild {
            id: record.id.clone(),
            name: display_name(stored(record)),
            relative_path: rest
                .components()
                .map(|component| component.as_os_str().to_string_lossy())
                .collect::<Vec<_>>()
                .join("/"),
        })
        .collect();
    children.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    children
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fs_identity::{CaseSensitivity, FsIdentity, VolumeKind};
    use crate::linked_registry::{Displacement, LinkRecord, LINK_VERSION};
    use std::collections::{BTreeMap, HashMap, HashSet};
    use std::path::Path;

    fn identity(volume: &str, file: &str, birth: Option<i64>) -> FsIdentity {
        FsIdentity {
            volume: Some(volume.into()),
            file: file.into(),
            birth_ns: birth,
            weak: false,
        }
    }

    fn weak(file: &str) -> FsIdentity {
        FsIdentity {
            weak: true,
            ..identity("vol-usb", file, Some(1))
        }
    }

    fn record(id: &str, path: &str, identity: FsIdentity) -> LinkRecord {
        LinkRecord {
            version: LINK_VERSION,
            id: id.into(),
            canonical_path: path.into(),
            weak_identity: identity.weak,
            identity,
            display_name: None,
            created_at: 1,
            last_opened_at: 1,
            removed_at: None,
            volume_kind: VolumeKind::Local,
            compile_dir: None,
            displaced: None,
            reattach: None,
            extra: BTreeMap::new(),
        }
    }

    #[derive(Default)]
    struct FakeProbe {
        states: HashMap<String, RootState>,
        verified: HashSet<String>,
    }

    impl FakeProbe {
        fn state(mut self, id: &str, state: RootState) -> Self {
            self.states.insert(id.into(), state);
            self
        }

        fn verify(mut self, id: &str) -> Self {
            self.verified.insert(id.into());
            self
        }
    }

    impl RootProbe for FakeProbe {
        fn root_state(&self, record: &LinkRecord) -> RootState {
            self.states
                .get(&record.id)
                .copied()
                .unwrap_or(RootState::Present)
        }

        fn remount_verified(&self, record: &LinkRecord, _candidate: &Path) -> bool {
            self.verified.contains(&record.id)
        }
    }

    fn cased_at(
        path: &str,
        current: &FsIdentity,
        records: &[LinkRecord],
        probe: &FakeProbe,
        case: CaseSensitivity,
    ) -> Decision {
        decide(
            &Candidate {
                path: Path::new(path),
                identity: current,
                case,
            },
            records,
            probe,
        )
    }

    fn at(path: &str, current: &FsIdentity, records: &[LinkRecord], probe: &FakeProbe) -> Decision {
        cased_at(path, current, records, probe, CaseSensitivity::Sensitive)
    }

    fn paper() -> FsIdentity {
        identity("vol-1", "10", Some(100))
    }

    fn other() -> FsIdentity {
        identity("vol-1", "20", Some(200))
    }

    fn new() -> Decision {
        Decision::New {
            removed_predecessor: None,
        }
    }

    #[test]
    fn an_unknown_folder_is_new() {
        assert_eq!(
            at("/work/paper", &paper(), &[], &FakeProbe::default()),
            new()
        );
    }

    #[test]
    fn the_same_folder_at_its_registered_path_is_the_existing_project() {
        let records = [record("linked-a", "/work/paper", paper())];
        assert_eq!(
            at("/work/paper", &paper(), &records, &FakeProbe::default()),
            Decision::Existing {
                id: "linked-a".into()
            }
        );
    }

    #[test]
    fn a_moved_folder_keeps_its_id() {
        let records = [record("linked-a", "/work/paper", paper())];
        assert_eq!(
            at("/work/renamed", &paper(), &records, &FakeProbe::default()),
            Decision::Moved {
                id: "linked-a".into(),
                from: "/work/paper".into()
            }
        );
    }

    #[test]
    fn a_subfolder_opens_the_enclosing_project_with_a_reveal_path() {
        let records = [record("linked-a", "/work/paper", paper())];
        assert_eq!(
            at(
                "/work/paper/chapters/one",
                &other(),
                &records,
                &FakeProbe::default()
            ),
            Decision::Inside {
                id: "linked-a".into(),
                reveal: Some("chapters/one".into())
            }
        );
        assert_eq!(
            at(
                "/work/paper/.git/hooks",
                &other(),
                &records,
                &FakeProbe::default()
            ),
            Decision::Inside {
                id: "linked-a".into(),
                reveal: None
            }
        );
    }

    #[test]
    fn a_sibling_sharing_a_name_prefix_is_neither_inside_nor_an_overlap() {
        let records = [record("linked-a", "/work/paper", paper())];
        assert_eq!(
            at("/work/paper2", &other(), &records, &FakeProbe::default()),
            new()
        );
        let records = [record("linked-a", "/work/paper2/notes", paper())];
        assert_eq!(
            at("/work/paper", &other(), &records, &FakeProbe::default()),
            new()
        );
    }

    #[test]
    fn a_subfolder_of_a_missing_or_replaced_root_is_not_inside_it() {
        let records = [record("linked-a", "/work/paper", paper())];
        for state in [RootState::Missing, RootState::Different] {
            let probe = FakeProbe::default().state("linked-a", state);
            assert_eq!(
                at("/work/paper/chapters", &other(), &records, &probe),
                new()
            );
        }
    }

    #[test]
    fn an_enclosing_project_wins_over_a_stale_nested_identity() {
        let records = [
            record("linked-outer", "/work/thesis", other()),
            record("linked-inner", "/old/paper", paper()),
        ];
        assert_eq!(
            at(
                "/work/thesis/paper",
                &paper(),
                &records,
                &FakeProbe::default()
            ),
            Decision::Inside {
                id: "linked-outer".into(),
                reveal: Some("paper".into())
            }
        );
    }

    #[test]
    fn an_ancestor_of_registered_folders_is_an_overlap_listing_each_present_child() {
        let records = [
            record("linked-a", "/work/thesis/paper", paper()),
            record(
                "linked-b",
                "/work/thesis/slides",
                identity("vol-1", "30", Some(300)),
            ),
            record(
                "linked-c",
                "/work/thesis/gone",
                identity("vol-1", "40", Some(400)),
            ),
            record("linked-d", "/elsewhere", identity("vol-1", "50", Some(500))),
        ];
        let probe = FakeProbe::default().state("linked-c", RootState::Missing);
        assert_eq!(
            at(
                "/work/thesis",
                &identity("vol-1", "60", Some(600)),
                &records,
                &probe
            ),
            Decision::Overlap {
                children: vec![
                    OverlapChild {
                        id: "linked-a".into(),
                        name: "paper".into(),
                        relative_path: "paper".into()
                    },
                    OverlapChild {
                        id: "linked-b".into(),
                        name: "slides".into(),
                        relative_path: "slides".into()
                    },
                ]
            }
        );
    }

    #[test]
    fn a_moved_folder_that_now_contains_another_project_is_an_overlap() {
        let records = [
            record("linked-a", "/old/paper", paper()),
            record("linked-b", "/work/paper/notes", other()),
        ];
        assert!(matches!(
            at("/work/paper", &paper(), &records, &FakeProbe::default()),
            Decision::Overlap { children } if children.len() == 1 && children[0].id == "linked-b"
        ));
    }

    #[test]
    fn a_different_folder_at_a_registered_path_replaces_it_unless_that_record_is_displaced() {
        let mut records = [record("linked-a", "/work/paper", paper())];
        assert_eq!(
            at("/work/paper", &other(), &records, &FakeProbe::default()),
            Decision::Replace {
                displaced: "linked-a".into()
            }
        );
        records[0].displaced = Some(Displacement {
            by: "linked-b".into(),
            at_ms: 5,
        });
        assert_eq!(
            at("/work/paper", &other(), &records, &FakeProbe::default()),
            new()
        );
    }

    #[test]
    fn a_displaced_folder_seen_again_moves_back_to_its_id() {
        let mut displaced = record("linked-a", "/work/paper", paper());
        displaced.displaced = Some(Displacement {
            by: "linked-b".into(),
            at_ms: 5,
        });
        let records = [displaced, record("linked-b", "/work/paper", other())];
        assert_eq!(
            at("/work/old", &paper(), &records, &FakeProbe::default()),
            Decision::Moved {
                id: "linked-a".into(),
                from: "/work/paper".into()
            }
        );
    }

    #[test]
    fn weak_volumes_match_by_path_only() {
        let records = [record("linked-a", "/media/usb/paper", weak("10"))];
        assert_eq!(
            at(
                "/media/usb/paper",
                &weak("20"),
                &records,
                &FakeProbe::default()
            ),
            Decision::Existing {
                id: "linked-a".into()
            }
        );
        assert_eq!(
            at(
                "/media/usb/renamed",
                &weak("10"),
                &records,
                &FakeProbe::default()
            ),
            new()
        );
    }

    #[test]
    fn identities_without_a_birth_time_never_follow_a_move() {
        let unborn = identity("vol-1", "10", None);
        let records = [record("linked-a", "/work/paper", unborn.clone())];
        assert_eq!(
            at("/work/renamed", &unborn, &records, &FakeProbe::default()),
            new()
        );
        assert_eq!(
            at("/work/paper", &unborn, &records, &FakeProbe::default()),
            Decision::Existing {
                id: "linked-a".into()
            }
        );
        assert_eq!(
            at(
                "/work/paper",
                &identity("vol-1", "11", None),
                &records,
                &FakeProbe::default()
            ),
            Decision::Replace {
                displaced: "linked-a".into()
            }
        );
    }

    #[test]
    fn a_remounted_folder_is_rebound_only_after_verification() {
        let records = [record("linked-a", "/media/usb/paper", paper())];
        let remounted = identity("vol-2", "10", Some(100));
        assert_eq!(
            at(
                "/media/usb/paper",
                &remounted,
                &records,
                &FakeProbe::default()
            ),
            Decision::Replace {
                displaced: "linked-a".into()
            }
        );
        assert_eq!(
            at(
                "/media/usb1/paper",
                &remounted,
                &records,
                &FakeProbe::default()
            ),
            new()
        );
        let probe = FakeProbe::default().verify("linked-a");
        assert_eq!(
            at("/media/usb1/paper", &remounted, &records, &probe),
            Decision::Remounted {
                id: "linked-a".into(),
                from: "/media/usb/paper".into()
            }
        );
    }

    #[test]
    fn a_removed_project_returns_by_identity_and_is_offered_to_a_newcomer_at_its_path() {
        let mut removed = record("linked-a", "/work/paper", paper());
        removed.removed_at = Some(9);
        let records = [removed];
        assert_eq!(
            at("/work/renamed", &paper(), &records, &FakeProbe::default()),
            Decision::Revived {
                id: "linked-a".into(),
                from: "/work/paper".into()
            }
        );
        assert_eq!(
            at("/work/paper", &other(), &records, &FakeProbe::default()),
            Decision::New {
                removed_predecessor: Some("linked-a".into())
            }
        );
    }

    #[test]
    fn registered_paths_follow_the_volume_case_sensitivity() {
        let records = [record("linked-a", "/Work/Paper", paper())];
        assert_eq!(
            cased_at(
                "/work/paper/Sub",
                &other(),
                &records,
                &FakeProbe::default(),
                CaseSensitivity::Insensitive
            ),
            Decision::Inside {
                id: "linked-a".into(),
                reveal: Some("Sub".into())
            }
        );
        for case in [CaseSensitivity::Sensitive, CaseSensitivity::Unknown] {
            assert_eq!(
                cased_at(
                    "/work/paper/Sub",
                    &other(),
                    &records,
                    &FakeProbe::default(),
                    case
                ),
                new()
            );
        }
    }
}
