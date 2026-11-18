// Myers' diff, ported from loro-internal 1.16.2 src/diff/diff_impl.rs (MIT),
// which copied it from the similar crate's src/algorithms/myers.rs
// (Apache License 2.0, https://www.apache.org/licenses/LICENSE-2.0).

use std::iter::zip;
use std::ops::{Index, IndexMut};
use std::time::Instant;

pub(crate) struct TimedOut;

pub(crate) trait Edits {
    fn insert(&mut self, old_index: usize, new_index: usize, new_len: usize);
    fn delete(&mut self, old_index: usize, old_len: usize);
}

fn common_prefix(old: &[u32], new: &[u32]) -> usize {
    let chunk = 4;
    let off = zip(old.chunks_exact(chunk), new.chunks_exact(chunk))
        .take_while(|(a, b)| a == b)
        .count()
        * chunk;
    off + zip(&old[off..], &new[off..])
        .take_while(|(a, b)| a == b)
        .count()
}

fn common_suffix(old: &[u32], new: &[u32]) -> usize {
    let chunk = 4;
    let off = zip(old.rchunks_exact(chunk), new.rchunks_exact(chunk))
        .take_while(|(a, b)| a == b)
        .count()
        * chunk;
    off + zip(
        old[..old.len() - off].iter().rev(),
        new[..new.len() - off].iter().rev(),
    )
    .take_while(|(a, b)| a == b)
    .count()
}

struct Diagonals(isize, Vec<usize>);

impl Diagonals {
    fn new(max_d: usize) -> Diagonals {
        Diagonals(max_d as isize, vec![0; max_d << 1])
    }
}

impl Index<isize> for Diagonals {
    type Output = usize;

    fn index(&self, index: isize) -> &usize {
        &self.1[(index + self.0) as usize]
    }
}

impl IndexMut<isize> for Diagonals {
    fn index_mut(&mut self, index: isize) -> &mut usize {
        &mut self.1[(index + self.0) as usize]
    }
}

struct Window {
    old_start: usize,
    old_end: usize,
    new_start: usize,
    new_end: usize,
    delta: isize,
    odd: bool,
}

impl Window {
    fn lengths(&self) -> (usize, usize) {
        (self.old_end - self.old_start, self.new_end - self.new_start)
    }
}

fn furthest(diagonals: &Diagonals, d: isize, k: isize) -> usize {
    if k == -d || (k != d && diagonals[k - 1] < diagonals[k + 1]) {
        diagonals[k + 1]
    } else {
        diagonals[k - 1] + 1
    }
}

struct Search<'a> {
    old: &'a [u32],
    new: &'a [u32],
    deadline: Instant,
    forward: Diagonals,
    backward: Diagonals,
}

pub(crate) fn diff(
    edits: &mut impl Edits,
    deadline: Instant,
    old: &[u32],
    new: &[u32],
) -> Result<(), TimedOut> {
    let max_d = (old.len() + new.len()).div_ceil(2) + 1;
    let mut search = Search {
        old,
        new,
        deadline,
        forward: Diagonals::new(max_d),
        backward: Diagonals::new(max_d),
    };
    search.conquer(edits, 0, old.len(), 0, new.len())
}

impl Search<'_> {
    fn waited_too_long(&self) -> Result<(), TimedOut> {
        if Instant::now() > self.deadline {
            Err(TimedOut)
        } else {
            Ok(())
        }
    }

    fn middle_snake(
        &mut self,
        old_start: usize,
        old_end: usize,
        new_start: usize,
        new_end: usize,
    ) -> Result<Option<(usize, usize)>, TimedOut> {
        let n = old_end - old_start;
        let m = new_end - new_start;
        let delta = n as isize - m as isize;
        let window = Window {
            old_start,
            old_end,
            new_start,
            new_end,
            delta,
            odd: delta & 1 != 0,
        };
        self.forward[1] = 0;
        self.backward[1] = 0;
        let d_max = (n + m).div_ceil(2) + 1;
        for d in 0..d_max as isize {
            for k in (-d..=d).rev().step_by(2) {
                if let Some(found) = self.forward_snake(&window, d, k) {
                    return Ok(Some(found));
                }
                self.waited_too_long()?;
            }
            for k in (-d..=d).rev().step_by(2) {
                if let Some(found) = self.backward_snake(&window, d, k) {
                    return Ok(Some(found));
                }
                self.waited_too_long()?;
            }
        }
        Ok(None)
    }

    fn forward_snake(&mut self, window: &Window, d: isize, k: isize) -> Option<(usize, usize)> {
        let (n, m) = window.lengths();
        let mut x = furthest(&self.forward, d, k);
        let y = (x as isize - k) as usize;
        let (x0, y0) = (x, y);
        if x < n && y < m {
            x += common_prefix(
                &self.old[window.old_start + x..window.old_end],
                &self.new[window.new_start + y..window.new_end],
            );
        }
        self.forward[k] = x;
        if window.odd && (k - window.delta).abs() < d && x + self.backward[window.delta - k] >= n {
            return Some((x0 + window.old_start, y0 + window.new_start));
        }
        None
    }

    fn backward_snake(&mut self, window: &Window, d: isize, k: isize) -> Option<(usize, usize)> {
        let (n, m) = window.lengths();
        let mut x = furthest(&self.backward, d, k);
        let mut y = (x as isize - k) as usize;
        if x < n && y < m {
            let advance = common_suffix(
                &self.old[window.old_start..window.old_start + n - x],
                &self.new[window.new_start..window.new_start + m - y],
            );
            x += advance;
            y += advance;
        }
        self.backward[k] = x;
        if !window.odd && (k - window.delta).abs() <= d && x + self.forward[window.delta - k] >= n {
            return Some((n - x + window.old_start, m - y + window.new_start));
        }
        None
    }

    fn conquer(
        &mut self,
        edits: &mut impl Edits,
        mut old_start: usize,
        mut old_end: usize,
        mut new_start: usize,
        mut new_end: usize,
    ) -> Result<(), TimedOut> {
        let prefix = common_prefix(&self.old[old_start..old_end], &self.new[new_start..new_end]);
        old_start += prefix;
        new_start += prefix;
        let suffix = common_suffix(&self.old[old_start..old_end], &self.new[new_start..new_end]);
        old_end -= suffix;
        new_end -= suffix;
        if old_start >= old_end && new_start >= new_end {
            return Ok(());
        }
        if new_start >= new_end {
            edits.delete(old_start, old_end - old_start);
        } else if old_start >= old_end {
            edits.insert(old_start, new_start, new_end - new_start);
        } else if let Some((x, y)) = self.middle_snake(old_start, old_end, new_start, new_end)? {
            self.conquer(edits, old_start, x, new_start, y)?;
            self.conquer(edits, x, old_end, y, new_end)?;
        } else {
            edits.delete(old_start, old_end - old_start);
            edits.insert(old_start, new_start, new_end - new_start);
        }
        Ok(())
    }
}
