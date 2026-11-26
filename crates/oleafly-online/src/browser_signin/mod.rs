mod bidi;
mod cdp;
mod discover;
mod process;
mod profile;

#[cfg(test)]
mod tests;

use std::fmt;
use std::path::PathBuf;
use std::time::Duration;

use serde::Serialize;

use crate::browser_cookies::{BrowserId, HostPlatform};
use crate::session::{cookie_applies, cookie_header, is_dashboard};

pub use discover::{installed, installed_with, Probe, SystemProbe};
pub use profile::{sweep, Profile};

pub const PROFILES_DIR: &str = "oleafly-browser-sign-in";
const POLL: Duration = Duration::from_millis(400);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Engine {
    Chromium,
    Firefox,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Packaging {
    Native,
    Snap,
    Flatpak,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InstalledBrowser {
    pub id: BrowserId,
    pub path: PathBuf,
    pub engine: Engine,
    pub packaging: Packaging,
    pub profiles: PathBuf,
}

impl Packaging {
    pub fn label(self) -> Option<&'static str> {
        match self {
            Self::Native => None,
            Self::Snap => Some("Snap"),
            Self::Flatpak => Some("Flatpak"),
        }
    }
}

impl InstalledBrowser {
    pub fn key(&self) -> String {
        let id = match self.id {
            BrowserId::Chrome => "chrome",
            BrowserId::Brave => "brave",
            BrowserId::Edge => "edge",
            BrowserId::Chromium => "chromium",
            BrowserId::Firefox => "firefox",
            BrowserId::Safari => "safari",
        };
        match self.packaging {
            Packaging::Native => id.to_string(),
            Packaging::Snap => format!("{id}-snap"),
            Packaging::Flatpak => format!("{id}-flatpak"),
        }
    }

    pub fn name(&self) -> String {
        match self.packaging.label() {
            None => self.id.name().to_string(),
            Some(packaging) => format!("{} ({packaging})", self.id.name()),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum BrowserSignInError {
    Cancelled,
    TimedOut,
    Launch(String),
    Protocol(String),
}

impl fmt::Display for BrowserSignInError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Cancelled => {
                formatter.write_str("the browser was closed before sign-in finished")
            }
            Self::TimedOut => formatter.write_str("sign-in did not finish in time"),
            Self::Launch(detail) => write!(formatter, "the browser could not be started: {detail}"),
            Self::Protocol(detail) => write!(formatter, "the browser connection failed: {detail}"),
        }
    }
}

impl std::error::Error for BrowserSignInError {}

#[derive(Clone, PartialEq, Eq)]
pub(crate) struct BrowserCookie {
    pub(crate) name: String,
    pub(crate) value: String,
    pub(crate) domain: Option<String>,
    pub(crate) path: Option<String>,
    pub(crate) secure: bool,
}

pub(crate) fn header_for(cookies: &[BrowserCookie], url: &url::Url) -> String {
    cookie_header(
        cookies
            .iter()
            .filter(|cookie| {
                cookie_applies(
                    cookie.domain.as_deref(),
                    cookie.path.as_deref(),
                    cookie.secure,
                    url,
                )
            })
            .map(|cookie| (cookie.name.clone(), cookie.value.clone())),
    )
}

enum Driver {
    Chromium(cdp::Cdp),
    Firefox(Box<bidi::Bidi>),
    #[cfg(test)]
    Fake(tests::FakeDriver),
}

impl Driver {
    async fn pages(&mut self) -> Result<Vec<String>, BrowserSignInError> {
        match self {
            Self::Chromium(driver) => driver.pages().await,
            Self::Firefox(driver) => driver.pages().await,
            #[cfg(test)]
            Self::Fake(driver) => driver.pages(),
        }
    }

    async fn cookies(&mut self) -> Result<Vec<BrowserCookie>, BrowserSignInError> {
        match self {
            Self::Chromium(driver) => driver.cookies().await,
            Self::Firefox(driver) => driver.cookies().await,
            #[cfg(test)]
            Self::Fake(driver) => Ok(driver.cookies()),
        }
    }

    async fn close(&mut self) {
        match self {
            Self::Chromium(driver) => driver.close().await,
            Self::Firefox(driver) => driver.close().await,
            #[cfg(test)]
            Self::Fake(driver) => driver.close(),
        }
    }
}

async fn watch(
    driver: &mut Driver,
    base: &str,
    url: &url::Url,
) -> Result<String, BrowserSignInError> {
    let mut seen_page = false;
    loop {
        let pages = match driver.pages().await {
            Err(BrowserSignInError::Cancelled) if !seen_page => {
                return Err(BrowserSignInError::Launch(
                    "the browser closed before it showed the sign-in page".into(),
                ))
            }
            other => other?,
        };
        if pages.is_empty() {
            if seen_page {
                return Err(BrowserSignInError::Cancelled);
            }
        } else {
            seen_page = true;
        }
        let signed_in = pages
            .iter()
            .filter_map(|page| url::Url::parse(page).ok())
            .any(|page| is_dashboard(&page, base));
        if signed_in {
            let header = header_for(&driver.cookies().await?, url);
            if !header.is_empty() {
                return Ok(header);
            }
        }
        tokio::time::sleep(POLL).await;
    }
}

async fn launch(
    browser: &InstalledBrowser,
    profile: &std::path::Path,
    login: &str,
) -> Result<Driver, BrowserSignInError> {
    let platform = HostPlatform::current();
    Ok(match browser.engine {
        Engine::Chromium => Driver::Chromium(cdp::Cdp::launch(browser, platform, profile, login)?),
        Engine::Firefox => Driver::Firefox(Box::new(
            bidi::Bidi::launch(browser, platform, profile, login).await?,
        )),
    })
}

async fn run<F, Started>(
    root: PathBuf,
    base: &str,
    timeout: Duration,
    start: F,
) -> Result<String, BrowserSignInError>
where
    F: FnOnce(PathBuf, String) -> Started,
    Started: std::future::Future<Output = Result<Driver, BrowserSignInError>>,
{
    let launch_error = |detail: String| BrowserSignInError::Launch(detail);
    let url = url::Url::parse(base).map_err(|error| launch_error(error.to_string()))?;
    let profile = tokio::task::spawn_blocking(move || {
        sweep(&root);
        Profile::create(&root)
    })
    .await
    .map_err(|error| launch_error(error.to_string()))?
    .map_err(|error| launch_error(error.to_string()))?;
    let outcome = async {
        let mut driver = start(profile.dir().to_path_buf(), format!("{base}/login")).await?;
        let watched = tokio::time::timeout(timeout, watch(&mut driver, base, &url))
            .await
            .unwrap_or(Err(BrowserSignInError::TimedOut));
        driver.close().await;
        watched
    }
    .await;
    let _ = tokio::task::spawn_blocking(move || profile.remove()).await;
    outcome
}

pub async fn sign_in(
    browser: &InstalledBrowser,
    base: &str,
    timeout: Duration,
) -> Result<String, BrowserSignInError> {
    run(
        browser.profiles.clone(),
        base,
        timeout,
        |profile, login| async move { launch(browser, &profile, &login).await },
    )
    .await
}
