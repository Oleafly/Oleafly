use std::path::{Component, Path, PathBuf};

const TEX_SEARCH_PATH_SEPARATOR: char = if cfg!(windows) { ';' } else { ':' };

pub fn breaks_tex_search_path(path: &Path) -> bool {
    path.to_string_lossy().contains(TEX_SEARCH_PATH_SEPARATOR)
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
    (!entry.contains(TEX_SEARCH_PATH_SEPARATOR)).then_some(entry)
}

fn prepend_search_entry(entry: &str, existing: Option<&str>) -> String {
    match existing.filter(|value| !value.is_empty()) {
        Some(value) => format!("{entry}{TEX_SEARCH_PATH_SEPARATOR}{value}"),
        None => format!("{entry}{TEX_SEARCH_PATH_SEPARATOR}"),
    }
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
