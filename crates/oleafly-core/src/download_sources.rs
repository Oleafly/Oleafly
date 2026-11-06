use std::collections::HashSet;
use std::sync::{Mutex, PoisonError, RwLock};
use std::time::{Duration, Instant};

#[cfg(test)]
mod tests;

pub const OLEAFLY_MIRROR: &str = "https://mirrors.oleafly.com";
pub const MIRROR_VARIABLE: &str = "OLEAFLY_DOWNLOAD_MIRROR";
pub const TEX_REPOSITORY_VARIABLE: &str = "OLEAFLY_TEX_REPOSITORY";
pub const AUTOMATIC_TEX_REPOSITORY: &str = "https://mirror.ctan.org/systems/texlive/tlnet";
pub const SOURCE_KEY: &str = "download_source";
pub const MIRROR_URL_KEY: &str = "download_mirror_url";
pub const TEX_REPOSITORY_KEY: &str = "tex_package_repository";
const AUTOMATIC: &str = "automatic";
const ORIGINAL: &str = "original";
const CUSTOM: &str = "custom";
const MAX_URL_BYTES: usize = 2048;
const FAILURE_MEMORY: Duration = Duration::from_secs(60 * 60);

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum DownloadSource {
    #[default]
    Automatic,
    Original,
    Mirror(String),
}

