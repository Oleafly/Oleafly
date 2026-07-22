use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::Manager;

use crate::paths;

const DEFAULT_URL: &str = "https://ccfddl.com/conference/allconf.yml";

fn deadlines_url() -> String {
    match std::env::var("OLEAFLY_DEADLINES_URL") {
        Ok(v) if !v.trim().is_empty() => v.trim().to_string(),
        _ => DEFAULT_URL.to_string(),
    }
}

// ccfddl YAML shapes; everything defaults so upstream drift degrades a venue
// instead of failing the whole refresh.
#[derive(Deserialize, Default)]
struct CcfRank {
    #[serde(default)]
    ccf: Option<String>,
    #[serde(default)]
    core: Option<String>,
}

#[derive(Deserialize, Default)]
struct CcfTimeline {
    #[serde(default)]
    abstract_deadline: Option<serde_yaml::Value>,
    #[serde(default)]
    deadline: Option<serde_yaml::Value>,
}

#[derive(Deserialize, Default)]
struct CcfConf {
    #[serde(default)]
    year: i64,
    #[serde(default)]
    id: String,
    #[serde(default)]
    link: String,
    #[serde(default)]
    timeline: Vec<CcfTimeline>,
    #[serde(default)]
    timezone: String,
    #[serde(default)]
    date: String,
    #[serde(default)]
    place: String,
}

#[derive(Deserialize, Default)]
struct CcfEntry {
    #[serde(default)]
    title: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    sub: String,
    #[serde(default)]
    rank: CcfRank,
    #[serde(default)]
    confs: Vec<CcfConf>,
}

#[derive(Serialize)]
struct DeadlineEntry {
    kind: &'static str,
    at: String,
}

#[derive(Serialize)]
struct Venue {
    id: String,
    title: String,
    full_name: String,
    sub: String,
    rank: String,
    link: String,
    timezone: String,
    deadlines: Vec<DeadlineEntry>,
    conf_date: String,
    place: String,
}

fn yaml_time(v: &Option<serde_yaml::Value>) -> Option<String> {
    let s = match v {
        Some(serde_yaml::Value::String(s)) => s.trim().to_string(),
        _ => return None,
    };
    if s.is_empty() || s.eq_ignore_ascii_case("tbd") {
        return None;
    }
    Some(s)
}

pub(crate) fn normalize(yaml: &str, generated_at: String) -> Result<String, String> {
    let entries: Vec<CcfEntry> =
        serde_yaml::from_str(yaml).map_err(|e| format!("invalid deadlines yaml: {e}"))?;
    let mut venues: Vec<Venue> = Vec::new();
    for entry in entries {
        let Some(conf) = entry.confs.iter().max_by_key(|c| c.year) else {
            continue;
        };
        let mut deadlines: Vec<DeadlineEntry> = Vec::new();
        for t in &conf.timeline {
            if let Some(at) = yaml_time(&t.abstract_deadline) {
                deadlines.push(DeadlineEntry {
                    kind: "abstract",
                    at,
                });
            }
            if let Some(at) = yaml_time(&t.deadline) {
                deadlines.push(DeadlineEntry { kind: "paper", at });
            }
        }
        if deadlines.is_empty() {
            continue;
        }
        let rank = match (&entry.rank.core, &entry.rank.ccf) {
            (Some(core), _) if !core.trim().is_empty() => core.trim().to_string(),
            (_, Some(ccf)) if !ccf.trim().is_empty() => format!("CCF-{}", ccf.trim()),
            _ => String::new(),
        };
        venues.push(Venue {
            id: conf.id.clone(),
            title: format!("{} {}", entry.title, conf.year).trim().to_string(),
            full_name: entry.description.clone(),
            sub: entry.sub.clone(),
            rank,
            link: conf.link.clone(),
            timezone: conf.timezone.clone(),
            deadlines,
            conf_date: conf.date.clone(),
            place: conf.place.clone(),
        });
    }
    serde_json::to_string(&serde_json::json!({
        "generated_at": generated_at,
        "venues": venues,
    }))
    .map_err(|e| e.to_string())
}

fn deadlines_cache_path() -> Result<PathBuf, String> {
    let dir = paths::assets_root()?.join("deadlines");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("deadlines.json"))
}

fn bundled_seed_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    if let Ok(p) = app.path().resolve(
        "resources/deadlines-seed.json",
        tauri::path::BaseDirectory::Resource,
    ) {
        if p.is_file() {
            return Some(p);
        }
    }
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("deadlines-seed.json");
    if dev.is_file() {
        Some(dev)
    } else {
        None
    }
}

/// Bundled hand-curated venues outside the ccfddl dataset (neuroscience,
/// physics, materials science, and venues with non-AoE timezones). Merged
/// into every read so a dataset refresh never drops them.
fn bundled_extra_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    if let Ok(p) = app.path().resolve(
        "resources/deadlines-extra.json",
        tauri::path::BaseDirectory::Resource,
    ) {
        if p.is_file() {
            return Some(p);
        }
    }
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("deadlines-extra.json");
    if dev.is_file() {
        Some(dev)
    } else {
        None
    }
}

