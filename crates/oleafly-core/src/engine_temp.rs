use std::ffi::OsString;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

pub const TEMP_DIRECTORY_VARIABLES: [&str; 3] = ["TMP", "TEMP", "TMPDIR"];
pub const ENGINE_TEMP_DIR: &str = "engine-tmp";
pub const PANDOC_RESOURCE_PATH_VARIABLE: &str = "OLEAFLY_PANDOC_RESOURCE_PATH";

const SCRATCH_PREFIX: &str = "oleafly-engine-";
const PANDOC_DEFAULTS_FILE: &str = "pandoc-defaults.json";
const SEARCH_PATH_SEPARATOR: u8 = if cfg!(windows) { b';' } else { b':' };
const UNSAFE_BASE_SUFFIX: &str = "~";
const TEX_HOSTILE: [char; 8] = ['~', '#', '%', '^', '{', '}', '&', '$'];
const STALE_SCRATCH_AGE: Duration = Duration::from_secs(24 * 60 * 60);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EngineScratchBases {
    pub system: PathBuf,
    pub owned: Option<PathBuf>,
    pub build: PathBuf,
}

impl EngineScratchBases {
    pub fn new(owned: Option<PathBuf>, build: impl Into<PathBuf>) -> Self {
        Self {
            system: std::env::temp_dir(),
            owned,
            build: build.into(),
        }
    }

    fn preferred(&self) -> impl Iterator<Item = (&Path, bool)> {
        std::iter::once((self.system.as_path(), false))
            .chain(self.owned.as_deref().map(|owned| (owned, true)))
            .chain(std::iter::once((self.build.as_path(), true)))
    }

