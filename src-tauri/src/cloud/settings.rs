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
const DEVICE_ONLY: [(&str, &str); 1] = [("experimentation", "cloudSync")];

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
    Apply { values: Value, stamp: u64 },
    Choose { values: Value, stamp: u64 },
}

pub(crate) fn strip_device_only(mut values: Value) -> Value {
    for (group, field) in DEVICE_ONLY {
        if let Some(Value::Object(map)) = values.get_mut(group) {
            map.remove(field);
            if map.is_empty() {
                if let Value::Object(root) = &mut values {
                    root.remove(group);
                }
            }
        }
    }
    values
}

struct RemoteSettings {
    blob: SettingsBlob,
    rev: String,
}

async fn fetch<S: CloudStore>(store: &S) -> Result<Option<RemoteSettings>, RoundError> {
    let Some((bytes, rev)) = store.get(SETTINGS_REMOTE, MAX_SETTINGS_BYTES).await? else {
        return Ok(None);
    };
    let blob: SettingsBlob = serde_json::from_slice(&bytes)
        .map_err(|_| StoreError::Server("the settings in dropbox are unreadable".into()))?;
    if blob.v > SETTINGS_VERSION {
        return Err(RoundError::NewerVersion);
    }
    if !blob.values.is_object() {
        return Err(StoreError::Server("the settings in dropbox are unreadable".into()).into());
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
) -> Result<u64, RoundError> {
    let stamp = Stamp::new(clock.tick(now_ms()), device);
    let blob = SettingsBlob {
        v: SETTINGS_VERSION,
        stamp,
        device: Some(device_name.to_string()),
        values: values.clone(),
    };
    let bytes = serde_json::to_vec(&blob).map_err(|error| RoundError::Local(error.to_string()))?;
    store.put(SETTINGS_REMOTE, bytes, mode).await?;
    Ok(stamp.hlc.raw())
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

async fn sync_once<S: CloudStore>(
    store: &S,
    hlc: &mut u64,
    state: &mut SettingsState,
    device: DeviceId,
    device_name: &str,
    local: &Value,
) -> Result<SettingsOutcome, RoundError> {
    let remote = fetch(store).await?;
    let mut clock = clock_after(*hlc, remote.as_ref());
    let Some(remote_settings) = &remote else {
        let stamp = push(
            store,
            &mut clock,
            device,
            device_name,
            local,
            WriteMode::Add,
        )
        .await?;
        state.stamp = stamp;
        state.base = Some(local.clone());
        state.offered = None;
        *hlc = clock.last().raw();
        return Ok(SettingsOutcome::Pushed);
    };
    let remote_values = &remote_settings.blob.values;
    let remote_stamp = remote_settings.blob.stamp.hlc.raw();
    *hlc = clock.last().raw();
    let Some(base) = state.base.clone() else {
        if remote_values == local {
            state.stamp = remote_stamp;
            state.base = Some(local.clone());
            state.offered = None;
            return Ok(SettingsOutcome::Current);
        }
        state.offered = Some(remote_stamp);
        return Ok(SettingsOutcome::Choose {
            values: remote_values.clone(),
            stamp: remote_stamp,
        });
    };
    let local_changed = *local != base;
    let remote_changed = remote_stamp != state.stamp && *remote_values != base;
    match (local_changed, remote_changed) {
        (false, false) => {
            state.stamp = remote_stamp;
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
            let stamp = push(
                store,
                &mut clock,
                device,
                device_name,
                local,
                mode_for(remote.as_ref()),
            )
            .await?;
            state.stamp = stamp;
            state.base = Some(local.clone());
            state.offered = None;
            *hlc = clock.last().raw();
            Ok(SettingsOutcome::Pushed)
        }
        (true, true) => {
            let merged = merge3(Some(&base), local, remote_values);
            let stamp = push(
                store,
                &mut clock,
                device,
                device_name,
                &merged,
                mode_for(remote.as_ref()),
            )
            .await?;
            state.stamp = stamp;
            state.base = Some(merged.clone());
            state.offered = Some(stamp);
            *hlc = clock.last().raw();
            if merged == *local {
                state.offered = None;
                return Ok(SettingsOutcome::Pushed);
            }
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
    state.stamp = stamp;
    state.base = Some(strip_device_only(values));
    state.offered = None;
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
        let remote = fetch(store).await?;
        let mut clock = clock_after(*round.hlc, remote.as_ref());
        match push(
            store,
            &mut clock,
            round.device,
            round.device_name,
            &local,
            mode_for(remote.as_ref()),
        )
        .await
        {
            Ok(stamp) => {
                round.state.stamp = stamp;
                round.state.base = Some(local);
                round.state.offered = None;
                *round.hlc = clock.last().raw();
                return Ok(());
            }
            Err(RoundError::Store(StoreError::Conflict)) if attempt < 3 => continue,
            Err(error) => return Err(error),
        }
    }
}
