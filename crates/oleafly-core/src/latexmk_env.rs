use std::path::{Component, Path, PathBuf};

const TEX_SEARCH_PATH_SEPARATOR: char = if cfg!(windows) { ';' } else { ':' };
const TEX_SEARCH_PATH_SYNTAX: [char; 5] = [';', ',', '{', '}', '$'];

fn has_search_path_syntax(text: &str) -> bool {
    text.contains(TEX_SEARCH_PATH_SEPARATOR) || text.contains(TEX_SEARCH_PATH_SYNTAX)
}

pub fn breaks_tex_search_path(path: &Path) -> bool {
    has_search_path_syntax(&path.to_string_lossy())
}

pub fn has_unmatched_brace(path: &Path) -> bool {
    let mut depth = 0usize;
    for character in path.to_string_lossy().chars() {
        match character {
            '{' => depth += 1,
            '}' if depth == 0 => return true,
            '}' => depth -= 1,
            _ => {}
        }
    }
    depth != 0
}

fn relative_route(from: &Path, to: &Path) -> Option<PathBuf> {
    let from: Vec<Component<'_>> = from.components().collect();
    let to: Vec<Component<'_>> = to.components().collect();
    let shared = from
        .iter()
        .zip(&to)
        .take_while(|(left, right)| left == right)
        .count();
    if shared == 0 {
        return None;
    }
    let mut route = PathBuf::new();
    for component in &from[shared..] {
        match component {
            Component::Normal(_) => route.push(".."),
            Component::CurDir => {}
            _ => return None,
        }
    }
    for component in &to[shared..] {
        route.push(component);
    }
    Some(if route.as_os_str().is_empty() {
        PathBuf::from(".")
    } else {
        route
    })
}

pub fn bibtex_search_entry(compile_dir: &Path, aux_dir: &Path) -> Option<String> {
    if !breaks_tex_search_path(compile_dir) {
        return None;
    }
    let route = relative_route(aux_dir, compile_dir)?;
    let entry = route.to_string_lossy().replace('\\', "/");
    (!has_search_path_syntax(&entry)).then_some(entry)
}

fn prepend_search_entry(entry: &str, existing: Option<&str>) -> String {
    match existing.filter(|value| !value.is_empty()) {
        Some(value) => format!("{entry}{TEX_SEARCH_PATH_SEPARATOR}{value}"),
        None => format!("{entry}{TEX_SEARCH_PATH_SEPARATOR}"),
    }
}

const PROJECT_SEARCH_VARIABLES: [&str; 2] = ["TEXINPUTS", "BIBINPUTS"];

pub fn project_search_environment(project_root: &Path) -> Vec<(&'static str, String)> {
    let root = crate::engine_spec::latexmk_absolute_path_text(project_root, cfg!(windows))
        .filter(|_| !breaks_tex_search_path(project_root));
    let Some(root) = root else {
        return Vec::new();
    };
    let entry = format!(".{TEX_SEARCH_PATH_SEPARATOR}{root}");
    PROJECT_SEARCH_VARIABLES
        .iter()
        .map(|name| {
            let existing = std::env::var(name).ok();
            (*name, prepend_search_entry(&entry, existing.as_deref()))
        })
        .collect()
}

pub const BIBTEX_SEARCH_VARIABLES: [&str; 2] = ["BIBINPUTS", "BSTINPUTS"];

