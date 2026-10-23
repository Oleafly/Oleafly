use super::engine::{now_ms, RoundError};
use super::merge::merge3;
use super::state::SettingsState;
use super::store::{CloudStore, StoreError, WriteMode};
use oleafly_core::hlc::{Hlc, HlcClock, Stamp};
use oleafly_core::ids::DeviceId;
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub(crate) const SETTINGS_REMOTE: &str = "/settings/settings.json";
const SETTINGS_VERSION: u32 = 1;
const MAX_SETTINGS_BYTES: usize = 8 * 1024 * 1024;
const MAX_FUTURE_SKEW_MS: u64 = 24 * 60 * 60 * 1000;
// The default LaTeX engine is one this computer has: latexmk needs a TeX
// installation that another computer may not have.
const DEVICE_ONLY: [(&str, &str); 2] = [
    ("experimentation", "webBrowser"),
    ("engine", "defaultLatexEngine"),
];

#[derive(Clone, Debug, Deserialize, Serialize)]
struct SettingsBlob {
    #[serde(default = "first_version")]
    v: u32,
    stamp: Stamp,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    device: Option<String>,
    values: Value,
}

fn first_version() -> u32 {
    1
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum SettingsOutcome {
    Current,
    Pushed,
    Apply {
        values: Value,
        stamp: u64,
    },
    Choose {
        values: Value,
        stamp: u64,
        deferred: bool,
    },
}

/// Words added on two computers can differ only in case, which the dictionary
/// can't hold twice; the first spelling stays.
fn without_repeated_words(mut values: Value) -> Value {
    if let Some(Value::Array(words)) = values.pointer_mut("/dictionary/words") {
        let mut seen = std::collections::BTreeSet::new();
        words.retain(|word| {
            word.as_str()
                .is_none_or(|word| seen.insert(word.to_lowercase()))
        });
    }
    values
}

pub(crate) fn strip_device_only(mut values: Value) -> Value {
    for (group, field) in DEVICE_ONLY {
        if let Some(Value::Object(map)) = values.get_mut(group) {
            map.remove(field);
        }
    }
    for (group, _) in DEVICE_ONLY {
        let empty = values
            .get(group)
            .and_then(Value::as_object)
            .is_some_and(serde_json::Map::is_empty);
        if empty {
            if let Value::Object(root) = &mut values {
                root.remove(group);
            }
        }
    }
    values
}

fn unreadable() -> RoundError {
    RoundError::Unreadable("the settings in dropbox are unreadable".into())
}

struct RemoteSettings {
    blob: SettingsBlob,
    rev: String,
}

async fn fetch<S: CloudStore>(store: &S) -> Result<Option<RemoteSettings>, RoundError> {
    let Some((bytes, rev)) = store.get(SETTINGS_REMOTE, MAX_SETTINGS_BYTES).await? else {
        return Ok(None);
    };
    let blob: SettingsBlob = serde_json::from_slice(&bytes).map_err(|_| unreadable())?;
    if blob.v > SETTINGS_VERSION {
        return Err(RoundError::NewerVersion);
    }
    if !blob.values.is_object() {
        return Err(unreadable());
    }
    Ok(Some(RemoteSettings {
        blob: SettingsBlob {
            values: strip_device_only(blob.values),
            ..blob
        },
        rev,
    }))
}

fn clock_after(hlc: u64, remote: Option<&RemoteSettings>) -> HlcClock {
    let mut clock = HlcClock::restore(Hlc::from_raw(hlc));
    if let Some(remote) = remote {
        if remote.blob.stamp.hlc.wall_ms() <= now_ms().saturating_add(MAX_FUTURE_SKEW_MS) {
            clock.observe(remote.blob.stamp.hlc);
        }
    }
    clock
}

async fn push<S: CloudStore>(
    store: &S,
    clock: &mut HlcClock,
    device: DeviceId,
    device_name: &str,
    values: &Value,
    mode: WriteMode,
) -> Result<(u64, String), RoundError> {
    let stamp = Stamp::new(clock.tick(now_ms()), device);
    let blob = SettingsBlob {
        v: SETTINGS_VERSION,
        stamp,
        device: Some(device_name.to_string()),
        values: values.clone(),
    };
    let bytes = serde_json::to_vec(&blob).map_err(|error| RoundError::Local(error.to_string()))?;
    let rev = store.put(SETTINGS_REMOTE, bytes, mode).await?;
    Ok((stamp.hlc.raw(), rev))
}

fn settle(state: &mut SettingsState, stamp: u64, rev: Option<String>, values: &Value) {
    state.stamp = stamp;
    state.rev = rev;
    state.base = Some(values.clone());
    state.offered = None;
    state.deferred = None;
}

fn mode_for(remote: Option<&RemoteSettings>) -> WriteMode {
    remote.map_or(WriteMode::Add, |remote| {
        WriteMode::Update(remote.rev.clone())
    })
}

pub(crate) struct SettingsRound<'a> {
    pub(crate) device: DeviceId,
    pub(crate) device_name: &'a str,
    pub(crate) hlc: &'a mut u64,
    pub(crate) state: &'a mut SettingsState,
}

