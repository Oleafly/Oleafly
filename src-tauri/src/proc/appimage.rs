use std::collections::HashMap;
use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;

const LAUNCHER_SEARCH_PATHS: [&str; 16] = [
    "LD_LIBRARY_PATH",
    "PYTHONHOME",
    "PYTHONPATH",
    "PERLLIB",
    "QT_PLUGIN_PATH",
    "GST_PLUGIN_SYSTEM_PATH",
    "GST_PLUGIN_SYSTEM_PATH_1_0",
    "XDG_DATA_DIRS",
    "GSETTINGS_SCHEMA_DIR",
    "GI_TYPELIB_PATH",
    "GIO_EXTRA_MODULES",
    "GTK_PATH",
    "GTK_EXE_PREFIX",
    "GTK_DATA_PREFIX",
    "GTK_IM_MODULE_FILE",
    "GDK_PIXBUF_MODULE_FILE",
];

const HOOK_DATA_DIR: &str = "/usr/share";

pub(crate) type EnvChange = (&'static str, Option<OsString>);

struct AppDir {
    given: PathBuf,
    resolved: PathBuf,
}

impl AppDir {
    fn of(appdir: Option<OsString>, executable: Option<&Path>) -> Option<Self> {
        let given = PathBuf::from(appdir?);
        if !given.is_absolute() {
            return None;
        }
        let resolved = given.canonicalize().unwrap_or_else(|_| given.clone());
        let appdir = Self { given, resolved };
        executable
            .is_some_and(|executable| appdir.contains(executable))
            .then_some(appdir)
    }

    fn contains(&self, path: &Path) -> bool {
        path.starts_with(&self.given) || path.starts_with(&self.resolved)
    }

    fn bundled(&self, program: &OsStr, search_path: Option<&OsStr>) -> bool {
        let program = Path::new(program);
        if program.components().count() > 1 {
            return self.contains(program)
                || program
                    .canonicalize()
                    .is_ok_and(|resolved| self.contains(&resolved));
        }
        search_path
            .map(std::env::split_paths)
            .into_iter()
            .flatten()
            .filter(|folder| folder.is_absolute())
            .map(|folder| folder.join(program))
            .find(|candidate| candidate.is_file())
            .is_some_and(|found| self.contains(&found))
    }

    fn cleaned(&self, name: &str, value: &OsStr) -> Option<Option<OsString>> {
        let mut entries: Vec<PathBuf> = std::env::split_paths(value).collect();
        if !entries.iter().any(|entry| self.contains(entry)) {
            return None;
        }
        let leading = entries
            .iter()
            .take_while(|entry| self.contains(entry))
            .count();
        if name == "XDG_DATA_DIRS"
            && leading > 0
            && entries.get(leading).map(PathBuf::as_path) == Some(Path::new(HOOK_DATA_DIR))
        {
            entries.remove(leading);
        }
        let kept = entries
            .into_iter()
            .filter(|entry| !entry.as_os_str().is_empty() && !self.contains(entry));
        Some(
            std::env::join_paths(kept)
                .ok()
                .filter(|joined| !joined.is_empty()),
        )
    }

    fn changes(
        &self,
        program: &OsStr,
        current: impl Fn(&str) -> Option<OsString>,
    ) -> Vec<EnvChange> {
        if self.bundled(program, current("PATH").as_deref()) {
            return Vec::new();
        }
        LAUNCHER_SEARCH_PATHS
            .into_iter()
            .filter_map(|name| Some((name, self.cleaned(name, &current(name)?)?)))
            .collect()
    }

    fn clear_with(&self, command: &mut Command, inherited: impl Fn(&str) -> Option<OsString>) {
        let explicit: HashMap<OsString, Option<OsString>> = command
            .get_envs()
            .map(|(name, value)| (name.to_os_string(), value.map(OsStr::to_os_string)))
            .collect();
        let changes = self.changes(command.get_program(), |name| {
            match explicit.get(OsStr::new(name)) {
                Some(value) => value.clone(),
                None => inherited(name),
            }
        });
        for (name, value) in changes {
            match value {
                Some(value) => command.env(name, value),
                None => command.env_remove(name),
            };
        }
    }
}

fn running() -> Option<&'static AppDir> {
    static APPDIR: OnceLock<Option<AppDir>> = OnceLock::new();
    APPDIR
        .get_or_init(|| {
            if !cfg!(target_os = "linux") {
                return None;
            }
            let executable = std::env::current_exe()
                .ok()
                .and_then(|executable| executable.canonicalize().ok());
            AppDir::of(std::env::var_os("APPDIR"), executable.as_deref())
        })
        .as_ref()
}

