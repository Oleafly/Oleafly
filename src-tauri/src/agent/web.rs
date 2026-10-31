use std::collections::HashMap;
use std::sync::Arc;

use oleafly_agent::tools::web::{
    web_fetch_schema, web_search_schema, SearchKey, WebToolContext, WEB_FETCH_TOOL, WEB_SEARCH_TOOL,
};
use oleafly_agent::{native_web, AgentEvent, CompletionRequest, NativeWeb, Resolved, WebTools};
use serde::Serialize;

pub(crate) const WEB_USER_AGENT: &str = concat!(
    "Oleafly/",
    env!("CARGO_PKG_VERSION"),
    " (+https://oleafly.com)"
);

const SEARCH_KEY_IDS: [&str; 3] = ["brave-search", "tavily", "serper"];

pub(crate) fn search_key_from(secrets: &HashMap<String, String>) -> Option<SearchKey> {
    SEARCH_KEY_IDS.iter().find_map(|id| {
        let key = secrets.get(*id)?.trim();
        if key.is_empty() {
            return None;
        }
        let key = key.to_string();
        Some(match *id {
            "brave-search" => SearchKey::Brave(key),
            "tavily" => SearchKey::Tavily(key),
            _ => SearchKey::Serper(key),
        })
    })
}

pub(crate) fn configured_search_key() -> Option<SearchKey> {
    crate::secrets::read_connector_secrets()
        .ok()
        .and_then(|secrets| search_key_from(&secrets))
}

pub(crate) struct RunWeb {
    pub ctx: Option<Arc<WebToolContext>>,
    pub notices: Vec<AgentEvent>,
}

pub(crate) fn add_local_web_tools(
    request: &mut CompletionRequest,
    resolved: &Resolved,
    has_search_key: bool,
) -> Vec<AgentEvent> {
    let Some(web) = request.web.filter(|web| web.any()) else {
        return Vec::new();
    };
    let native = native_web(
        &resolved.provider_id,
        &resolved.wire,
        &resolved.model_id,
        Some(web),
    );
    add_missing_web_tools(request, web, native, has_search_key)
}

fn add_missing_web_tools(
    request: &mut CompletionRequest,
    web: WebTools,
    native: NativeWeb,
    has_search_key: bool,
) -> Vec<AgentEvent> {
    let has = |request: &CompletionRequest, name: &str| {
        request.tools.iter().any(|tool| tool.name == name)
    };
    let mut notices = Vec::new();
    if web.search && !native.search {
        if has_search_key {
            if !has(request, WEB_SEARCH_TOOL) {
                request.tools.push(web_search_schema());
            }
        } else {
            notices.push(AgentEvent::Notice {
                code: "web_search_unavailable".into(),
                detail: None,
            });
        }
    }
    if web.fetch && !native.fetch && !has(request, WEB_FETCH_TOOL) {
        request.tools.push(web_fetch_schema());
    }
    notices
}

pub(crate) fn prepare_run_web(
    request: &mut CompletionRequest,
    resolved: &Resolved,
    key: Option<SearchKey>,
    hosted_allowed: bool,
) -> Result<RunWeb, String> {
    let Some(web) = request.web.filter(|web| web.any()) else {
        return Ok(RunWeb {
            ctx: None,
            notices: Vec::new(),
        });
    };
    let notices = if hosted_allowed {
        add_local_web_tools(request, resolved, key.is_some())
    } else {
        request.web = None;
        add_missing_web_tools(request, web, NativeWeb::default(), key.is_some())
    };
    let ctx = WebToolContext::new(key, WEB_USER_AGENT).map_err(|error| error.to_string())?;
    ctx.observe_messages(&request.messages);
    Ok(RunWeb {
        ctx: Some(Arc::new(ctx)),
        notices,
    })
}

