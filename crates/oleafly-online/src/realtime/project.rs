use serde_json::Value;

use super::connection::{connect, Carrier};
use super::page::ProjectPage;
use crate::client::Http;
use crate::error::{OnlineError, OnlineErrorKind};
use crate::session::{Session, SessionHandle};

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ProjectSettings {
    pub compiler: Option<String>,
    pub main_doc: Option<String>,
    pub tex_live: Option<String>,
}

pub async fn fetch_project(
    http: &Http,
    cookie: &str,
    project_id: &str,
) -> Result<Value, OnlineError> {
    let unreachable = |detail: String| {
        OnlineError::new(OnlineErrorKind::Unreachable)
            .param("server", &http.base)
            .detail(detail)
    };
    let page = ProjectPage::unloaded(project_id)?;
    let session = SessionHandle::new(
        &http.base,
        Session {
            cookie: cookie.to_string(),
            user_id: String::new(),
            email: String::new(),
            saved_by: None,
        },
        None,
    );
    let (connection, join) = connect(http, &session, &page, &[Carrier::XhrPolling])
        .await
        .map_err(|error| unreachable(error.to_string()))?;
    connection.close().await;
    join.response
        .get("project")
        .cloned()
        .ok_or_else(|| unreachable("the project reply was empty".to_string()))
}

pub fn settings_from_project(project: &Value) -> ProjectSettings {
    let text = |key: &str| {
        project
            .get(key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    };
    let main_doc = text("rootDoc_id").and_then(|root| {
        project
            .get("rootFolder")
            .and_then(Value::as_array)
            .and_then(|folders| folders.first())
            .and_then(|folder| find_doc_path(folder, &root, ""))
    });
    ProjectSettings {
        compiler: text("compiler"),
        main_doc,
        tex_live: text("imageName").and_then(|image| tex_live_year(&image)),
    }
}

pub fn find_doc_path(folder: &Value, doc_id: &str, prefix: &str) -> Option<String> {
    let id_of = |entry: &Value| {
        entry
            .get("_id")
            .or_else(|| entry.get("id"))
            .and_then(Value::as_str)
            .map(str::to_string)
    };
    let name_of = |entry: &Value| {
        entry
            .get("name")
            .and_then(Value::as_str)
            .map(str::to_string)
    };
    for doc in folder
        .get("docs")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        if id_of(doc).as_deref() == Some(doc_id) {
            return name_of(doc).map(|name| format!("{prefix}{name}"));
        }
    }
    for child in folder
        .get("folders")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let Some(name) = name_of(child) else {
            continue;
        };
        if let Some(found) = find_doc_path(child, doc_id, &format!("{prefix}{name}/")) {
            return Some(found);
        }
    }
    None
}

pub fn tex_live_year(image: &str) -> Option<String> {
    let tag = image.rsplit(':').next()?;
    let year: String = tag.chars().take_while(char::is_ascii_digit).collect();
    (year.len() == 4).then_some(year)
}

pub fn flavor_for_compiler(compiler: &str) -> Option<&'static str> {
    match compiler.trim().to_ascii_lowercase().as_str() {
        "pdflatex" => Some("pdflatex"),
        "xelatex" => Some("xelatex"),
        "lualatex" => Some("lualatex"),
        _ => None,
    }
}
