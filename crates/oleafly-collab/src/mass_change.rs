#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MassChangeThreshold {
    pub min_files: usize,
    pub small_min_files: usize,
    pub fraction: f64,
}

impl Default for MassChangeThreshold {
    fn default() -> Self {
        MassChangeThreshold {
            min_files: 10,
            small_min_files: 3,
            fraction: 0.30,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MassChangeVerdict {
    Apply,
    Pause { changed: usize, total: usize },
    RootUnavailable,
}

pub fn evaluate(
    changed: usize,
    tracked: usize,
    root_exists: bool,
    threshold: &MassChangeThreshold,
) -> MassChangeVerdict {
    if !root_exists {
        return MassChangeVerdict::RootUnavailable;
    }
    let many_files = changed >= threshold.min_files;
    let large_share = changed >= threshold.small_min_files
        && changed as f64 >= threshold.fraction * tracked as f64;
    if many_files || large_share {
        MassChangeVerdict::Pause {
            changed,
            total: tracked,
        }
    } else {
        MassChangeVerdict::Apply
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn verdict(changed: usize, tracked: usize) -> MassChangeVerdict {
        evaluate(changed, tracked, true, &MassChangeThreshold::default())
    }

    #[test]
    fn the_default_threshold_is_ten_files_or_three_files_and_thirty_percent() {
        assert_eq!(
            MassChangeThreshold::default(),
            MassChangeThreshold {
                min_files: 10,
                small_min_files: 3,
                fraction: 0.30,
            }
        );
    }

    #[test]
    fn review_focus_1_saving_one_file_in_a_three_file_project_does_not_pause() {
        assert_eq!(verdict(1, 3), MassChangeVerdict::Apply);
        assert_eq!(verdict(0, 3), MassChangeVerdict::Apply);
    }

    #[test]
    fn three_of_nine_files_is_a_large_share_and_pauses() {
        assert_eq!(
            verdict(3, 9),
            MassChangeVerdict::Pause {
                changed: 3,
                total: 9
            }
        );
    }

    #[test]
    fn two_of_four_files_stays_below_the_small_minimum_and_applies() {
        assert_eq!(verdict(2, 4), MassChangeVerdict::Apply);
        assert_eq!(verdict(2, 2), MassChangeVerdict::Apply);
    }

    #[test]
    fn ten_files_pause_however_large_the_project() {
        assert_eq!(
            verdict(10, 1000),
            MassChangeVerdict::Pause {
                changed: 10,
                total: 1000
            }
        );
        assert_eq!(verdict(9, 1000), MassChangeVerdict::Apply);
    }

    #[test]
    fn the_share_boundary_is_inclusive() {
        assert_eq!(
            verdict(3, 10),
            MassChangeVerdict::Pause {
                changed: 3,
                total: 10
            }
        );
        assert_eq!(verdict(3, 11), MassChangeVerdict::Apply);
        assert_eq!(
            verdict(9, 30),
            MassChangeVerdict::Pause {
                changed: 9,
                total: 30
            }
        );
    }

    #[test]
    fn a_missing_root_is_unavailable_never_a_deletion() {
        let threshold = MassChangeThreshold::default();
        assert_eq!(
            evaluate(0, 3, false, &threshold),
            MassChangeVerdict::RootUnavailable
        );
        assert_eq!(
            evaluate(3, 3, false, &threshold),
            MassChangeVerdict::RootUnavailable
        );
        assert_eq!(
            evaluate(1000, 1000, false, &threshold),
            MassChangeVerdict::RootUnavailable
        );
    }

    #[test]
    fn zero_tracked_files_apply_until_three_files_change() {
        assert_eq!(verdict(0, 0), MassChangeVerdict::Apply);
        assert_eq!(verdict(2, 0), MassChangeVerdict::Apply);
        assert_eq!(
            verdict(3, 0),
            MassChangeVerdict::Pause {
                changed: 3,
                total: 0
            }
        );
    }

    #[test]
    fn a_custom_threshold_is_respected() {
        let strict = MassChangeThreshold {
            min_files: 2,
            small_min_files: 1,
            fraction: 0.5,
        };
        assert_eq!(
            evaluate(1, 2, true, &strict),
            MassChangeVerdict::Pause {
                changed: 1,
                total: 2
            }
        );
        assert_eq!(evaluate(1, 3, true, &strict), MassChangeVerdict::Apply);
    }
}
