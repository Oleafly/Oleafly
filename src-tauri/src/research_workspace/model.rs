use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ResearchRootRole {
    References,
    Data,
    Analysis,
    Manuscript,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ResearchRootAccess {
    #[default]
    ReadOnly,
    ReadWrite,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkedResearchRoot {
    pub id: String,
    pub canonical_path: String,
    pub identity: String,
    pub label: String,
    pub role: ResearchRootRole,
    pub access: ResearchRootAccess,
    pub created_at_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchWorkspace {
    pub version: u8,
    pub primary_project_id: String,
    pub roots: Vec<LinkedResearchRoot>,
    pub updated_at_ms: u64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddResearchRootRequest {
    pub project_id: String,
    pub path: String,
    pub label: String,
    pub role: ResearchRootRole,
    #[serde(default)]
    pub access: ResearchRootAccess,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateResearchRootRequest {
    pub project_id: String,
    pub root_id: String,
    pub label: String,
    pub role: ResearchRootRole,
    pub access: ResearchRootAccess,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ResearchRootConsumer {
    Native,
    Acp,
    Task,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ResearchRootOperation {
    Read,
    Write,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchRootCapability {
    pub root_id: String,
    pub label: String,
    pub role: ResearchRootRole,
    pub configured_access: ResearchRootAccess,
    pub effective_access: ResearchRootAccess,
    pub canonical_path: Option<String>,
    pub exposure: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchRootFileEntry {
    pub relative_path: String,
    pub name: String,
    pub is_directory: bool,
    pub is_symlink: bool,
    pub size: u64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchRootListing {
    pub root_id: String,
    pub path: String,
    pub entries: Vec<ResearchRootFileEntry>,
    pub truncated: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchRootFileContent {
    pub root_id: String,
    pub relative_path: String,
    pub content: String,
    pub bytes_read: usize,
    pub truncated: bool,
    pub is_binary: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ResearchDocumentEngine {
    Latex,
    Typst,
    Markdown,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ResearchStarter {
    Article,
    LiteratureReview,
    Thesis,
    ReproducibleAnalysis,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResearchProjectRequest {
    pub name: String,
    pub engine: ResearchDocumentEngine,
    pub starter: ResearchStarter,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchProjectFilePreview {
    pub path: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchProjectPreview {
    pub name: String,
    pub engine: ResearchDocumentEngine,
    pub starter: ResearchStarter,
    pub main_document: String,
    pub initial_task: String,
    pub files: Vec<ResearchProjectFilePreview>,
}
