pub(crate) use oleafly_online::service::DEFAULT_SERVER;
pub(crate) use oleafly_online::session::{
    cookie_applies, cookie_header, is_dashboard, merge_set_cookies, Session,
};

use super::client::{self, Http};
use super::errors::app_error;
use crate::app_error::AppError;

pub(crate) const SAVED_BY_APP: &str = "app";

pub(crate) fn normalize_server(input: Option<&str>) -> Result<String, String> {
    oleafly_online::session::normalize_server(input).map_err(app_error)
}

fn store() -> Result<oleafly_secrets::SecretStore, String> {
    crate::secrets::store()
}

pub(crate) fn load(base: &str, account: Option<&str>) -> Result<Option<Session>, String> {
    oleafly_online::session::load_for(&store()?, base, account).map_err(app_error)
}

pub(crate) fn accounts(base: &str) -> Result<Vec<Session>, String> {
    oleafly_online::session::accounts(&store()?, base).map_err(app_error)
}

pub(crate) fn use_account(base: &str, user_id: &str) -> Result<bool, String> {
    oleafly_online::session::use_account(&store()?, base, user_id).map_err(app_error)
}

pub(crate) fn save(base: &str, session: &Session) -> Result<(), String> {
    oleafly_online::session::save(&store()?, base, session).map_err(app_error)
}

pub(crate) fn forget(base: &str, account: Option<&str>) -> Result<(), String> {
    let store = store()?;
    match account {
        Some(user_id) => oleafly_online::session::forget_account(&store, base, user_id),
        None => oleafly_online::session::forget(&store, base),
    }
    .map(drop)
    .map_err(app_error)
}

pub(crate) fn refresh_cookie(base: &str, session: &Session, cookie: &str) -> Result<(), String> {
    oleafly_online::session::refresh_cookie(&store()?, base, session, cookie).map_err(app_error)
}

pub(crate) fn git_token(base: &str, account: Option<&str>) -> Result<Option<String>, String> {
    oleafly_online::session::git_token(&store()?, base, account).map_err(app_error)
}

pub(crate) fn save_git_token(base: &str, account: Option<&str>, token: &str) -> Result<(), String> {
    oleafly_online::session::save_git_token(&store()?, base, account, token).map_err(app_error)
}

pub(crate) fn forget_git_token(base: &str, account: Option<&str>) -> Result<(), String> {
    oleafly_online::session::forget_git_token(&store()?, base, account)
        .map(drop)
        .map_err(app_error)
}

pub(crate) async fn forget_if_expired(base: &str, user_id: &str, error: &str) {
    if !client::is_expired(error) {
        return;
    }
    let (server, user_id) = (base.to_owned(), user_id.to_owned());
    if let Err(failure) = super::blocking(move || forget(&server, Some(&user_id))).await {
        let _ = crate::project::append_app_log(format!(
            "Could not forget the expired Overleaf sign-in for {base}: {failure}"
        ));
    }
}

pub(crate) struct Signed {
    pub(crate) http: Http,
    pub(crate) session: Session,
    pub(crate) csrf: String,
}

pub(crate) async fn signed_in(base: &str, account: Option<&str>) -> Result<Signed, String> {
    let (lookup, user) = (base.to_owned(), account.map(str::to_owned));
    let stored = super::blocking(move || load(&lookup, user.as_deref()))
        .await?
        .ok_or_else(|| String::from(AppError::new("overleaf.signed_out")))?;
    let http = Http::new(base)?;
    let dashboard = match http.dashboard(&stored.cookie).await {
        Ok(dashboard) => dashboard,
        Err(error) => {
            forget_if_expired(base, &stored.user_id, &error).await;
            return Err(error);
        }
    };
    let cookie = merge_set_cookies(
        &stored.cookie,
        dashboard.set_cookies.iter().map(String::as_str),
    );
    if cookie != stored.cookie {
        let (base, kept, fresh) = (base.to_owned(), stored.clone(), cookie.clone());
        if let Err(failure) = super::blocking(move || refresh_cookie(&base, &kept, &fresh)).await {
            let _ = crate::project::append_app_log(format!(
                "Could not keep the renewed Overleaf sign-in: {failure}"
            ));
        }
    }
    let csrf = dashboard
        .csrf
        .ok_or_else(|| String::from(AppError::new("overleaf.unrecognized")))?;
    Ok(Signed {
        http,
        session: Session {
            cookie,
            email: if dashboard.email.is_empty() {
                stored.email
            } else {
                dashboard.email
            },
            ..stored
        },
        csrf,
    })
}