pub(crate) fn merge_extra(base_json: &str, extra_json: &str) -> Result<String, String> {
    let mut base: serde_json::Value =
        serde_json::from_str(base_json).map_err(|e| format!("invalid deadlines json: {e}"))?;
    let extra: serde_json::Value =
        serde_json::from_str(extra_json).map_err(|e| format!("invalid extra deadlines: {e}"))?;
    let extra_venues = extra["venues"].as_array().cloned().unwrap_or_default();
    if let Some(venues) = base["venues"].as_array_mut() {
        let seen: std::collections::HashSet<String> = venues
            .iter()
            .filter_map(|v| v["id"].as_str().map(String::from))
            .collect();
        for v in extra_venues {
            if v["id"]
                .as_str()
                .map(|id| !seen.contains(id))
                .unwrap_or(false)
            {
                venues.push(v);
            }
        }
    }
    serde_json::to_string(&base).map_err(|e| e.to_string())
}

/// The normalized deadlines JSON: refreshed cache if present, else the seed,
/// always merged with the bundled extra venues.
#[tauri::command]
pub fn read_deadlines(app: tauri::AppHandle) -> Result<String, String> {
    let base = (|| {
        if let Ok(cache) = deadlines_cache_path() {
            if let Ok(s) = std::fs::read_to_string(&cache) {
                return s;
            }
        }
        match bundled_seed_path(&app) {
            Some(seed) => std::fs::read_to_string(&seed).unwrap_or_default(),
            None => String::new(),
        }
    })();
    let base = if base.is_empty() {
        r#"{"generated_at":"","venues":[]}"#.to_string()
    } else {
        base
    };
    match bundled_extra_path(&app).and_then(|p| std::fs::read_to_string(p).ok()) {
        Some(extra) => merge_extra(&base, &extra),
        None => Ok(base),
    }
}

#[tauri::command]
pub async fn refresh_deadlines() -> Result<(), String> {
    let url = deadlines_url();
    let resp = reqwest::get(&url)
        .await
        .map_err(|e| format!("deadlines fetch failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("deadlines fetch failed: {e}"))?;
    let body = resp
        .text()
        .await
        .map_err(|e| format!("deadlines fetch failed: {e}"))?;
    let generated_at = chrono_now();
    let json = normalize(&body, generated_at)?;
    let cache = deadlines_cache_path()?;
    let tmp = cache.with_extension("json.part");
    std::fs::write(&tmp, &json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &cache).map_err(|e| e.to_string())?;
    Ok(())
}

fn chrono_now() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format_utc_date(secs)
}

/// "YYYY-MM-DD" from a unix timestamp, no chrono dependency
/// (civil-from-days, Howard Hinnant's algorithm).
pub(crate) fn format_utc_date(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{y:04}-{m:02}-{d:02}")
}

#[cfg(test)]
mod tests {
    const FIXTURE: &str = r#"
- title: AAAI
  description: AAAI Conference on Artificial Intelligence
  sub: AI
  rank: { ccf: A, core: A* }
  confs:
    - year: 2025
      id: aaai25
      link: https://a/25
      timeline: [{ deadline: "2024-08-15 23:59:59" }]
      timezone: UTC-12
      date: Feb 2025
      place: Old
    - year: 2026
      id: aaai26
      link: https://a/26
      timeline: [{ abstract_deadline: "2025-08-08 23:59:59", deadline: "2025-08-15 23:59:59" }]
      timezone: AoE
      date: Jan 2026
      place: Somewhere
- title: GHOST
  description: Ghost Conf
  sub: SE
  rank: { ccf: C }
  confs:
    - year: 2026
      id: ghost26
      link: https://g
      timeline: [{ deadline: TBD }]
      timezone: UTC
      date: TBD
      place: TBD
"#;

    #[test]
    fn normalizes_ccfddl_yaml() {
        let out = super::normalize(FIXTURE, "2026-07-21T00:00:00Z".into()).unwrap();
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        let venues = v["venues"].as_array().unwrap();
        assert_eq!(venues.len(), 1);
        assert_eq!(venues[0]["id"], "aaai26");
        assert_eq!(venues[0]["title"], "AAAI 2026");
        assert_eq!(venues[0]["rank"], "A*");
        assert_eq!(venues[0]["timezone"], "AoE");
        assert_eq!(venues[0]["deadlines"].as_array().unwrap().len(), 2);
        assert_eq!(venues[0]["deadlines"][0]["kind"], "abstract");
        assert_eq!(v["generated_at"], "2026-07-21T00:00:00Z");
    }

    #[test]
    fn utc_date_formatting_is_civil() {
        assert_eq!(super::format_utc_date(0), "1970-01-01");
        assert_eq!(super::format_utc_date(1_784_701_899), "2026-07-22");
    }

    #[test]
    fn extra_venues_merge_without_id_collisions() {
        let base =
            r#"{"generated_at":"2026-07-21","venues":[{"id":"aaai27","title":"AAAI 2027"}]}"#;
        let extra = r#"{"venues":[{"id":"sfn26","title":"SfN 2026","estimated":false},{"id":"aaai27","title":"dup"}]}"#;
        let merged = super::merge_extra(base, extra).unwrap();
        let v: serde_json::Value = serde_json::from_str(&merged).unwrap();
        let venues = v["venues"].as_array().unwrap();
        assert_eq!(venues.len(), 2);
        assert_eq!(venues[1]["id"], "sfn26");
        assert_eq!(v["generated_at"], "2026-07-21");
    }

    #[test]
    fn ccf_rank_used_when_core_missing() {
        let yaml = r#"
- title: X
  description: X Conf
  sub: SE
  rank: { ccf: B }
  confs:
    - year: 2026
      id: x26
      link: https://x
      timeline: [{ deadline: "2026-01-01 00:00:00" }]
      timezone: UTC+8
      date: d
      place: p
"#;
        let out = super::normalize(yaml, "t".into()).unwrap();
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["venues"][0]["rank"], "CCF-B");
    }
}
