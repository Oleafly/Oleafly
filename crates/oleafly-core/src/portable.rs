use unicode_normalization::UnicodeNormalization;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PortableProblem {
    NotPortable,
    NotNormalized,
    ProtectedRoot,
}

pub fn fold(path: &str) -> String {
    path.nfc().flat_map(char::to_lowercase).collect()
}

pub fn is_windows_reserved_component(component: &str) -> bool {
    let stem = component.split('.').next().unwrap_or_default();
    let upper = stem.to_ascii_uppercase();
    matches!(upper.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || upper
            .strip_prefix("COM")
            .or_else(|| upper.strip_prefix("LPT"))
            .is_some_and(|suffix| suffix.len() == 1 && matches!(suffix.as_bytes()[0], b'1'..=b'9'))
}

pub fn is_ignorable_code_point(character: char) -> bool {
    matches!(
        character,
        '\u{00AD}'
            | '\u{034F}'
            | '\u{200B}'..='\u{200F}'
            | '\u{202A}'..='\u{202E}'
            | '\u{2060}'..='\u{2064}'
            | '\u{206A}'..='\u{206F}'
            | '\u{FE00}'..='\u{FE0F}'
            | '\u{FEFF}'
    )
}

pub fn relative_problem(path: &str) -> Option<PortableProblem> {
    if path.is_empty()
        || path.starts_with('/')
        || path.contains('\\')
        || path.contains(':')
        || path.chars().any(char::is_control)
    {
        return Some(PortableProblem::NotPortable);
    }
    let components = path.split('/').collect::<Vec<_>>();
    if components.iter().any(|component| {
        component.is_empty()
            || *component == "."
            || *component == ".."
            || component.ends_with(['.', ' '])
            || is_windows_reserved_component(component)
    }) {
        return Some(PortableProblem::NotNormalized);
    }
    let first = components.first().copied().unwrap_or_default();
    if first.eq_ignore_ascii_case(".git") || first.eq_ignore_ascii_case(".oleafly") {
        return Some(PortableProblem::ProtectedRoot);
    }
    None
}

pub fn synced_path_problem(path: &str) -> Option<PortableProblem> {
    if let Some(problem) = relative_problem(path) {
        return Some(problem);
    }
    if path.chars().any(is_ignorable_code_point) {
        return Some(PortableProblem::NotPortable);
    }
    let protected = path.split('/').any(|component| {
        let folded = fold(component);
        folded == ".git"
            || folded == "git~1"
            || folded.starts_with(".oleafly")
            || folded == ".dropbox"
    });
    protected.then_some(PortableProblem::ProtectedRoot)
}

#[cfg(test)]
mod tests {
    use super::{fold, relative_problem, synced_path_problem, PortableProblem};

    #[test]
    fn relative_paths_reject_escapes_and_windows_hazards() {
        assert_eq!(relative_problem("chapters/intro.tex"), None);
        assert_eq!(relative_problem("figures/plot 1.png"), None);
        for path in [
            "",
            "/etc/passwd",
            "a\\b",
            "C:/evil.dll",
            "D:",
            "a\u{0}b",
            "line\nbreak",
        ] {
            assert_eq!(
                relative_problem(path),
                Some(PortableProblem::NotPortable),
                "{path:?}"
            );
        }
        for path in [
            "a//b",
            "./a",
            "a/../b",
            "trailing.",
            "space ",
            "CON",
            "aux.tex",
            "lpt9.txt",
        ] {
            assert_eq!(
                relative_problem(path),
                Some(PortableProblem::NotNormalized),
                "{path:?}"
            );
        }
        assert_eq!(
            relative_problem(".git/hooks/pre-commit"),
            Some(PortableProblem::ProtectedRoot)
        );
        assert_eq!(
            relative_problem(".Oleafly/build/main.aux"),
            Some(PortableProblem::ProtectedRoot)
        );
    }

    #[test]
    fn synced_paths_also_refuse_nested_git_and_aliases() {
        assert_eq!(synced_path_problem("vendor/lib.tex"), None);
        for path in [
            "vendor/.git/config",
            "vendor/.GIT/hooks/post-checkout",
            "GIT~1/hooks/pre-commit",
            "sub/.oleafly-staging/x",
            ".g\u{200C}it/config",
        ] {
            assert!(synced_path_problem(path).is_some(), "{path:?}");
        }
    }

    #[test]
    fn folding_ignores_case_and_normalization_form() {
        assert_eq!(fold("Caf\u{0065}\u{0301}.tex"), fold("café.TEX"));
        assert_ne!(fold("main.tex"), fold("main2.tex"));
    }
}
