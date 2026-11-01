pub(crate) use oleafly_online::service::DEFAULT_SERVER;
pub(crate) use oleafly_online::session::{
    cookie_applies, cookie_header, merge_set_cookies, origin_of, Session,
};

use super::errors::app_error;

pub(crate) const SAVED_BY_APP: &str = "app";

pub(crate) fn normalize_server(input: Option<&str>) -> Result<String, String> {
    oleafly_online::session::normalize_server(input).map_err(app_error)
}

fn store() -> Result<oleafly_secrets::SecretStore, String> {
    crate::secrets::store()
}

pub(crate) fn load(base: &str) -> Result<Option<Session>, String> {
    oleafly_online::session::load(&store()?, base).map_err(app_error)
}

pub(crate) fn save(base: &str, session: &Session) -> Result<(), String> {
    oleafly_online::session::save(&store()?, base, session).map_err(app_error)
}

pub(crate) fn forget(base: &str) -> Result<(), String> {
    oleafly_online::session::forget(&store()?, base)
        .map(|_| ())
        .map_err(app_error)
}

pub(crate) fn refresh_cookie(base: &str, session: &Session, cookie: &str) -> Result<(), String> {
    oleafly_online::session::refresh_cookie(&store()?, base, session, cookie).map_err(app_error)
}

pub(crate) fn git_token(base: &str) -> Result<Option<String>, String> {
    oleafly_online::session::git_token(&store()?, base).map_err(app_error)
}

pub(crate) fn save_git_token(base: &str, token: &str) -> Result<(), String> {
    oleafly_online::session::save_git_token(&store()?, base, token).map_err(app_error)
}

pub(crate) fn forget_git_token(base: &str) -> Result<(), String> {
    oleafly_online::session::forget_git_token(&store()?, base)
        .map(|_| ())
        .map_err(app_error)
}
