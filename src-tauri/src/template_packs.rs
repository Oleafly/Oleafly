use std::path::PathBuf;
use tauri::{AppHandle, Manager};

pub(crate) use oleafly_downloads::template_packs::*;

use crate::paths;

fn bundled_catalog_path(app: &AppHandle) -> Option<PathBuf> {
    if let Ok(p) = app.path().resolve(
        "resources/template-packs.json",
        tauri::path::BaseDirectory::Resource,
    ) {
        if p.is_file() {
            return Some(p);
        }
    }
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("template-packs.json");
    dev.is_file().then_some(dev)
}

pub(crate) fn catalog(app: &AppHandle) -> Result<Vec<CatalogPack>, String> {
    let root = paths::templates_data_root().ok();
    catalog_from(
        root.as_deref(),
        bundled_catalog_path(app).as_deref(),
        &packs_base_url(),
    )
}

pub(crate) fn pack_install_dir(id: &str) -> Result<PathBuf, String> {
    pack_install_dir_in(&paths::templates_data_root()?, id)
}

#[tauri::command]
pub async fn list_template_packs(app: AppHandle) -> Result<Vec<PackInfo>, String> {
    blocking(move || {
        let packs = catalog(&app)?;
        let root = paths::templates_data_root()?.join("packs");
        Ok(packs
            .iter()
            .map(|pack| pack_info(pack, &root.join(&pack.id)))
            .collect())
    })
    .await
}

#[tauri::command]
pub async fn refresh_pack_catalog(force: Option<bool>) -> Result<bool, String> {
    let root = paths::templates_data_root()?;
    refresh_catalog(&root, force.unwrap_or(false)).await
}

async fn find_pack(app: &AppHandle, id: &str) -> Result<CatalogPack, String> {
    let app = app.clone();
    let id = id.to_string();
    blocking(move || find_pack_in(catalog(&app)?, &id)).await
}

async fn pack_templates(pack: &CatalogPack, force: bool) -> Result<Vec<PackTemplate>, String> {
    pack_templates_in(&paths::templates_data_root()?, pack, force).await
}

#[tauri::command]
pub async fn pack_index(
    app: AppHandle,
    pack_id: String,
    force: Option<bool>,
) -> Result<PackIndexInfo, String> {
    let pack = find_pack(&app, &pack_id).await?;
    let templates = pack_templates(&pack, force.unwrap_or(false)).await?;
    let dir = pack_install_dir(&pack.id)?;
    let version = match pack.source {
        PackSource::Index(_) => 2,
        PackSource::Files(_) => 1,
    };
    blocking(move || {
        Ok(PackIndexInfo {
            pack_id: pack.id,
            version,
            templates: mark_installed(&dir, templates),
        })
    })
    .await
}

async fn install_templates(
    app: &AppHandle,
    pack: &CatalogPack,
    templates: Vec<PackTemplate>,
) -> Result<(), String> {
    use tauri::Emitter;
    let emit = |progress: DownloadProgress| {
        let _ = app.emit(
            "asset-progress",
            crate::assets::AssetProgress {
                component: pack.id.clone(),
                label: pack.label.clone(),
                file: progress.file,
                index: progress.done,
                total: progress.total,
                received: progress.received,
                file_total: progress.file_total,
            },
        );
    };
    install_templates_in(&paths::templates_data_root()?, pack, templates, &emit).await
}

#[tauri::command]
pub async fn install_template_pack(app: AppHandle, id: String) -> Result<(), String> {
    let pack = find_pack(&app, &id).await?;
    let templates = pack_templates(&pack, false).await?;
    install_templates(&app, &pack, templates).await
}

#[tauri::command]
pub async fn install_pack_template(
    app: AppHandle,
    pack_id: String,
    template_id: String,
) -> Result<(), String> {
    if !is_valid_id(&template_id) {
        return Err(format!("illegal template id: {template_id}"));
    }
    let pack = find_pack(&app, &pack_id).await?;
    let templates: Vec<PackTemplate> = pack_templates(&pack, false)
        .await?
        .into_iter()
        .filter(|template| template.info.id == template_id)
        .collect();
    if templates.is_empty() {
        return Err(format!("unknown template: {template_id}"));
    }
    install_templates(&app, &pack, templates).await
}

#[tauri::command]
pub fn remove_template_pack(id: String) -> Result<(), String> {
    let dir = pack_install_dir(&id)?;
    if dir.is_dir() {
        std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}