pub(crate) async fn sync_settings<S: CloudStore>(
    store: &S,
    round: SettingsRound<'_>,
    local: Value,
) -> Result<SettingsOutcome, RoundError> {
    let local = strip_device_only(local);
    if !local.is_object() {
        return Err(RoundError::Local("settings must be an object".into()));
    }
    let mut attempt = 0;
    loop {
        attempt += 1;
        match sync_once(
            store,
            &mut *round.hlc,
            &mut *round.state,
            round.device,
            round.device_name,
            &local,
        )
        .await
        {
            Err(RoundError::Store(StoreError::Conflict)) if attempt < 3 => continue,
            other => return other,
        }
    }
}

async fn unchanged_remote<S: CloudStore>(
    store: &S,
    state: &SettingsState,
    local: &Value,
) -> Result<bool, RoundError> {
    let Some(rev) = state.rev.as_deref() else {
        return Ok(false);
    };
    if state.base.as_ref() != Some(local) || state.offered.is_some() {
        return Ok(false);
    }
    Ok(store
        .metadata(SETTINGS_REMOTE)
        .await?
        .is_some_and(|meta| meta.rev == rev))
}

async fn sync_once<S: CloudStore>(
    store: &S,
    hlc: &mut u64,
    state: &mut SettingsState,
    device: DeviceId,
    device_name: &str,
    local: &Value,
) -> Result<SettingsOutcome, RoundError> {
    if unchanged_remote(store, state, local).await? {
        return Ok(SettingsOutcome::Current);
    }
    let remote = fetch(store).await?;
    let mut clock = clock_after(*hlc, remote.as_ref());
    let Some(remote_settings) = &remote else {
        let (stamp, rev) = push(
            store,
            &mut clock,
            device,
            device_name,
            local,
            WriteMode::Add,
        )
        .await?;
        settle(state, stamp, Some(rev), local);
        *hlc = clock.last().raw();
        return Ok(SettingsOutcome::Pushed);
    };
    let remote_values = &remote_settings.blob.values;
    let remote_stamp = remote_settings.blob.stamp.hlc.raw();
    let remote_rev = remote_settings.rev.clone();
    *hlc = clock.last().raw();
    let Some(base) = state.base.clone() else {
        if remote_values == local {
            settle(state, remote_stamp, Some(remote_rev), local);
            return Ok(SettingsOutcome::Current);
        }
        let deferred = state.deferred == Some(remote_stamp);
        state.offered = Some(remote_stamp);
        return Ok(SettingsOutcome::Choose {
            values: remote_values.clone(),
            stamp: remote_stamp,
            deferred,
        });
    };
    if remote_values == local {
        settle(state, remote_stamp, Some(remote_rev), local);
        return Ok(SettingsOutcome::Current);
    }
    let local_changed = *local != base;
    let remote_changed = remote_stamp != state.stamp && *remote_values != base;
    match (local_changed, remote_changed) {
        (false, false) => {
            settle(state, remote_stamp, Some(remote_rev), local);
            Ok(SettingsOutcome::Current)
        }
        (false, true) => {
            state.offered = Some(remote_stamp);
            Ok(SettingsOutcome::Apply {
                values: remote_values.clone(),
                stamp: remote_stamp,
            })
        }
        (true, false) => {
            let (stamp, rev) = push(
                store,
                &mut clock,
                device,
                device_name,
                local,
                mode_for(remote.as_ref()),
            )
            .await?;
            settle(state, stamp, Some(rev), local);
            *hlc = clock.last().raw();
            Ok(SettingsOutcome::Pushed)
        }
        (true, true) => {
            let merged = without_repeated_words(merge3(Some(&base), local, remote_values));
            if merged == *remote_values {
                state.offered = Some(remote_stamp);
                return Ok(SettingsOutcome::Apply {
                    values: merged,
                    stamp: remote_stamp,
                });
            }
            let (stamp, rev) = push(
                store,
                &mut clock,
                device,
                device_name,
                &merged,
                mode_for(remote.as_ref()),
            )
            .await?;
            *hlc = clock.last().raw();
            if merged == *local {
                settle(state, stamp, Some(rev), local);
                return Ok(SettingsOutcome::Pushed);
            }
            state.offered = Some(stamp);
            Ok(SettingsOutcome::Apply {
                values: merged,
                stamp,
            })
        }
    }
}

