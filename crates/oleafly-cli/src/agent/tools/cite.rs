//! Literature search and citation lookups (the research bridge's tools, with
//! the same names, arguments and limits), and the connector keys they use.
use std::collections::BTreeMap;
use std::sync::Arc;

use oleafly_research::host::ConnectorSecrets;
use serde_json::{json, Value};
use zeroize::Zeroizing;

use super::{ToolContext, ToolSpec};
use crate::agent::desktop_config::DesktopConfig;
use crate::agent::policy::Allow;

const TOOLS: [&str; 5] = [
    "literature_search",
    "literature_arxiv_lookup",
    "fetch_doi_bibtex",
    "fetch_arxiv",
    "crossref_search",
];
/// A source's answer is cut at this size, like the research bridge.
const MAX_SOURCE_BYTES: usize = 256 * 1024;

/// Connector keys from the app's encrypted store, by the names the
/// literature tools ask for (`openalex-api-key`, `semantic-scholar`, …).
#[derive(Default)]
pub struct StoreSecrets {
    values: BTreeMap<String, Zeroizing<String>>,
}

impl StoreSecrets {
    pub fn from_config(config: &DesktopConfig) -> Self {
        Self {
            values: config.connector.clone(),
        }
    }
}

impl ConnectorSecrets for StoreSecrets {
    fn get(&self, name: &str) -> Option<Zeroizing<String>> {
        self.values
            .get(name)
            .filter(|value| !value.trim().is_empty())
            .map(|value| Zeroizing::new(value.trim().to_string()))
    }
}

pub(super) fn specs() -> Vec<ToolSpec> {
    oleafly_research::mcp::tool_definitions()
        .into_iter()
        .filter_map(|tool| {
            let name = TOOLS.iter().find(|name| **name == tool.name)?;
            Some(ToolSpec {
                name,
                needs: Allow::Network,
                writes: false,
                schema: oleafly_agent::ToolSchema {
                    name: tool.name,
                    description: tool.description,
                    input_schema: tool.input_schema,
                },
            })
        })
        .collect()
}

pub(super) fn handles(name: &str) -> bool {
    TOOLS.contains(&name)
}

fn text<'a>(arguments: &'a Value, key: &str) -> &'a str {
    arguments[key].as_str().unwrap_or("")
}

fn source_payload(body: String) -> Result<Value, String> {
    if body.len() > MAX_SOURCE_BYTES {
        return Err(
            "The source returned too much data. Narrow the query or reduce the limit.".into(),
        );
    }
    let data = serde_json::from_str::<Value>(&body).unwrap_or(Value::String(body));
    Ok(json!({ "data": data }))
}

pub(super) async fn call(
    ctx: &Arc<ToolContext>,
    name: &str,
    arguments: Value,
) -> Result<Value, String> {
    let secrets: &dyn ConnectorSecrets = ctx.secrets.as_ref();
    let body = tokio::select! {
        body = lookup(secrets, name, &arguments) => body?,
        _ = ctx.cancel.cancelled() => return Err("The run was stopped.".into()),
    };
    source_payload(body)
}

async fn lookup(
    secrets: &dyn ConnectorSecrets,
    name: &str,
    arguments: &Value,
) -> Result<String, String> {
    match name {
        "literature_search" => oleafly_research::literature::literature_search(
            secrets,
            text(arguments, "source"),
            text(arguments, "query"),
            arguments["limit"]
                .as_u64()
                .map_or(10, |limit| limit.clamp(1, 25) as u8),
            arguments["year_from"]
                .as_u64()
                .and_then(|year| u16::try_from(year).ok()),
            arguments["year_to"]
                .as_u64()
                .and_then(|year| u16::try_from(year).ok()),
            arguments["open_access_only"].as_bool().unwrap_or(false),
        )
        .await
        .map_err(String::from),
        "literature_arxiv_lookup" => {
            oleafly_research::literature::literature_arxiv_lookup(
                secrets,
                text(arguments, "arxiv_id"),
            )
            .await
        }
        "fetch_doi_bibtex" => {
            oleafly_research::citation::fetch_doi_bibtex(text(arguments, "doi")).await
        }
        "fetch_arxiv" => oleafly_research::citation::fetch_arxiv(text(arguments, "id")).await,
        "crossref_search" => {
            oleafly_research::citation::crossref_search(text(arguments, "query")).await
        }
        _ => Err(format!("The tool {name} is not available in this run.")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn connector_secrets_answer_by_the_names_e_uses() {
        let mut config = DesktopConfig::empty();
        config
            .connector
            .insert("openalex-api-key".into(), Zeroizing::new(" oa-key ".into()));
        config
            .connector
            .insert("serper".into(), Zeroizing::new("sp-key".into()));
        config
            .connector
            .insert("semantic-scholar".into(), Zeroizing::new("  ".into()));
        let secrets = StoreSecrets::from_config(&config);
        assert_eq!(
            secrets
                .get("openalex-api-key")
                .as_deref()
                .map(String::as_str),
            Some("oa-key")
        );
        assert_eq!(
            secrets.get("serper").as_deref().map(String::as_str),
            Some("sp-key")
        );
        assert!(secrets.get("semantic-scholar").is_none());
        assert!(secrets.get("brave-search").is_none());
    }

    #[test]
    fn the_citation_tools_use_the_bridge_schemas() {
        let names: Vec<&str> = specs().iter().map(|tool| tool.name).collect();
        assert_eq!(names.len(), TOOLS.len());
        let search = specs()
            .into_iter()
            .find(|tool| tool.name == "literature_search")
            .unwrap();
        assert!(search.schema.input_schema["properties"]
            .get("source")
            .is_some());
        assert!(specs()
            .iter()
            .all(|tool| tool.needs == Allow::Network && !tool.writes));
    }

    #[test]
    fn large_answers_are_refused_and_json_is_kept() {
        assert!(source_payload("x".repeat(MAX_SOURCE_BYTES + 1)).is_err());
        assert_eq!(source_payload("{\"a\":1}".into()).unwrap()["data"]["a"], 1);
        assert_eq!(
            source_payload("@article{x}".into()).unwrap()["data"],
            "@article{x}"
        );
    }
}