pub(crate) fn web_tool_names(ctx: &WebToolContext) -> Vec<String> {
    let mut names = vec![WEB_FETCH_TOOL.to_string()];
    if ctx.has_search() {
        names.push(WEB_SEARCH_TOOL.to_string());
    }
    names
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum WebMode {
    Native,
    Local,
    Unavailable,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WebSupport {
    pub search: WebMode,
    pub fetch: WebMode,
    pub search_provider: Option<String>,
}

pub(crate) fn web_support_for(resolved: &Resolved, key: Option<&SearchKey>) -> WebSupport {
    let native = native_web(
        &resolved.provider_id,
        &resolved.wire,
        &resolved.model_id,
        Some(oleafly_agent::WebTools {
            search: true,
            fetch: true,
        }),
    );
    let (search, search_provider) = if native.search {
        (WebMode::Native, None)
    } else {
        match key {
            Some(key) => (
                WebMode::Local,
                Some(
                    match key {
                        SearchKey::Brave(_) => "brave",
                        SearchKey::Tavily(_) => "tavily",
                        SearchKey::Serper(_) => "serper",
                    }
                    .to_string(),
                ),
            ),
            None => (WebMode::Unavailable, None),
        }
    };
    WebSupport {
        search,
        fetch: if native.fetch {
            WebMode::Native
        } else {
            WebMode::Local
        },
        search_provider,
    }
}

#[tauri::command]
pub async fn agent_web_support(
    provider_id: Option<String>,
    model_id: Option<String>,
) -> Result<WebSupport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let provider_override = match (provider_id, model_id) {
            (Some(provider_id), Some(model_id)) => Some(super::ProviderOverride {
                provider_id,
                model_id,
            }),
            _ => None,
        };
        let resolved = super::resolve_for(provider_override)?;
        let key = configured_search_key();
        Ok(web_support_for(&resolved, key.as_ref()))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use oleafly_agent::{ModelCaps, WebTools, Wire};

    fn resolved(provider: &str, model: &str, wire: Wire) -> Resolved {
        Resolved {
            provider_id: provider.into(),
            model_id: model.into(),
            credential: "k".into(),
            auth: Some("k".into()),
            wire,
            caps: ModelCaps::default(),
        }
    }

    fn anthropic_resolved(model: &str) -> Resolved {
        resolved(
            "anthropic",
            model,
            Wire::Anthropic {
                base_url: "https://api.anthropic.com/v1".into(),
            },
        )
    }

    fn google_resolved(model: &str) -> Resolved {
        resolved(
            "google",
            model,
            Wire::Google {
                base_url: "https://generativelanguage.googleapis.com/v1beta".into(),
            },
        )
    }

    fn responses_resolved(model: &str) -> Resolved {
        resolved(
            "openai",
            model,
            Wire::OpenAiResponses {
                base_url: "https://api.openai.com/v1".into(),
            },
        )
    }

    fn web_request() -> CompletionRequest {
        CompletionRequest {
            web: Some(WebTools {
                search: true,
                fetch: true,
            }),
            ..CompletionRequest::prompt("s", "u")
        }
    }

    #[test]
    fn prepare_run_web_adds_only_missing_local_tools() {
        let mut request = web_request();
        let run = prepare_run_web(
            &mut request,
            &anthropic_resolved("claude-opus-5-5"),
            None,
            true,
        )
        .unwrap();
        assert!(request.tools.is_empty() && run.notices.is_empty() && run.ctx.is_some());

        let mut gemini = web_request();
        let run = prepare_run_web(
            &mut gemini,
            &google_resolved("gemini-3.8-flash"),
            None,
            true,
        )
        .unwrap();
        assert_eq!(
            gemini
                .tools
                .iter()
                .map(|tool| tool.name.as_str())
                .collect::<Vec<_>>(),
            ["web_fetch"]
        );
        assert!(matches!(
            run.notices.as_slice(),
            [AgentEvent::Notice { code, .. }] if code == "web_search_unavailable"
        ));
        prepare_run_web(
            &mut gemini,
            &google_resolved("gemini-3.8-flash"),
            Some(SearchKey::Brave("k".into())),
            true,
        )
        .unwrap();
        assert_eq!(
            gemini
                .tools
                .iter()
                .filter(|tool| tool.name == "web_fetch")
                .count(),
            1
        );
        assert_eq!(
            gemini
                .tools
                .iter()
                .filter(|tool| tool.name == "web_search")
                .count(),
            1
        );

        let mut off = CompletionRequest::prompt("s", "u");
        let run =
            prepare_run_web(&mut off, &google_resolved("gemini-3.8-flash"), None, true).unwrap();
        assert!(run.ctx.is_none() && off.tools.is_empty());
    }

    #[test]
    fn an_untrusted_folder_uses_the_local_web_tools_the_trust_prompt_covers() {
        let names = |request: &CompletionRequest| {
            let mut names: Vec<String> =
                request.tools.iter().map(|tool| tool.name.clone()).collect();
            names.sort_unstable();
            names
        };
        let mut request = web_request();
        let run = prepare_run_web(
            &mut request,
            &anthropic_resolved("claude-opus-5-5"),
            Some(SearchKey::Brave("k".into())),
            false,
        )
        .unwrap();
        assert_eq!(request.web, None);
        assert_eq!(names(&request), ["web_fetch", "web_search"]);
        assert!(run.ctx.is_some() && run.notices.is_empty());
        let body =
            oleafly_agent::complete::wire_body(&anthropic_resolved("claude-opus-5-5"), &request)
                .unwrap()
                .to_string();
        assert!(
            !body.contains("web_search_2") && !body.contains("web_fetch_2"),
            "{body}"
        );

        let mut keyless = web_request();
        let run = prepare_run_web(
            &mut keyless,
            &anthropic_resolved("claude-opus-5-5"),
            None,
            false,
        )
        .unwrap();
        assert_eq!(names(&keyless), ["web_fetch"]);
        assert!(matches!(
            run.notices.as_slice(),
            [AgentEvent::Notice { code, .. }] if code == "web_search_unavailable"
        ));
    }

    #[test]
    fn a_child_on_another_model_gets_the_local_tools_it_lacks() {
        let mut request = web_request();
        assert!(
            add_local_web_tools(&mut request, &anthropic_resolved("claude-opus-5-5"), true)
                .is_empty()
        );
        assert!(request.tools.is_empty());
        let notices = add_local_web_tools(&mut request, &google_resolved("gemini-3.8-flash"), true);
        assert!(notices.is_empty());
        let mut names: Vec<_> = request
            .tools
            .iter()
            .map(|tool| tool.name.as_str())
            .collect();
        names.sort_unstable();
        assert_eq!(names, ["web_fetch", "web_search"]);
        let ctx = WebToolContext::new(None, WEB_USER_AGENT).unwrap();
        assert_eq!(web_tool_names(&ctx), ["web_fetch"]);
    }

    #[test]
    fn search_keys_prefer_brave_then_tavily_then_serper() {
        let all = HashMap::from([
            ("serper".to_string(), "s".to_string()),
            ("tavily".to_string(), " t ".to_string()),
            ("brave-search".to_string(), "".to_string()),
        ]);
        assert_eq!(search_key_from(&all), Some(SearchKey::Tavily("t".into())));
        assert_eq!(search_key_from(&HashMap::new()), None);
    }

    #[test]
    fn web_support_reports_native_local_and_unavailable() {
        assert_eq!(
            web_support_for(&anthropic_resolved("claude-opus-5-5"), None),
            WebSupport {
                search: WebMode::Native,
                fetch: WebMode::Native,
                search_provider: None
            }
        );
        assert_eq!(
            web_support_for(&responses_resolved("gpt-6.1-sol"), None).fetch,
            WebMode::Local
        );
        assert_eq!(
            web_support_for(&google_resolved("gemini-3.8-flash"), None).search,
            WebMode::Unavailable
        );
        assert_eq!(
            web_support_for(
                &google_resolved("gemini-3.8-flash"),
                Some(&SearchKey::Serper("k".into()))
            )
            .search_provider
            .as_deref(),
            Some("serper")
        );
    }
}
