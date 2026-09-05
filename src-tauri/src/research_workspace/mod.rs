mod model;
pub(crate) mod roots;
mod setup;

pub use model::*;

#[tauri::command]
pub fn get_research_workspace(project_id: String) -> Result<ResearchWorkspace, String> {
    roots::get_workspace(&project_id)
}

#[tauri::command]
pub fn add_research_root(request: AddResearchRootRequest) -> Result<ResearchWorkspace, String> {
    roots::add_root(request)
}

#[tauri::command]
pub fn update_research_root(
    request: UpdateResearchRootRequest,
) -> Result<ResearchWorkspace, String> {
    roots::update_root(request)
}

#[tauri::command]
pub fn remove_research_root(
    project_id: String,
    root_id: String,
) -> Result<ResearchWorkspace, String> {
    roots::remove_root(&project_id, &root_id)
}

#[tauri::command]
pub async fn list_research_root_files(
    project_id: String,
    root_id: String,
    relative_path: String,
    max_depth: usize,
) -> Result<ResearchRootListing, String> {
    tauri::async_runtime::spawn_blocking(move || {
        roots::list_root_files(&project_id, &root_id, &relative_path, max_depth)
    })
    .await
    .map_err(|error| format!("linked-folder listing stopped: {error}"))?
}

#[tauri::command]
pub async fn read_research_root_file(
    project_id: String,
    root_id: String,
    relative_path: String,
    max_bytes: usize,
) -> Result<ResearchRootFileContent, String> {
    tauri::async_runtime::spawn_blocking(move || {
        roots::read_root_file(&project_id, &root_id, &relative_path, max_bytes)
    })
    .await
    .map_err(|error| format!("linked-file read stopped: {error}"))?
}

#[tauri::command]
pub async fn write_research_root_file(
    project_id: String,
    root_id: String,
    relative_path: String,
    content: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        roots::write_root_file(
            &project_id,
            &root_id,
            &relative_path,
            content.as_bytes(),
            ResearchRootConsumer::Native,
        )
    })
    .await
    .map_err(|error| format!("linked-file write stopped: {error}"))?
}

#[tauri::command]
pub fn research_root_capabilities(
    project_id: String,
    consumer: ResearchRootConsumer,
) -> Result<Vec<ResearchRootCapability>, String> {
    roots::capabilities(&project_id, consumer)
}

#[tauri::command]
pub fn preview_research_project(
    request: ResearchProjectRequest,
) -> Result<ResearchProjectPreview, String> {
    setup::build_preview(request)
}

#[tauri::command(async)]
pub fn create_research_project(
    app: tauri::AppHandle,
    request: ResearchProjectRequest,
) -> Result<String, String> {
    setup::create(&app, request)
}

#[cfg(test)]
mod tests;