pub(crate) fn appimage_env_changes(
    program: &OsStr,
    current: impl Fn(&str) -> Option<OsString>,
) -> Vec<EnvChange> {
    running()
        .map(|appdir| appdir.changes(program, current))
        .unwrap_or_default()
}

pub(crate) fn clear_appimage_env(command: &mut Command) {
    #[cfg(all(test, unix))]
    if simulated::clear(command) {
        return;
    }
    if let Some(appdir) = running() {
        appdir.clear_with(command, |name| std::env::var_os(name));
    }
}

#[cfg(all(test, unix))]
pub(crate) mod simulated {
    use super::*;
    use std::cell::RefCell;

    type Launch = (AppDir, HashMap<&'static str, OsString>);

    thread_local! {
        static ACTIVE: RefCell<Option<Launch>> = const { RefCell::new(None) };
    }

    pub(crate) struct SimulatedAppImage {
        _temp: tempfile::TempDir,
        pub(crate) root: PathBuf,
    }

    impl SimulatedAppImage {
        pub(crate) fn start() -> Self {
            let (temp, root, appdir) = fake_image();
            let inherited = launched(&root);
            ACTIVE.with(|active| *active.borrow_mut() = Some((appdir, inherited)));
            Self { _temp: temp, root }
        }
    }

    impl Drop for SimulatedAppImage {
        fn drop(&mut self) {
            ACTIVE.with(|active| active.borrow_mut().take());
        }
    }

    pub(super) fn clear(command: &mut Command) -> bool {
        ACTIVE.with(|active| {
            let active = active.borrow();
            let Some((appdir, inherited)) = active.as_ref() else {
                return false;
            };
            appdir.clear_with(command, |name| inherited.get(name).cloned());
            true
        })
    }

    pub(super) fn fake_image() -> (tempfile::TempDir, PathBuf, AppDir) {
        let temp = tempfile::tempdir().unwrap();
        let root = temp
            .path()
            .canonicalize()
            .unwrap()
            .join(".mount_OleafHlLmNo");
        std::fs::create_dir_all(root.join("usr/bin")).unwrap();
        std::fs::write(root.join("usr/bin/tectonic"), b"").unwrap();
        let appdir = AppDir::of(
            Some(root.clone().into_os_string()),
            Some(&root.join("usr/bin/oleafly-desktop")),
        )
        .unwrap();
        (temp, root, appdir)
    }

    pub(super) fn launched(root: &Path) -> HashMap<&'static str, OsString> {
        let root = root.display();
        HashMap::from([
            (
                "LD_LIBRARY_PATH",
                format!(
                    "{root}/usr/lib/:{root}/usr/lib/i386-linux-gnu/:{root}/usr/lib/x86_64-linux-gnu/:{root}/usr/lib32/:{root}/usr/lib64/:{root}/lib/:{root}/lib/i386-linux-gnu/:{root}/lib/x86_64-linux-gnu/:{root}/lib32/:{root}/lib64/:"
                )
                .into(),
            ),
            ("PYTHONHOME", format!("{root}/usr/").into()),
            ("PYTHONPATH", format!("{root}/usr/share/pyshared/:").into()),
            ("PERLLIB", format!("{root}/usr/share/perl5/:{root}/usr/lib/perl5/:/opt/perl").into()),
            (
                "XDG_DATA_DIRS",
                format!("{root}/usr/share/:{root}/usr/share:/usr/share:/home/me/.local/share:/usr/share").into(),
            ),
            ("GST_PLUGIN_SYSTEM_PATH_1_0", format!("{root}/usr/lib/gstreamer-1.0:").into()),
            ("GSETTINGS_SCHEMA_DIR", format!("{root}//usr/share/glib-2.0/schemas").into()),
            ("GTK_PATH", format!("{root}//usr/lib/gtk-3.0").into()),
            ("GDK_PIXBUF_MODULE_FILE", format!("{root}//usr/lib/gdk-pixbuf-2.0/2.10.0/loaders.cache").into()),
            ("GTK_THEME", "Adwaita:light".into()),
            ("PATH", format!("{root}/usr/bin/:{root}/usr/sbin/:/usr/bin:/bin").into()),
        ])
    }
}

