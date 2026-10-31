use serde_json::Value;

pub(crate) use oleafly_online::socket::{
    flavor_for_compiler, settings_from_project, ProjectSettings,
};

use super::client::Http;
use super::errors::app_error;

pub(crate) async fn fetch_project(
    http: &Http,
    cookie: &str,
    project_id: &str,
) -> Result<Value, String> {
    oleafly_online::socket::fetch_project(http.online(), cookie, project_id)
        .await
        .map_err(app_error)
}