impl DownloadSource {
    pub fn name(&self) -> &'static str {
        match self {
            Self::Automatic => AUTOMATIC,
            Self::Original => ORIGINAL,
            Self::Mirror(_) => CUSTOM,
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct DownloadSettings {
    pub source: DownloadSource,
    pub tex_repository: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UrlProblem {
    Empty,
    TooLong,
    NotHttps,
    NoHost,
    Credentials,
    QueryOrFragment,
    Whitespace,
}

impl DownloadSettings {
    pub const fn automatic() -> Self {
        Self {
            source: DownloadSource::Automatic,
            tex_repository: None,
        }
    }

    pub fn from_parts(
        source: Option<&str>,
        mirror_url: Option<&str>,
        tex_repository: Option<&str>,
    ) -> Self {
        let source = match source.map(str::trim) {
            Some(ORIGINAL) => DownloadSource::Original,
            Some(CUSTOM) => mirror_url
                .and_then(|url| https_base(url).ok())
                .map_or(DownloadSource::Automatic, DownloadSource::Mirror),
            _ => DownloadSource::Automatic,
        };
        Self {
            source,
            tex_repository: tex_repository.and_then(|url| https_base(url).ok()),
        }
    }

    pub fn from_config(config: &serde_json::Map<String, serde_json::Value>) -> Self {
        let text = |key: &str| config.get(key).and_then(serde_json::Value::as_str);
        Self::from_parts(
            text(SOURCE_KEY),
            text(MIRROR_URL_KEY),
            text(TEX_REPOSITORY_KEY),
        )
    }

    pub fn with_environment(mut self, read: impl Fn(&str) -> Option<String>) -> Self {
        if let Some(source) = read(MIRROR_VARIABLE).and_then(|value| environment_source(&value)) {
            self.source = source;
        }
        if let Some(repository) =
            read(TEX_REPOSITORY_VARIABLE).and_then(|value| https_base(&value).ok())
        {
            self.tex_repository = Some(repository);
        }
        self
    }

    pub fn arrange<S: AsRef<str>>(
        &self,
        urls: &[S],
        failed_hosts: &HashSet<String>,
    ) -> Vec<String> {
        let (mirrored, others): (Vec<&str>, Vec<&str>) = urls
            .iter()
            .map(AsRef::as_ref)
            .partition(|url| oleafly_mirror_path(url).is_some());
        let mut ordered: Vec<String> = match &self.source {
            DownloadSource::Automatic => mirrored
                .iter()
                .chain(&others)
                .map(ToString::to_string)
                .collect(),
            DownloadSource::Original if others.is_empty() => {
                mirrored.iter().map(ToString::to_string).collect()
            }
            DownloadSource::Original => others.iter().map(ToString::to_string).collect(),
            DownloadSource::Mirror(base) => mirrored
                .iter()
                .filter_map(|url| oleafly_mirror_path(url))
                .map(|path| format!("{base}{path}"))
                .chain(mirrored.iter().chain(&others).map(ToString::to_string))
                .collect(),
        };
        let mut seen = HashSet::new();
        ordered.retain(|url| seen.insert(url.clone()));
        ordered.sort_by_key(|url| host_of(url).is_some_and(|host| failed_hosts.contains(&host)));
        ordered
    }

    pub fn tex_repository_for(&self, managed: bool) -> Option<String> {
        self.tex_repository
            .clone()
            .or_else(|| managed.then(|| AUTOMATIC_TEX_REPOSITORY.to_string()))
    }

    pub fn mirror_host(&self) -> Option<String> {
        match &self.source {
            DownloadSource::Mirror(base) => host_of(base),
            _ => None,
        }
    }
}

static CONFIGURED: RwLock<DownloadSettings> = RwLock::new(DownloadSettings::automatic());
static FAILURES: Mutex<Vec<(String, Instant)>> = Mutex::new(Vec::new());

pub fn configure(settings: DownloadSettings) {
    match CONFIGURED.write() {
        Ok(mut configured) => *configured = settings,
        Err(poisoned) => *poisoned.into_inner() = settings,
    }
}

pub fn configured() -> DownloadSettings {
    match CONFIGURED.read() {
        Ok(configured) => configured.clone(),
        Err(poisoned) => poisoned.into_inner().clone(),
    }
}

pub fn current() -> DownloadSettings {
    configured().with_environment(|name| std::env::var(name).ok())
}

pub fn arrange<S: AsRef<str>>(urls: &[S]) -> Vec<String> {
    current().arrange(urls, &recently_failed_hosts())
}

pub fn preferred(mirror_url: &str, upstream_url: &str) -> String {
    arrange(&[mirror_url, upstream_url])
        .into_iter()
        .next()
        .unwrap_or_else(|| mirror_url.to_string())
}

pub fn tex_repository(managed: bool) -> Option<String> {
    current().tex_repository_for(managed)
}

pub fn note_failure(url: &str) {
    let Some(host) = host_of(url) else {
        return;
    };
    let mut failures = FAILURES.lock().unwrap_or_else(PoisonError::into_inner);
    failures.retain(|(known, _)| *known != host);
    failures.push((host, Instant::now()));
}

pub fn note_success(url: &str) {
    let Some(host) = host_of(url) else {
        return;
    };
    FAILURES
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .retain(|(known, _)| *known != host);
}

pub fn recently_failed_hosts() -> HashSet<String> {
    let mut failures = FAILURES.lock().unwrap_or_else(PoisonError::into_inner);
    failures.retain(|(_, at)| at.elapsed() < FAILURE_MEMORY);
    failures.iter().map(|(host, _)| host.clone()).collect()
}

pub fn https_base(raw: &str) -> Result<String, UrlProblem> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(UrlProblem::Empty);
    }
    if trimmed.len() > MAX_URL_BYTES {
        return Err(UrlProblem::TooLong);
    }
    if trimmed
        .chars()
        .any(|character| character.is_whitespace() || character.is_control())
    {
        return Err(UrlProblem::Whitespace);
    }
    let Some(rest) = strip_prefix_ignore_case(trimmed, "https://") else {
        return Err(UrlProblem::NotHttps);
    };
    if rest.contains(['?', '#']) {
        return Err(UrlProblem::QueryOrFragment);
    }
    let authority = rest.split('/').next().unwrap_or_default();
    if authority.contains('@') {
        return Err(UrlProblem::Credentials);
    }
    if host_of(trimmed).is_none() {
        return Err(UrlProblem::NoHost);
    }
    Ok(format!("https://{}", rest.trim_end_matches('/')))
}

pub fn host_of(url: &str) -> Option<String> {
    let rest = strip_prefix_ignore_case(url, "https://")
        .or_else(|| strip_prefix_ignore_case(url, "http://"))?;
    let authority = rest.split(['/', '?', '#']).next()?;
    let host = authority.rsplit('@').next()?;
    let host = if let Some(bracketed) = host.strip_prefix('[') {
        format!("[{}]", bracketed.split(']').next()?)
    } else {
        host.split(':').next()?.to_string()
    };
    let host = host.to_ascii_lowercase();
    let valid = !host.is_empty()
        && host
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "-.[]:".contains(character));
    valid.then_some(host)
}

pub fn oleafly_mirror_path(url: &str) -> Option<&str> {
    url.strip_prefix(OLEAFLY_MIRROR)
        .filter(|path| path.starts_with('/') && path.len() > 1)
}

pub fn environment_source(value: &str) -> Option<DownloadSource> {
    match value.trim().to_ascii_lowercase().as_str() {
        "" => None,
        AUTOMATIC => Some(DownloadSource::Automatic),
        ORIGINAL => Some(DownloadSource::Original),
        _ => https_base(value).ok().map(DownloadSource::Mirror),
    }
}

fn strip_prefix_ignore_case<'a>(text: &'a str, prefix: &str) -> Option<&'a str> {
    let head = text.get(..prefix.len())?;
    head.eq_ignore_ascii_case(prefix)
        .then(|| &text[prefix.len()..])
}
