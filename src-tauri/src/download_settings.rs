use oleafly_core::download_sources::{
    self, environment_source, https_base, DownloadSettings, DownloadSource, UrlProblem,
};
use serde::{Deserialize, Serialize};

use crate::app_error::AppError;
use crate::config::{self, AppConfig};

#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DownloadSettingsView {
    source: &'static str,
    mirror_url: Option<String>,
    tex_repository: Option<String>,
    oleafly_mirror: &'static str,
    automatic_tex_repository: &'static str,
    environment_source: Option<String>,
    environment_tex_repository: Option<String>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DownloadSettingsInput {
    source: String,
    mirror_url: Option<String>,
    tex_repository: Option<String>,
}

fn saved_settings(config: &AppConfig) -> DownloadSettings {
    DownloadSettings::from_parts(
        config.download_source.as_deref(),
        config.download_mirror_url.as_deref(),
        config.tex_package_repository.as_deref(),
    )
}

pub fn load() {
    if let Ok(config) = config::read_config() {
        download_sources::configure(saved_settings(&config));
    }
}

fn view(config: &AppConfig, read: impl Fn(&str) -> Option<String>) -> DownloadSettingsView {
    let saved = saved_settings(config);
    let environment_source = read(download_sources::MIRROR_VARIABLE)
        .and_then(|value| environment_source(&value))
        .map(|source| match source {
            DownloadSource::Mirror(url) => url,
            other => other.name().to_string(),
        });
    let environment_tex_repository =
        read(download_sources::TEX_REPOSITORY_VARIABLE).and_then(|value| https_base(&value).ok());
    DownloadSettingsView {
        source: saved.source.name(),
        mirror_url: config.download_mirror_url.clone(),
        tex_repository: saved.tex_repository,
        oleafly_mirror: download_sources::OLEAFLY_MIRROR,
        automatic_tex_repository: download_sources::AUTOMATIC_TEX_REPOSITORY,
        environment_source,
        environment_tex_repository,
    }
}

fn url_error(problem: UrlProblem) -> String {
    let code = match problem {
        UrlProblem::Empty => "settings.download_url_empty",
        UrlProblem::TooLong => "settings.download_url_too_long",
        UrlProblem::NotHttps => "settings.download_url_not_https",
        UrlProblem::NoHost => "settings.download_url_no_host",
        UrlProblem::Credentials => "settings.download_url_credentials",
        UrlProblem::QueryOrFragment => "settings.download_url_query",
        UrlProblem::Whitespace => "settings.download_url_spaces",
    };
    AppError::new(code).into()
}

fn optional_url(raw: Option<&str>) -> Result<Option<String>, String> {
    match raw.map(str::trim).filter(|value| !value.is_empty()) {
        Some(value) => https_base(value).map(Some).map_err(url_error),
        None => Ok(None),
    }
}

fn apply(config: &mut AppConfig, input: &DownloadSettingsInput) -> Result<(), String> {
    let mirror_url = optional_url(input.mirror_url.as_deref())?;
    let tex_repository = optional_url(input.tex_repository.as_deref())?;
    let source = match input.source.as_str() {
        "automatic" => None,
        "original" => Some("original"),
        "custom" if mirror_url.is_some() => Some("custom"),
        "custom" => return Err(url_error(UrlProblem::Empty)),
        other => {
            return Err(AppError::new("settings.download_source_unknown")
                .param("source", other)
                .into())
        }
    };
    config.download_source = source.map(str::to_owned);
    config.download_mirror_url = mirror_url;
    config.tex_package_repository = tex_repository;
    Ok(())
}

fn environment(name: &str) -> Option<String> {
    std::env::var(name).ok()
}

