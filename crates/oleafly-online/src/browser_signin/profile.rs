use std::collections::BTreeSet;
use std::fs::{File, OpenOptions};
use std::io;
use std::path::{Path, PathBuf};
use std::time::Duration;

const PREFIX: &str = "profile-";
const LOCK_SUFFIX: &str = ".lock";
const CREATE_ATTEMPTS: u32 = 3;
const REMOVE_ATTEMPTS: u32 = 10;
const REMOVE_PAUSE: Duration = Duration::from_millis(200);

pub struct Profile {
    dir: PathBuf,
    lock_path: PathBuf,
    lock: Option<File>,
}

fn private_dir(path: &Path) -> io::Result<()> {
    std::fs::create_dir_all(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

fn claim(lock_path: &Path, create: bool) -> io::Result<File> {
    let file = OpenOptions::new()
        .create_new(create)
        .read(true)
        .write(true)
        .open(lock_path)?;
    oleafly_core::locking::lock_file(&file, true, Duration::ZERO)?;
    Ok(file)
}

fn remove_tree(dir: &Path) -> bool {
    for attempt in 0..REMOVE_ATTEMPTS {
        match std::fs::remove_dir_all(dir) {
            Ok(()) => return true,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return true,
            Err(_) if attempt + 1 < REMOVE_ATTEMPTS => std::thread::sleep(REMOVE_PAUSE),
            Err(_) => {}
        }
    }
    false
}

impl Profile {
    pub fn create(root: &Path) -> io::Result<Self> {
        private_dir(root)?;
        let mut last = io::Error::other("no profile name was free");
        for _ in 0..CREATE_ATTEMPTS {
            let name = format!("{PREFIX}{:016x}", rand::random::<u64>());
            let lock_path = root.join(format!("{name}{LOCK_SUFFIX}"));
            let lock = match claim(&lock_path, true) {
                Ok(lock) => lock,
                Err(error) => {
                    last = error;
                    continue;
                }
            };
            let dir = root.join(name);
            if let Err(error) = private_dir(&dir) {
                drop(lock);
                let _ = std::fs::remove_file(&lock_path);
                return Err(error);
            }
            return Ok(Self {
                dir,
                lock_path,
                lock: Some(lock),
            });
        }
        Err(last)
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    pub fn remove(mut self) -> bool {
        self.release()
    }

    fn release(&mut self) -> bool {
        let Some(lock) = self.lock.take() else {
            return true;
        };
        let removed = remove_tree(&self.dir);
        drop(lock);
        if removed {
            let _ = std::fs::remove_file(&self.lock_path);
        }
        removed
    }
}

impl Drop for Profile {
    fn drop(&mut self) {
        self.release();
    }
}

fn clear(root: &Path, stem: &str) -> bool {
    let dir = root.join(format!("{PREFIX}{stem}"));
    let lock_path = root.join(format!("{PREFIX}{stem}{LOCK_SUFFIX}"));
    let lock = match claim(&lock_path, false) {
        Ok(lock) => lock,
        Err(error) if error.kind() == io::ErrorKind::NotFound => match claim(&lock_path, true) {
            Ok(lock) => lock,
            Err(_) => return false,
        },
        Err(_) => return false,
    };
    let existed = dir.exists();
    let cleared = remove_tree(&dir);
    drop(lock);
    if cleared {
        let _ = std::fs::remove_file(&lock_path);
    }
    existed && cleared
}

pub fn sweep(root: &Path) -> usize {
    let Ok(entries) = std::fs::read_dir(root) else {
        return 0;
    };
    let stems: BTreeSet<String> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name().into_string().ok()?;
            let stem = name.strip_prefix(PREFIX)?;
            let stem = stem.strip_suffix(LOCK_SUFFIX).unwrap_or(stem);
            (!stem.is_empty() && stem.bytes().all(|byte| byte.is_ascii_hexdigit()))
                .then(|| stem.to_string())
        })
        .collect();
    stems.into_iter().filter(|stem| clear(root, stem)).count()
}