    fn fallbacks(&self) -> impl Iterator<Item = (&Path, bool)> {
        self.owned
            .as_deref()
            .map(|owned| (owned, true))
            .into_iter()
            .chain([(self.build.as_path(), true), (self.system.as_path(), false)])
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PandocResourcePath {
    pub argument: OsString,
    pub variable: Option<(&'static str, OsString)>,
}

#[derive(Debug)]
pub struct EngineScratch {
    directory: tempfile::TempDir,
}

impl PartialEq for EngineScratch {
    fn eq(&self, other: &Self) -> bool {
        self.path() == other.path()
    }
}

impl Eq for EngineScratch {}

impl EngineScratch {
    pub fn create(bases: &EngineScratchBases) -> io::Result<Self> {
        for (base, _) in bases.preferred() {
            sweep_stale_scratch(base, STALE_SCRATCH_AGE);
        }
        for (base, create) in bases.preferred() {
            let Ok(base) = resolve_base(base, create) else {
                continue;
            };
            if !tex_safe_path(&base) {
                continue;
            }
            if let Ok(directory) = scratch_directory(&base, "") {
                return Ok(Self { directory });
            }
        }
        let mut failure = None;
        for (base, create) in bases.fallbacks() {
            match resolve_base(base, create)
                .and_then(|base| scratch_directory(&base, UNSAFE_BASE_SUFFIX))
            {
                Ok(directory) => return Ok(Self { directory }),
                Err(error) => failure = Some(error),
            }
        }
        Err(failure.unwrap_or_else(|| {
            io::Error::new(io::ErrorKind::NotFound, "no temporary folder was available")
        }))
    }

    pub fn path(&self) -> &Path {
        self.directory.path()
    }

    pub fn pandoc_resource_path(&self, project: &Path) -> io::Result<PandocResourcePath> {
        if !project
            .as_os_str()
            .as_encoded_bytes()
            .contains(&SEARCH_PATH_SEPARATOR)
        {
            let mut argument = OsString::from("--resource-path=");
            argument.push(project);
            return Ok(PandocResourcePath {
                argument,
                variable: None,
            });
        }
        let literal = project.to_str().filter(|text| !text.contains("${"));
        let entry = literal.map_or_else(
            || format!("${{{PANDOC_RESOURCE_PATH_VARIABLE}}}"),
            str::to_owned,
        );
        let defaults = self.path().join(PANDOC_DEFAULTS_FILE);
        std::fs::write(
            &defaults,
            serde_json::json!({ "resource-path": [entry] }).to_string(),
        )?;
        let mut argument = OsString::from("--defaults=");
        argument.push(&defaults);
        Ok(PandocResourcePath {
            argument,
            variable: literal.is_none().then(|| {
                (
                    PANDOC_RESOURCE_PATH_VARIABLE,
                    project.as_os_str().to_owned(),
                )
            }),
        })
    }
}

pub fn tex_safe_path(path: &Path) -> bool {
    let Some(text) = path.to_str() else {
        return false;
    };
    if !path.is_absolute() || text.contains(TEX_HOSTILE) || text.chars().any(char::is_control) {
        return false;
    }
    #[cfg(windows)]
    {
        use std::path::{Component, Prefix};
        matches!(
            path.components().next(),
            Some(Component::Prefix(prefix)) if matches!(prefix.kind(), Prefix::Disk(_))
        )
    }
    #[cfg(not(windows))]
    !text.contains('\\')
}

pub fn plain_path(path: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        use std::path::{Component, Prefix};
        let mut components = path.components();
        let Some(Component::Prefix(prefix)) = components.next() else {
            return path.to_path_buf();
        };
        let mut plain = match prefix.kind() {
            Prefix::VerbatimDisk(letter) => PathBuf::from(format!("{}:\\", char::from(letter))),
            Prefix::VerbatimUNC(server, share) => {
                let mut root = std::ffi::OsString::from(r"\\");
                root.push(server);
                root.push(r"\");
                root.push(share);
                root.push(r"\");
                PathBuf::from(root)
            }
            _ => return path.to_path_buf(),
        };
        for component in components {
            match component {
                Component::RootDir => {}
                Component::Normal(part) => plain.push(part),
                _ => return path.to_path_buf(),
            }
        }
        plain
    }
    #[cfg(not(windows))]
    path.to_path_buf()
}

fn long_path(path: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        long_path_name(path).unwrap_or_else(|| path.to_path_buf())
    }
    #[cfg(not(windows))]
    path.to_path_buf()
}

#[cfg(windows)]
pub fn long_path_name(path: &Path) -> Option<PathBuf> {
    use std::os::windows::ffi::{OsStrExt, OsStringExt};
    use windows_sys::Win32::Storage::FileSystem::GetLongPathNameW;

    let input: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    if input[..input.len() - 1].contains(&0) {
        return None;
    }
    let required = unsafe { GetLongPathNameW(input.as_ptr(), std::ptr::null_mut(), 0) };
    if required == 0 || required > 32_768 {
        return None;
    }
    let mut output = vec![0u16; required as usize];
    let written = unsafe { GetLongPathNameW(input.as_ptr(), output.as_mut_ptr(), required) };
    if written == 0 || written >= required {
        return None;
    }
    Some(PathBuf::from(std::ffi::OsString::from_wide(
        &output[..written as usize],
    )))
}

fn resolve_base(base: &Path, create: bool) -> io::Result<PathBuf> {
    if !base.is_absolute() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("{} is not an absolute path", base.display()),
        ));
    }
    if create {
        std::fs::create_dir_all(base)?;
    }
    let canonical = std::fs::canonicalize(base)?;
    if !canonical.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            format!("{} is not a folder", base.display()),
        ));
    }
    Ok(plain_path(&long_path(&canonical)))
}

fn scratch_directory(base: &Path, suffix: &str) -> io::Result<tempfile::TempDir> {
    let mut builder = tempfile::Builder::new();
    builder.prefix(SCRATCH_PREFIX).suffix(suffix);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        builder.permissions(std::fs::Permissions::from_mode(0o700));
    }
    builder.tempdir_in(base)
}