pub(crate) async fn download<S: CloudStore>(
    store: &S,
    state: &mut SettingsState,
) -> Result<Option<(Value, u64)>, RoundError> {
    let Some(remote) = fetch(store).await? else {
        return Ok(None);
    };
    let stamp = remote.blob.stamp.hlc.raw();
    state.offered = Some(stamp);
    Ok(Some((remote.blob.values, stamp)))
}

pub(crate) fn applied(state: &mut SettingsState, stamp: u64, values: Value) -> bool {
    if state.offered != Some(stamp) {
        return false;
    }
    settle(state, stamp, None, &strip_device_only(values));
    true
}

pub(crate) fn defer(state: &mut SettingsState, stamp: u64) -> bool {
    if state.offered != Some(stamp) || state.base.is_some() {
        return false;
    }
    state.deferred = Some(stamp);
    true
}

pub(crate) async fn keep_local<S: CloudStore>(
    store: &S,
    round: SettingsRound<'_>,
    local: Value,
) -> Result<(), RoundError> {
    let local = strip_device_only(local);
    let mut attempt = 0;
    loop {
        attempt += 1;
        let (remote, mode) = match fetch(store).await {
            Ok(remote) => {
                let mode = mode_for(remote.as_ref());
                (remote, mode)
            }
            Err(RoundError::Unreadable(_)) => (None, WriteMode::Overwrite),
            Err(error) => return Err(error),
        };
        let mut clock = clock_after(*round.hlc, remote.as_ref());
        match push(
            store,
            &mut clock,
            round.device,
            round.device_name,
            &local,
            mode,
        )
        .await
        {
            Ok((stamp, rev)) => {
                settle(round.state, stamp, Some(rev), &local);
                *round.hlc = clock.last().raw();
                return Ok(());
            }
            Err(RoundError::Store(StoreError::Conflict)) if attempt < 3 => continue,
            Err(error) => return Err(error),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{strip_device_only, without_repeated_words};
    use serde_json::json;

    #[test]
    fn words_added_on_two_computers_in_different_case_are_kept_once() {
        let merged = without_repeated_words(
            json!({"dictionary": {"words": ["Oleafly", "typst", "oleafly"]}}),
        );
        assert_eq!(
            merged,
            json!({"dictionary": {"words": ["Oleafly", "typst"]}})
        );
    }

    #[test]
    fn the_default_latex_engine_stays_on_each_computer() {
        let values =
            json!({"engine": {"defaultLatexEngine": "latexmk"}, "general": {"language": "de"}});
        assert_eq!(
            strip_device_only(values),
            json!({"general": {"language": "de"}})
        );
    }
}
