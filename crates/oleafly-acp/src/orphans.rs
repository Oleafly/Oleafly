//! Agent processes left behind by an Oleafly that crashed or was killed.
//! Every agent the app (or the background helper) starts is listed in
//! `agents.pids` with its owner; at the next start, agents whose owner is
//! gone are stopped. A reused process id is never stopped: the start time
//! must still match.
use std::fs::{File, OpenOptions};
use std::io::{self, BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

use oleafly_sandbox::process::identity::ProcessIdentity;
use serde::{Deserialize, Serialize};

const FILE_NAME: &str = "agents.pids";
const LOCK_NAME: &str = "agents.pids.lock";
const LOCK_BUDGET: Duration = Duration::from_secs(5);
const MAX_LINE: usize = 8 * 1024;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct OwnerTag {
    /// "app" or "daemon".
    pub kind: String,
    pub identity: ProcessIdentity,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
struct Entry {
    owner: OwnerTag,
    pid: u32,
    started: Option<u64>,
    program: String,
}

pub struct PidRegistry {
    dir: PathBuf,
    owner: OwnerTag,
}

fn locked(dir: &Path) -> io::Result<File> {
    std::fs::create_dir_all(dir)?;
    let lock = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(dir.join(LOCK_NAME))?;
    oleafly_core::locking::lock_file(&lock, true, LOCK_BUDGET)?;
    Ok(lock)
}

fn read_entries(dir: &Path) -> io::Result<Vec<Entry>> {
    let file = match File::open(dir.join(FILE_NAME)) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error),
    };
    Ok(BufReader::new(file)
        .lines()
        .map_while(Result::ok)
        .filter(|line| line.len() <= MAX_LINE)
        .filter_map(|line| serde_json::from_str(&line).ok())
        .collect())
}

fn write_entries(dir: &Path, entries: &[Entry]) -> io::Result<()> {
    let path = dir.join(FILE_NAME);
    if entries.is_empty() {
        return match std::fs::remove_file(&path) {
            Err(error) if error.kind() != io::ErrorKind::NotFound => Err(error),
            _ => Ok(()),
        };
    }
    let temporary = dir.join(format!("{FILE_NAME}.{}.tmp", std::process::id()));
    {
        let mut file = File::create(&temporary)?;
        for entry in entries {
            let line = serde_json::to_string(entry).map_err(io::Error::other)?;
            writeln!(file, "{line}")?;
        }
        file.sync_all()?;
    }
    std::fs::rename(&temporary, &path)
}

#[cfg(unix)]
fn stop(pid: u32) -> bool {
    let Ok(pid) = i32::try_from(pid) else {
        return false;
    };
    if pid <= 1 {
        return false;
    }
    // Agents run in their own process group, so the whole tree goes.
    unsafe {
        libc::kill(-pid, libc::SIGKILL);
        libc::kill(pid, libc::SIGKILL);
    }
    true
}

#[cfg(not(unix))]
fn stop(_pid: u32) -> bool {
    false
}

impl PidRegistry {
    pub fn open(dir: &Path, owner: OwnerTag) -> io::Result<Self> {
        std::fs::create_dir_all(dir)?;
        Ok(Self {
            dir: dir.to_path_buf(),
            owner,
        })
    }

    pub fn add(&self, pid: u32, started: Option<u64>, program: &Path) -> io::Result<()> {
        let _lock = locked(&self.dir)?;
        let entry = Entry {
            owner: self.owner.clone(),
            pid,
            started,
            program: program.to_string_lossy().chars().take(1024).collect(),
        };
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(self.dir.join(FILE_NAME))?;
        let line = serde_json::to_string(&entry).map_err(io::Error::other)?;
        writeln!(file, "{line}")?;
        file.flush()
    }

    pub fn remove(&self, pid: u32) -> io::Result<()> {
        let _lock = locked(&self.dir)?;
        let entries: Vec<Entry> = read_entries(&self.dir)?
            .into_iter()
            .filter(|entry| !(entry.pid == pid && entry.owner == self.owner))
            .collect();
        write_entries(&self.dir, &entries)
    }