fn sweep_stale_scratch(base: &Path, max_age: Duration) {
    let Ok(entries) = std::fs::read_dir(base) else {
        return;
    };
    let now = SystemTime::now();
    for entry in entries.flatten() {
        let ours = entry
            .file_name()
            .to_str()
            .is_some_and(|name| name.starts_with(SCRATCH_PREFIX))
            && entry.file_type().is_ok_and(|kind| kind.is_dir());
        if !ours {
            continue;
        }
        let stale = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .ok()
            .and_then(|modified| now.duration_since(modified).ok())
            .is_some_and(|age| age >= max_age);
        if stale {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn canonical(path: &Path) -> PathBuf {
        plain_path(&long_path(&std::fs::canonicalize(path).unwrap()))
    }

    fn bases(system: PathBuf, owned: Option<PathBuf>, build: PathBuf) -> EngineScratchBases {
        EngineScratchBases {
            system,
            owned,
            build,
        }
    }

    fn names(path: &Path) -> Vec<String> {
        let mut names: Vec<_> = std::fs::read_dir(path)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    #[test]
    fn a_safe_system_temp_folder_gets_a_fresh_scratch_folder_per_compile() {
        let root = TempDir::new().unwrap();
        let system = root.path().join("system tmp é");
        std::fs::create_dir(&system).unwrap();
        let owned = root.path().join("data").join(ENGINE_TEMP_DIR);
        let build = root.path().join("build");
        let chosen = bases(system.clone(), Some(owned.clone()), build.clone());
        let first = EngineScratch::create(&chosen).unwrap();
        let second = EngineScratch::create(&chosen).unwrap();
        assert_ne!(first.path(), second.path());
        for scratch in [&first, &second] {
            assert_eq!(scratch.path().parent().unwrap(), canonical(&system));
            assert!(scratch.path().is_dir());
            assert!(
                tex_safe_path(scratch.path()),
                "{}",
                scratch.path().display()
            );
        }
        assert!(!owned.exists());
        assert!(!build.exists());
        let first_path = first.path().to_path_buf();
        drop(first);
        assert!(!first_path.exists());
        assert!(second.path().is_dir());
    }

    #[test]
    fn hostile_characters_move_the_scratch_folder_to_the_next_base() {
        let root = TempDir::new().unwrap();
        for (index, hostile) in ["~", "#", "%", "^", "{", "}", "&", "$"].iter().enumerate() {
            let system = root.path().join(format!("tmp {hostile} {index}"));
            std::fs::create_dir(&system).unwrap();
            let owned = root
                .path()
                .join(format!("data {index}"))
                .join(ENGINE_TEMP_DIR);
            let scratch = EngineScratch::create(&bases(
                system.clone(),
                Some(owned.clone()),
                root.path().join("build"),
            ))
            .unwrap();
            assert!(tex_safe_path(scratch.path()), "{hostile}");
            assert_eq!(scratch.path().parent().unwrap(), canonical(&owned));
            assert!(names(&system).is_empty(), "{hostile}");
        }
        let unsafe_owned = root.path().join("data #1").join(ENGINE_TEMP_DIR);
        let build = root.path().join("linked").join("build");
        let scratch = EngineScratch::create(&bases(
            root.path().join("tmp~x"),
            Some(unsafe_owned),
            build.clone(),
        ))
        .unwrap();
        assert!(tex_safe_path(scratch.path()));
        assert_eq!(scratch.path().parent().unwrap(), canonical(&build));
    }

    #[test]
    fn spaces_non_ascii_and_apostrophes_are_safe_for_tex() {
        let root = Path::new(if cfg!(windows) {
            r"C:\scratch"
        } else {
            "/scratch"
        });
        assert!(tex_safe_path(&root.join("Bob's notes é 2")));
        for hostile in [
            "a~b", "a#b", "a%b", "a^b", "a{b", "a}b", "a&b", "a$b", "a\nb",
        ] {
            assert!(!tex_safe_path(&root.join(hostile)), "{hostile}");
        }
        assert!(!tex_safe_path(Path::new("relative")));
    }

    #[cfg(unix)]
    #[test]
    fn a_backslash_or_invalid_utf8_is_unsafe_off_windows() {
        use std::os::unix::ffi::OsStrExt;
        assert!(!tex_safe_path(Path::new("/tmp/a\\b")));
        assert!(!tex_safe_path(Path::new(std::ffi::OsStr::from_bytes(
            b"/tmp/a\xffb"
        ))));
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_to_a_hostile_folder_is_judged_by_its_target() {
        let root = TempDir::new().unwrap();
        let target = root.path().join("real #tmp");
        std::fs::create_dir(&target).unwrap();
        let link = root.path().join("tmp");
        std::os::unix::fs::symlink(&target, &link).unwrap();
        let build = root.path().join("build");
        let scratch = EngineScratch::create(&bases(link, None, build.clone())).unwrap();
        assert_eq!(scratch.path().parent().unwrap(), canonical(&build));
        assert!(names(&target).is_empty());
    }

    #[test]
    fn without_a_tex_safe_base_the_scratch_folder_name_ends_in_a_tilde() {
        let root = TempDir::new().unwrap();
        let system = root.path().join("tmp #1");
        std::fs::create_dir(&system).unwrap();
        let owned = root.path().join("data {x}").join(ENGINE_TEMP_DIR);
        let build = root.path().join("build 50%");
        let scratch =
            EngineScratch::create(&bases(system.clone(), Some(owned.clone()), build.clone()))
                .unwrap();
        assert_eq!(scratch.path().parent().unwrap(), canonical(&owned));
        assert!(scratch.path().to_string_lossy().ends_with('~'));
        assert!(names(&system).is_empty());
        let path = scratch.path().to_path_buf();
        drop(scratch);
        assert!(!path.exists());

        let without_owned =
            EngineScratch::create(&bases(system.clone(), None, build.clone())).unwrap();
        assert!(without_owned.path().to_string_lossy().ends_with('~'));
        assert_eq!(without_owned.path().parent().unwrap(), canonical(&build));
    }

    #[test]
    fn relative_or_missing_bases_are_skipped_and_nothing_else_is_created() {
        let root = TempDir::new().unwrap();
        let build = root.path().join("build");
        let scratch = EngineScratch::create(&bases(
            root.path().join("missing system tmp"),
            Some(PathBuf::from("relative-engine-tmp")),
            build.clone(),
        ))
        .unwrap();
        assert_eq!(scratch.path().parent().unwrap(), canonical(&build));
        assert!(!root.path().join("missing system tmp").exists());
        assert!(!Path::new("relative-engine-tmp").exists());

        let error = EngineScratch::create(&bases(
            PathBuf::from("relative"),
            None,
            PathBuf::from("relative-build"),
        ))
        .unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
        assert!(!Path::new("relative-build").exists());
    }

    #[test]
    fn pandoc_gets_the_project_resource_path_in_a_form_it_never_splits() {
        let root = TempDir::new().unwrap();
        let scratch = EngineScratch::create(&bases(
            root.path().to_path_buf(),
            None,
            root.path().join("build"),
        ))
        .unwrap();
        let separator = char::from(SEARCH_PATH_SEPARATOR);
        let defaults = scratch.path().join(PANDOC_DEFAULTS_FILE);
        let read_defaults = || {
            serde_json::from_str::<serde_json::Value>(&std::fs::read_to_string(&defaults).unwrap())
                .unwrap()
        };

        for name in ["Plain notes", "Notes ${HOME} x"] {
            let project = root.path().join(name);
            let mut argument = OsString::from("--resource-path=");
            argument.push(&project);
            assert_eq!(
                scratch.pandoc_resource_path(&project).unwrap(),
                PandocResourcePath {
                    argument,
                    variable: None
                }
            );
            assert!(!defaults.exists(), "{name}");
        }

        let mut defaults_argument = OsString::from("--defaults=");
        defaults_argument.push(&defaults);
        let separated = root.path().join(format!("Thesis 2024{separator}25 $x"));
        assert_eq!(
            scratch.pandoc_resource_path(&separated).unwrap(),
            PandocResourcePath {
                argument: defaults_argument.clone(),
                variable: None
            }
        );
        assert_eq!(
            read_defaults(),
            serde_json::json!({ "resource-path": [separated.to_str().unwrap()] })
        );

        let both = root
            .path()
            .join(format!("Draft 1{separator}2 ${{HOME}} ${{.}}"));
        assert_eq!(
            scratch.pandoc_resource_path(&both).unwrap(),
            PandocResourcePath {
                argument: defaults_argument,
                variable: Some((PANDOC_RESOURCE_PATH_VARIABLE, both.as_os_str().to_owned()))
            }
        );
        let content = std::fs::read_to_string(&defaults).unwrap();
        assert!(content.starts_with('{'), "{content}");
        assert_eq!(
            read_defaults(),
            serde_json::json!({ "resource-path": ["${OLEAFLY_PANDOC_RESOURCE_PATH}"] })
        );

        let path = scratch.path().to_path_buf();
        drop(scratch);
        assert!(!defaults.exists());
        assert!(!path.exists());
    }

    #[test]
    fn stale_scratch_folders_are_swept_and_everything_else_is_kept() {
        let root = TempDir::new().unwrap();
        let owned = root.path().join(ENGINE_TEMP_DIR);
        std::fs::create_dir(&owned).unwrap();
        std::fs::create_dir(owned.join("oleafly-engine-killed")).unwrap();
        std::fs::write(owned.join("oleafly-engine-killed").join("fig.png"), "png").unwrap();
        std::fs::create_dir(owned.join("oleafly-engine-killed~")).unwrap();
        std::fs::create_dir(owned.join("unrelated")).unwrap();
        std::fs::write(owned.join("oleafly-engine-file"), "file").unwrap();
        sweep_stale_scratch(&owned, STALE_SCRATCH_AGE);
        assert_eq!(names(&owned).len(), 4);
        sweep_stale_scratch(&owned, Duration::ZERO);
        assert_eq!(names(&owned), ["oleafly-engine-file", "unrelated"]);
    }

    #[cfg(unix)]
    #[test]
    fn a_compile_sweeps_scratch_folders_older_than_a_day() {
        let root = TempDir::new().unwrap();
        let system = root.path().join("tmp");
        let owned = root.path().join(ENGINE_TEMP_DIR);
        for base in [&system, &owned] {
            std::fs::create_dir(base).unwrap();
            for name in ["oleafly-engine-old", "oleafly-engine-new"] {
                std::fs::create_dir(base.join(name)).unwrap();
            }
            let old = std::fs::File::open(base.join("oleafly-engine-old")).unwrap();
            old.set_modified(SystemTime::now() - STALE_SCRATCH_AGE - Duration::from_secs(60))
                .unwrap();
        }
        let scratch = EngineScratch::create(&bases(
            system.clone(),
            Some(owned.clone()),
            root.path().join("build"),
        ))
        .unwrap();
        let fresh = scratch
            .path()
            .file_name()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        assert_eq!(names(&owned), ["oleafly-engine-new"]);
        let mut expected = vec!["oleafly-engine-new".to_string(), fresh];
        expected.sort();
        assert_eq!(names(&system), expected);
    }

    #[cfg(windows)]
    #[test]
    fn verbatim_prefixes_are_stripped_for_the_engine() {
        assert_eq!(
            plain_path(Path::new(r"\\?\C:\Users\runneradmin\AppData\Local\Temp")),
            PathBuf::from(r"C:\Users\runneradmin\AppData\Local\Temp")
        );
        assert_eq!(
            plain_path(Path::new(r"\\?\UNC\server\share\scratch")),
            PathBuf::from(r"\\server\share\scratch")
        );
        assert_eq!(
            plain_path(Path::new(r"C:\Users\me")),
            PathBuf::from(r"C:\Users\me")
        );
        assert_eq!(
            plain_path(Path::new(r"\\?\GLOBALROOT\Device\x")),
            PathBuf::from(r"\\?\GLOBALROOT\Device\x")
        );
        assert!(tex_safe_path(Path::new(
            r"C:\Users\runneradmin\AppData\Local\Temp"
        )));
        assert!(!tex_safe_path(Path::new(r"\\?\C:\Users\me")));
        assert!(!tex_safe_path(Path::new(r"\\server\share\scratch")));
        assert!(!tex_safe_path(Path::new(
            r"C:\Users\RUNNER~1\AppData\Local\Temp"
        )));

        let root = TempDir::new().unwrap();
        let verbatim = std::fs::canonicalize(root.path()).unwrap();
        assert!(verbatim.to_string_lossy().starts_with(r"\\?\"));
        let scratch =
            EngineScratch::create(&bases(verbatim, None, root.path().join("build"))).unwrap();
        assert!(!scratch.path().to_string_lossy().starts_with(r"\\"));
        assert!(
            tex_safe_path(scratch.path()),
            "{}",
            scratch.path().display()
        );
    }

    #[cfg(windows)]
    #[test]
    fn short_names_expand_to_the_long_form() {
        use std::os::windows::ffi::{OsStrExt, OsStringExt};
        use windows_sys::Win32::Storage::FileSystem::GetShortPathNameW;

        fn short_path(path: &Path) -> PathBuf {
            let input: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
            let mut output = vec![0u16; 32_768];
            let written = unsafe {
                GetShortPathNameW(input.as_ptr(), output.as_mut_ptr(), output.len() as u32)
            } as usize;
            assert!(written > 0 && written < output.len());
            std::ffi::OsString::from_wide(&output[..written]).into()
        }

        let root = TempDir::new().unwrap();
        let directory = root.path().join("a long directory name for short paths");
        std::fs::create_dir(&directory).unwrap();
        let short = short_path(&directory);
        if short == directory || !short.to_string_lossy().contains('~') {
            return;
        }
        let expanded = long_path(&short);
        assert!(
            !expanded.to_string_lossy().contains('~'),
            "{}",
            expanded.display()
        );
        assert_eq!(expanded, long_path(&directory));
        let scratch =
            EngineScratch::create(&bases(short, None, root.path().join("build"))).unwrap();
        assert!(tex_safe_path(scratch.path()));
        assert_eq!(scratch.path().parent().unwrap(), canonical(&directory));
        assert!(!scratch.path().to_string_lossy().contains('~'));
        assert!(scratch
            .path()
            .parent()
            .unwrap()
            .ends_with("a long directory name for short paths"));
    }
}