#[tauri::command]
pub async fn get_download_settings() -> Result<DownloadSettingsView, String> {
    tauri::async_runtime::spawn_blocking(|| {
        config::read_config().map(|config| view(&config, environment))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn set_download_settings(
    settings: DownloadSettingsInput,
) -> Result<DownloadSettingsView, String> {
    tauri::async_runtime::spawn_blocking(move || {
        config::update_config(|config| apply(config, &settings))?;
        let config = config::read_config()?;
        download_sources::configure(saved_settings(&config));
        Ok(view(&config, environment))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(
        source: &str,
        mirror_url: Option<&str>,
        tex_repository: Option<&str>,
    ) -> DownloadSettingsInput {
        DownloadSettingsInput {
            source: source.into(),
            mirror_url: mirror_url.map(str::to_owned),
            tex_repository: tex_repository.map(str::to_owned),
        }
    }

    fn code(error: &str) -> String {
        let json = error.strip_prefix(crate::app_error::PREFIX).unwrap();
        serde_json::from_str::<serde_json::Value>(json).unwrap()["code"]
            .as_str()
            .unwrap()
            .to_string()
    }

    #[test]
    fn automatic_is_stored_as_the_absence_of_a_choice() {
        let mut config = AppConfig {
            download_source: Some("original".into()),
            ..AppConfig::default()
        };
        apply(&mut config, &input("automatic", None, None)).unwrap();
        assert_eq!(config.download_source, None);
        assert_eq!(config.download_mirror_url, None);
        assert_eq!(config.tex_package_repository, None);
    }

    #[test]
    fn a_custom_mirror_and_repository_are_stored_normalised() {
        let mut config = AppConfig::default();
        apply(
            &mut config,
            &input(
                "custom",
                Some(" https://mirror.example.edu/oleafly/ "),
                Some("https://mirrors.tuna.tsinghua.edu.cn/CTAN/systems/texlive/tlnet/"),
            ),
        )
        .unwrap();
        assert_eq!(config.download_source.as_deref(), Some("custom"));
        assert_eq!(
            config.download_mirror_url.as_deref(),
            Some("https://mirror.example.edu/oleafly")
        );
        assert_eq!(
            config.tex_package_repository.as_deref(),
            Some("https://mirrors.tuna.tsinghua.edu.cn/CTAN/systems/texlive/tlnet")
        );
        let shown = view(&config, |_| None);
        assert_eq!(shown.source, "custom");
        assert_eq!(shown.environment_source, None);
    }

    #[test]
    fn a_mirror_address_survives_switching_back_to_automatic() {
        let mut config = AppConfig::default();
        apply(
            &mut config,
            &input("automatic", Some("https://mirror.example.edu"), None),
        )
        .unwrap();
        assert_eq!(config.download_source, None);
        assert_eq!(
            config.download_mirror_url.as_deref(),
            Some("https://mirror.example.edu")
        );
    }

    #[test]
    fn bad_addresses_are_refused_with_a_reason_and_leave_the_config_alone() {
        let mut config = AppConfig::default();
        let cases = [
            (input("custom", None, None), "settings.download_url_empty"),
            (
                input("custom", Some("http://mirror.example.edu"), None),
                "settings.download_url_not_https",
            ),
            (
                input("automatic", None, Some("https://u:p@ctan.example.edu")),
                "settings.download_url_credentials",
            ),
            (
                input("automatic", None, Some("https://ctan.example.edu/?x")),
                "settings.download_url_query",
            ),
            (
                input("sideways", None, None),
                "settings.download_source_unknown",
            ),
        ];
        for (settings, expected) in cases {
            let error = apply(&mut config, &settings).unwrap_err();
            assert_eq!(code(&error), expected);
        }
        assert_eq!(config.download_source, None);
        assert_eq!(config.download_mirror_url, None);
    }

    #[test]
    fn the_view_reports_settings_made_in_the_environment() {
        let config = AppConfig::default();
        let shown = view(&config, |name| match name {
            download_sources::MIRROR_VARIABLE => Some("https://lab.example.gov/mirror".into()),
            download_sources::TEX_REPOSITORY_VARIABLE => Some("not a url".into()),
            _ => None,
        });
        assert_eq!(shown.source, "automatic");
        assert_eq!(
            shown.environment_source.as_deref(),
            Some("https://lab.example.gov/mirror")
        );
        assert_eq!(shown.environment_tex_repository, None);
        let original = view(&config, |name| {
            (name == download_sources::MIRROR_VARIABLE).then(|| "ORIGINAL".to_string())
        });
        assert_eq!(original.environment_source.as_deref(), Some("original"));
    }
}