pub fn bibtex_search_environment(entry: &str) -> Vec<(&'static str, String)> {
    BIBTEX_SEARCH_VARIABLES
        .iter()
        .map(|name| {
            let existing = std::env::var(name).ok();
            (*name, prepend_search_entry(entry, existing.as_deref()))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn only_paths_with_the_separator_break_the_search_path() {
        assert!(breaks_tex_search_path(Path::new("/Users/a/Thesis 2024:25")));
        assert!(!breaks_tex_search_path(Path::new(
            "/Users/a/Thesis 2024-25"
        )));
    }

    #[test]
    fn kpathsea_syntax_in_a_folder_name_breaks_the_search_path() {
        for folder in [
            "Thesis {draft}",
            "open{brace",
            "close}brace",
            "budget $HOME",
            "Smith, Jones",
            "part;two",
        ] {
            assert!(
                breaks_tex_search_path(&Path::new("base").join(folder)),
                "{folder}"
            );
        }
        for folder in ["Bob's thesis", "a&b", "#1", "50%", "~notes", "^top", "!!x"] {
            assert!(
                !breaks_tex_search_path(&Path::new("base").join(folder)),
                "{folder}"
            );
        }
    }

    #[test]
    fn the_project_root_joins_the_search_path_after_the_working_folder() {
        let root = tempfile::tempdir().unwrap();
        let environment = project_search_environment(root.path());
        let text = crate::engine_spec::latexmk_absolute_path_text(root.path(), cfg!(windows));
        assert_eq!(
            environment
                .iter()
                .map(|(name, _)| *name)
                .collect::<Vec<_>>(),
            ["TEXINPUTS", "BIBINPUTS"]
        );
        for (_, value) in environment {
            let expected = format!(
                ".{TEX_SEARCH_PATH_SEPARATOR}{}{TEX_SEARCH_PATH_SEPARATOR}",
                text.as_deref().unwrap()
            );
            assert!(value.starts_with(&expected), "{value}");
        }
        assert!(project_search_environment(&root.path().join("Thesis {draft}")).is_empty());
        assert!(project_search_environment(Path::new("relative")).is_empty());
    }

    #[test]
    fn only_a_lone_brace_counts_as_unmatched() {
        for folder in ["open{brace", "close}brace", "}a{", "{{a}"] {
            assert!(has_unmatched_brace(Path::new(folder)), "{folder}");
        }
        for folder in ["plain", "{a}", "{a,b}x{c}", "{{a}}"] {
            assert!(!has_unmatched_brace(Path::new(folder)), "{folder}");
        }
    }

    #[test]
    fn the_route_for_a_folder_with_kpathsea_syntax_stays_inside_it() {
        let project = Path::new("base").join("Thesis {draft}, $HOME");
        assert_eq!(
            bibtex_search_entry(&project, &project.join(".oleafly").join("build")),
            Some("../..".to_string())
        );
        assert_eq!(
            bibtex_search_entry(&project, &Path::new("base").join("outside").join("build")),
            None
        );
    }

    #[test]
    fn routes_climb_out_of_the_build_folder() {
        assert_eq!(
            relative_route(Path::new("/p/.oleafly/build"), Path::new("/p")),
            Some(PathBuf::from("../.."))
        );
        assert_eq!(
            relative_route(Path::new("/p/.oleafly/build"), Path::new("/p/paper")),
            Some(PathBuf::from("../../paper"))
        );
        assert_eq!(
            relative_route(Path::new("/p"), Path::new("/p")),
            Some(PathBuf::from("."))
        );
        assert_eq!(relative_route(Path::new("a"), Path::new("b")), None);
    }

    #[cfg(unix)]
    #[test]
    fn the_entry_avoids_the_folder_name_with_the_separator() {
        let project = Path::new("/Users/a/Thesis 2024:25");
        assert_eq!(
            bibtex_search_entry(project, &project.join(".oleafly/build")),
            Some("../..".to_string())
        );
        assert_eq!(
            bibtex_search_entry(&project.join("paper"), &project.join(".oleafly/build")),
            Some("../../paper".to_string())
        );
        assert_eq!(
            bibtex_search_entry(project, Path::new("/Users/a/.oleafly/builds/x")),
            None
        );
        assert_eq!(
            bibtex_search_entry(
                Path::new("/Users/a/Thesis"),
                Path::new("/Users/a/Thesis/.oleafly/build")
            ),
            None
        );
    }

    #[test]
    fn both_bibtex_variables_start_with_the_entry() {
        let environment = bibtex_search_environment("../..");
        let names: Vec<&str> = environment.iter().map(|(name, _)| *name).collect();
        assert_eq!(names, BIBTEX_SEARCH_VARIABLES);
        for (_, value) in environment {
            assert!(value.starts_with(&format!("../..{TEX_SEARCH_PATH_SEPARATOR}")));
        }
    }

    #[test]
    fn the_entry_goes_first_and_keeps_the_user_search_path() {
        let sep = TEX_SEARCH_PATH_SEPARATOR;
        assert_eq!(prepend_search_entry("../..", None), format!("../..{sep}"));
        assert_eq!(
            prepend_search_entry("../..", Some("")),
            format!("../..{sep}")
        );
        assert_eq!(
            prepend_search_entry("../..", Some(&format!("/bibs{sep}"))),
            format!("../..{sep}/bibs{sep}")
        );
    }
}
