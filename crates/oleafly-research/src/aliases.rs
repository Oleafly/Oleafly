//! Bundled skills name the alphaXiv tools `alphaxiv_search` and
//! `alphaxiv_paper_content`. Those names exist nowhere, so every skill that
//! mentions them gets a short note saying which tool each one means for the
//! agent that reads it.

const SEARCH_ALIAS: &str = "alphaxiv_search";
const CONTENT_ALIAS: &str = "alphaxiv_paper_content";

/// Who reads the skill.
pub enum AliasAudience {
    /// A research task. `alphaxiv_tools` holds the exposed names of the
    /// connected alphaXiv search and paper-content tools, when connected.
    Task {
        alphaxiv_tools: Option<(String, String)>,
    },
    /// A CLI agent with the user's own alphaXiv MCP server.
    CliAgent,
}

/// The note to append to a skill, or "" when it names neither alias.
pub fn tool_alias_note(instructions: &str, audience: &AliasAudience) -> String {
    let search = instructions.contains(SEARCH_ALIAS);
    let content = instructions.contains(CONTENT_ALIAS);
    if !search && !content {
        return String::new();
    }
    let (search_tool, content_tool) = match audience {
        AliasAudience::Task {
            alphaxiv_tools: Some((search, content)),
        } => (format!("`{search}`"), format!("`{content}`")),
        AliasAudience::Task {
            alphaxiv_tools: None,
        } => (
            "`literature_search` with `sources: [\"arxiv\"]`".to_owned(),
            "`read_paper` with `arxiv`".to_owned(),
        ),
        AliasAudience::CliAgent => (
            "the alphaXiv server's `discover_papers` tool".to_owned(),
            "the alphaXiv server's `get_paper_content` tool".to_owned(),
        ),
    };
    let mut lines = Vec::new();
    if search {
        lines.push(format!("`{SEARCH_ALIAS}` means {search_tool}."));
    }
    if content {
        lines.push(format!("`{CONTENT_ALIAS}` means {content_tool}."));
    }
    format!("\n\nTool names in this skill: {}", lines.join(" "))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn alias_notes_resolve_per_audience() {
        let text = "Use `alphaxiv_search` then `alphaxiv_paper_content`.";
        let task = tool_alias_note(
            text,
            &AliasAudience::Task {
                alphaxiv_tools: None,
            },
        );
        assert!(task.contains("literature_search"), "{task}");
        assert!(task.contains("read_paper"), "{task}");
        assert!(tool_alias_note(text, &AliasAudience::CliAgent).contains("discover_papers"));
        assert_eq!(
            tool_alias_note("no aliases here", &AliasAudience::CliAgent),
            ""
        );
    }

    #[test]
    fn a_connected_alphaxiv_server_is_named_by_its_exposed_tools() {
        let note = tool_alias_note(
            "Search with alphaxiv_search.",
            &AliasAudience::Task {
                alphaxiv_tools: Some((
                    "mcp_ext_alphaXiv_discover_papers_ab12".into(),
                    "mcp_ext_alphaXiv_get_paper_content_ab12".into(),
                )),
            },
        );
        assert!(note.contains("`alphaxiv_search` means `mcp_ext_alphaXiv_discover_papers_ab12`."));
        assert!(!note.contains(CONTENT_ALIAS));
    }
}