// AppImages exist only on Linux, and the launcher's variables are
// colon-separated path lists, which Windows splits on semicolons instead. The
// code these tests cover does nothing outside Linux (see `running`).
#[cfg(all(test, unix))]
mod tests {
    use super::simulated::{fake_image, launched};
    use super::*;

    struct Image {
        _temp: tempfile::TempDir,
        root: PathBuf,
        appdir: AppDir,
    }

    fn image() -> Image {
        let (temp, root, appdir) = fake_image();
        Image {
            _temp: temp,
            root,
            appdir,
        }
    }

    fn lookup<'a>(
        env: &'a HashMap<&'static str, OsString>,
    ) -> impl Fn(&str) -> Option<OsString> + 'a {
        |name| env.get(name).cloned()
    }

    #[test]
    fn only_a_process_started_from_its_appdir_counts_as_an_appimage() {
        let image = image();
        let outside = Path::new("/usr/bin/oleafly-desktop");
        assert!(AppDir::of(None, Some(&image.root.join("usr/bin/oleafly-desktop"))).is_none());
        assert!(AppDir::of(
            Some("relative/appdir".into()),
            Some(Path::new("relative/appdir/app"))
        )
        .is_none());
        assert!(AppDir::of(Some(image.root.clone().into_os_string()), Some(outside)).is_none());
        assert!(AppDir::of(Some(image.root.clone().into_os_string()), None).is_none());
    }

    #[test]
    fn a_host_program_loses_every_folder_the_launcher_added() {
        let image = image();
        let env = launched(&image.root);
        let changes: HashMap<_, _> = image
            .appdir
            .changes(OsStr::new("/usr/bin/git"), lookup(&env))
            .into_iter()
            .collect();
        assert_eq!(changes["LD_LIBRARY_PATH"], None);
        assert_eq!(changes["PYTHONHOME"], None);
        assert_eq!(changes["PYTHONPATH"], None);
        assert_eq!(changes["PERLLIB"], Some(OsString::from("/opt/perl")));
        assert_eq!(
            changes["XDG_DATA_DIRS"],
            Some(OsString::from("/home/me/.local/share:/usr/share"))
        );
        assert_eq!(changes["GST_PLUGIN_SYSTEM_PATH_1_0"], None);
        assert_eq!(changes["GSETTINGS_SCHEMA_DIR"], None);
        assert_eq!(changes["GTK_PATH"], None);
        assert_eq!(changes["GDK_PIXBUF_MODULE_FILE"], None);
        assert!(!changes.contains_key("GTK_THEME"));
        assert!(!changes.contains_key("PATH"));
    }

    #[test]
    fn the_host_library_path_survives_without_the_launcher_folders() {
        let image = image();
        let mut env = launched(&image.root);
        let mut library_path = env["LD_LIBRARY_PATH"].clone();
        library_path.push("/opt/cuda/lib64:/home/me/lib");
        env.insert("LD_LIBRARY_PATH", library_path);
        let changes = image
            .appdir
            .changes(OsStr::new("/usr/bin/git"), lookup(&env));
        assert!(changes.contains(&(
            "LD_LIBRARY_PATH",
            Some(OsString::from("/opt/cuda/lib64:/home/me/lib"))
        )));
    }

    #[test]
    fn the_data_folder_the_gtk_hook_inserted_goes_with_the_launcher_folders() {
        let image = image();
        let root = image.root.display();
        let env = HashMap::from([(
            "XDG_DATA_DIRS",
            OsString::from(format!("{root}/usr/share/:{root}/usr/share:/usr/share:")),
        )]);
        assert_eq!(
            image
                .appdir
                .changes(OsStr::new("/usr/bin/xdg-open"), lookup(&env)),
            vec![("XDG_DATA_DIRS", None)]
        );
        let env = HashMap::from([(
            "XDG_DATA_DIRS",
            OsString::from(format!(
                "{root}/usr/share/:{root}/usr/share:/usr/share:/usr/local/share:/usr/share:/var/lib/flatpak/exports/share"
            )),
        )]);
        assert_eq!(
            image
                .appdir
                .changes(OsStr::new("/usr/bin/xdg-open"), lookup(&env)),
            vec![(
                "XDG_DATA_DIRS",
                Some(OsString::from(
                    "/usr/local/share:/usr/share:/var/lib/flatpak/exports/share"
                ))
            )]
        );
    }

    #[test]
    fn a_variable_without_launcher_folders_is_left_alone() {
        let image = image();
        let env = HashMap::from([
            ("LD_LIBRARY_PATH", OsString::from("/opt/lib::")),
            (
                "XDG_DATA_DIRS",
                OsString::from("/usr/local/share:/usr/share"),
            ),
        ]);
        assert!(image
            .appdir
            .changes(OsStr::new("/usr/bin/git"), lookup(&env))
            .is_empty());
    }

    #[test]
    fn a_program_inside_the_image_keeps_its_environment() {
        let image = image();
        let env = launched(&image.root);
        let bundled = image.root.join("usr/bin/tectonic");
        assert!(image
            .appdir
            .changes(bundled.as_os_str(), lookup(&env))
            .is_empty());
        assert!(image
            .appdir
            .changes(OsStr::new("tectonic"), lookup(&env))
            .is_empty());
    }

    #[test]
    fn a_bare_program_name_is_judged_by_where_the_search_path_finds_it() {
        let image = image();
        let host = tempfile::tempdir().unwrap();
        std::fs::write(host.path().join("git"), b"").unwrap();
        let mut env = launched(&image.root);
        env.insert(
            "PATH",
            std::env::join_paths([image.root.join("usr/bin"), host.path().to_path_buf()]).unwrap(),
        );
        assert!(!image
            .appdir
            .changes(OsStr::new("git"), lookup(&env))
            .is_empty());
        assert!(!image
            .appdir
            .changes(OsStr::new("missing-program"), lookup(&env))
            .is_empty());
    }

    #[test]
    fn a_command_keeps_what_its_caller_set_and_drops_what_it_inherited() {
        let image = image();
        let env = launched(&image.root);
        let mut command = Command::new("/usr/bin/git");
        command.env("PERLLIB", "/srv/perl").env_remove("PYTHONPATH");
        image.appdir.clear_with(&mut command, lookup(&env));
        let applied: HashMap<_, _> = command
            .get_envs()
            .map(|(name, value)| {
                (
                    name.to_string_lossy().into_owned(),
                    value.map(OsStr::to_os_string),
                )
            })
            .collect();
        assert_eq!(applied["LD_LIBRARY_PATH"], None);
        assert_eq!(applied["PYTHONHOME"], None);
        assert_eq!(applied["PYTHONPATH"], None);
        assert_eq!(applied["PERLLIB"], Some(OsString::from("/srv/perl")));
        assert_eq!(
            applied["XDG_DATA_DIRS"],
            Some(OsString::from("/home/me/.local/share:/usr/share"))
        );
        assert!(!applied.contains_key("GTK_THEME"));
    }

    #[test]
    fn the_started_host_program_sees_the_cleaned_environment() {
        let image = image();
        let env = launched(&image.root);
        let mut command = Command::new("/bin/sh");
        command
            .arg("-c")
            .arg("printf '%s|%s' \"${PYTHONHOME-unset}\" \"${XDG_DATA_DIRS-unset}\"")
            .env("PYTHONHOME", &env["PYTHONHOME"])
            .env("XDG_DATA_DIRS", &env["XDG_DATA_DIRS"]);
        image.appdir.clear_with(&mut command, |_| None);
        let output = command.output().unwrap();
        assert_eq!(
            String::from_utf8_lossy(&output.stdout),
            "unset|/home/me/.local/share:/usr/share"
        );
    }
}