    /// Stops the agents whose owner is gone and that are still the process
    /// that was listed, and drops their lines. Returns the stopped ids.
    /// Windows only drops the lines: its agents die with their job object.
    pub fn reap(
        dir: &Path,
        owner_alive: impl Fn(&OwnerTag) -> bool,
        still_same: impl Fn(u32, Option<u64>) -> bool,
    ) -> io::Result<Vec<u32>> {
        let _lock = locked(dir)?;
        let mut kept = Vec::new();
        let mut stopped = Vec::new();
        for entry in read_entries(dir)? {
            if owner_alive(&entry.owner) {
                kept.push(entry);
                continue;
            }
            if still_same(entry.pid, entry.started) && stop(entry.pid) {
                stopped.push(entry.pid);
            }
        }
        write_entries(dir, &kept)?;
        Ok(stopped)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn owner(pid: u32, kind: &str) -> OwnerTag {
        OwnerTag {
            kind: kind.into(),
            identity: ProcessIdentity {
                pid,
                started: Some(1),
            },
        }
    }

    #[test]
    fn reap_skips_a_reused_pid() {
        let dir = tempfile::tempdir().unwrap();
        let registry = PidRegistry::open(dir.path(), owner(4_000_001, "app")).unwrap();
        registry
            .add(4_000_002, Some(10), Path::new("/bin/agent"))
            .unwrap();
        let stopped =
            PidRegistry::reap(dir.path(), |_| false, |_, started| started == Some(99)).unwrap();
        assert!(stopped.is_empty());
        assert!(read_entries(dir.path()).unwrap().is_empty());
    }

    #[test]
    fn live_owners_keep_their_lines() {
        let dir = tempfile::tempdir().unwrap();
        let daemon = PidRegistry::open(dir.path(), owner(4_000_010, "daemon")).unwrap();
        daemon
            .add(4_000_011, Some(5), Path::new("/bin/agent"))
            .unwrap();
        let stopped =
            PidRegistry::reap(dir.path(), |tag| tag.kind == "daemon", |_, _| true).unwrap();
        assert!(stopped.is_empty());
        assert_eq!(read_entries(dir.path()).unwrap().len(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn reap_kills_agents_of_a_dead_owner_and_keeps_live_owners() {
        let dir = tempfile::tempdir().unwrap();
        let mut child = std::process::Command::new("sleep")
            .arg("60")
            .spawn()
            .unwrap();
        let dead = PidRegistry::open(dir.path(), owner(4_000_020, "app")).unwrap();
        dead.add(child.id(), None, Path::new("sleep")).unwrap();
        let live = PidRegistry::open(dir.path(), owner(4_000_021, "daemon")).unwrap();
        live.add(4_000_022, None, Path::new("agent")).unwrap();
        let stopped = PidRegistry::reap(
            dir.path(),
            |tag| tag.identity.pid == 4_000_021,
            |pid, _| pid == child.id(),
        )
        .unwrap();
        assert_eq!(stopped, vec![child.id()]);
        let status = child.wait().unwrap();
        assert!(!status.success());
        let left = read_entries(dir.path()).unwrap();
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].pid, 4_000_022);
    }

    #[cfg(windows)]
    #[test]
    fn reap_never_kills_on_windows() {
        let dir = tempfile::tempdir().unwrap();
        let registry = PidRegistry::open(dir.path(), owner(4_000_030, "app")).unwrap();
        registry
            .add(std::process::id(), None, Path::new("agent.exe"))
            .unwrap();
        let stopped = PidRegistry::reap(dir.path(), |_| false, |_, _| true).unwrap();
        assert!(stopped.is_empty());
    }

    #[test]
    fn concurrent_adds_and_removes_keep_valid_lines() {
        let dir = tempfile::tempdir().unwrap();
        let threads: Vec<_> = (0..8u32)
            .map(|index| {
                let path = dir.path().to_path_buf();
                std::thread::spawn(move || {
                    let registry =
                        PidRegistry::open(&path, owner(4_100_000 + index, "app")).unwrap();
                    for pid in 0..20u32 {
                        registry
                            .add(5_000_000 + index * 100 + pid, None, Path::new("agent"))
                            .unwrap();
                        if pid % 2 == 0 {
                            registry.remove(5_000_000 + index * 100 + pid).unwrap();
                        }
                    }
                })
            })
            .collect();
        for thread in threads {
            thread.join().unwrap();
        }
        let text = std::fs::read_to_string(dir.path().join(FILE_NAME)).unwrap();
        assert!(text
            .lines()
            .all(|line| serde_json::from_str::<Entry>(line).is_ok()));
        assert_eq!(text.lines().count(), 8 * 10);
    }
}
