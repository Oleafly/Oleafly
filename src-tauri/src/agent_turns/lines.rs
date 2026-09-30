//! Added and removed line counts for one changed file, computed the same way
//! as `diffLineCounts` in `src/store/agent-file-changes.ts` so the turn card
//! and the assistant's own summaries agree.

/// Files larger than this on either side get no line counts.
pub(super) const MAX_COUNTED_BYTES: u64 = 2 * 1024 * 1024;
const MAX_DIFF_WORK: usize = 2_000_000;

/// `(added, removed)` lines between two UTF-8 texts, or `None` when either
/// side is not text.
pub(super) fn line_counts(before: &[u8], after: &[u8]) -> Option<(u32, u32)> {
    let before = std::str::from_utf8(before).ok()?;
    let after = std::str::from_utf8(after).ok()?;
    if before.contains('\0') || after.contains('\0') {
        return None;
    }
    let before = normalized(before);
    let after = normalized(after);
    let old = content_lines(&before);
    let new = content_lines(&after);
    let (prefix, old_end, new_end) = common_affix_bounds(&old, &new);
    let old_count = old_end - prefix;
    let new_count = new_end - prefix;
    let counts = match edit_distance(&old[prefix..old_end], &new[prefix..new_end]) {
        Some(distance) => {
            let delta = new_count as i64 - old_count as i64;
            let distance = distance as i64;
            ((distance + delta) / 2, (distance - delta) / 2)
        }
        None => (new_count as i64, old_count as i64),
    };
    Some((clamp(counts.0), clamp(counts.1)))
}

fn clamp(value: i64) -> u32 {
    u32::try_from(value.max(0)).unwrap_or(u32::MAX)
}

fn normalized(text: &str) -> String {
    text.replace("\r\n", "\n").replace('\r', "\n")
}

fn content_lines(text: &str) -> Vec<&str> {
    if text.is_empty() {
        return Vec::new();
    }
    let mut lines: Vec<&str> = text.split('\n').collect();
    if text.ends_with('\n') {
        lines.pop();
    }
    lines
}

fn common_affix_bounds(old: &[&str], new: &[&str]) -> (usize, usize, usize) {
    let mut prefix = 0;
    while prefix < old.len() && prefix < new.len() && old[prefix] == new[prefix] {
        prefix += 1;
    }
    let (mut old_end, mut new_end) = (old.len(), new.len());
    while old_end > prefix && new_end > prefix && old[old_end - 1] == new[new_end - 1] {
        old_end -= 1;
        new_end -= 1;
    }
    (prefix, old_end, new_end)
}

/// Myers' edit distance with a work limit; `None` when the limit is hit.
fn edit_distance(old: &[&str], new: &[&str]) -> Option<usize> {
    let (old_count, new_count) = (old.len(), new.len());
    if old_count == 0 {
        return Some(new_count);
    }
    if new_count == 0 {
        return Some(old_count);
    }
    let max = old_count + new_count;
    let offset = max as isize + 1;
    let mut frontier = vec![-1_isize; max * 2 + 3];
    frontier[(offset + 1) as usize] = 0;
    let mut work = 0_usize;
    for distance in 0..=max as isize {
        let mut diagonal = -distance;
        while diagonal <= distance {
            work += 1;
            if work > MAX_DIFF_WORK {
                return None;
            }
            let index = (offset + diagonal) as usize;
            let upper = diagonal == -distance
                || (diagonal != distance && frontier[index - 1] < frontier[index + 1]);
            let mut old_index = if upper {
                frontier[index + 1]
            } else {
                frontier[index - 1] + 1
            };
            let mut new_index = old_index - diagonal;
            while (old_index as usize) < old_count
                && new_index >= 0
                && (new_index as usize) < new_count
                && old[old_index as usize] == new[new_index as usize]
            {
                old_index += 1;
                new_index += 1;
            }
            frontier[index] = old_index;
            if old_index as usize >= old_count && new_index >= 0 && new_index as usize >= new_count
            {
                return Some(distance as usize);
            }
            diagonal += 2;
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::line_counts;

    #[test]
    fn counts_match_the_frontend_line_diff() {
        assert_eq!(line_counts(b"", b""), Some((0, 0)));
        assert_eq!(line_counts(b"", b"a\nb\n"), Some((2, 0)));
        assert_eq!(line_counts(b"a\nb\n", b""), Some((0, 2)));
        assert_eq!(line_counts(b"a\nb\nc\n", b"a\nB\nc\n"), Some((1, 1)));
        assert_eq!(line_counts(b"a\r\nb\r\n", b"a\nb\n"), Some((0, 0)));
        assert_eq!(line_counts(b"a\nb\nc", b"a\nc\nd\ne"), Some((2, 1)));
    }

    #[test]
    fn binary_sides_have_no_counts() {
        assert_eq!(line_counts(b"a\0b", b"a"), None);
        assert_eq!(line_counts(b"a", &[0xff, 0xfe]), None);
    }
}
