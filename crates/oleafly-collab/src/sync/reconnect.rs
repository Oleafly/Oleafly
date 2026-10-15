use std::time::Duration;

use oleafly_collab_protocol::capabilities::{negotiate, VersionMismatch};
use ring::rand::{SecureRandom, SystemRandom};
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender};

use super::online::{serve, Pace};
use super::wire::{connect, Wire};
use super::writers::WriterRetry;
use super::{
    failed_ending, lock, EndReason, LiveCommand, LiveEvent, LiveLink, LiveStatus, SharedLive,
    TransportOptions,
};
use crate::client::client_protocol;
use crate::CollabError;

const BACKOFF_MS: [u64; 5] = [500, 1_000, 2_000, 3_000, 5_000];
// The quick waits cover about a minute of failures. After that each wait
// doubles up to a minute, so an hour-long outage costs a client about a
// hundred attempts instead of well over a thousand, spread out so clients
// don't all arrive the moment the server is back.
const QUICK_ATTEMPTS: usize = 25;
const LONGEST_WAIT_MS: u64 = 60_000;
const HTTPS_CHECK_WITHIN: Duration = Duration::from_secs(10);
const JITTER_FLOOR_MS: u64 = 100;
const STEADY_AFTER: Duration = Duration::from_secs(10);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Reached {
    Never,
    Briefly,
    Steady,
}

impl Reached {
    pub(super) fn after(online: Duration) -> Reached {
        if online >= STEADY_AFTER {
            Reached::Steady
        } else {
            Reached::Briefly
        }
    }
}

fn within(floor: u64, cap: u64, random: u64) -> u64 {
    floor + random % (cap - floor + 1)
}

fn jittered(cap: u64, random: u64) -> u64 {
    within(JITTER_FLOOR_MS.min(cap), cap, random)
}

fn backoff_step(attempt: usize, reached: Reached) -> usize {
    if reached == Reached::Steady {
        0
    } else {
        attempt
    }
}

fn backoff_cap(attempt: usize) -> u64 {
    let quick = BACKOFF_MS[attempt.min(BACKOFF_MS.len() - 1)];
    if attempt < QUICK_ATTEMPTS {
        return quick;
    }
    let doublings = (attempt - QUICK_ATTEMPTS + 1).min(4) as u32;
    (quick << doublings).min(LONGEST_WAIT_MS)
}

fn random_u64() -> u64 {
    let mut random = [0u8; 8];
    let _ = SystemRandom::new().fill(&mut random);
    u64::from_le_bytes(random)
}

fn backoff_wait(attempt: usize) -> u64 {
    jittered(backoff_cap(attempt), random_u64())
}

// A busy server waits at least half the long wait, so the clients it
// turned away don't all come back within a few seconds.
fn busy_wait(attempt: usize, random: u64) -> u64 {
    let cap = backoff_cap(attempt);
    within(cap / 2, cap, random)
}

pub(super) fn busy(error: &CollabError) -> bool {
    matches!(
        error,
        CollabError::Api {
            status: 429 | 503,
            ..
        }
    )
}

// A server that says it is busy or rate limited gets the long waits at once.
fn after_refusal(attempt: usize, error: &CollabError) -> usize {
    if busy(error) {
        attempt.max(QUICK_ATTEMPTS)
    } else {
        attempt
    }
}

enum Waited {
    Out,
    Now,
    Stopped,
}

async fn wait_out(delay: Duration, commands: &mut UnboundedReceiver<LiveCommand>) -> Waited {
    let sleep = tokio::time::sleep(delay);
    tokio::pin!(sleep);
    loop {
        tokio::select! {
            () = &mut sleep => return Waited::Out,
            command = commands.recv() => match command {
                Some(LiveCommand::Stop) | None => return Waited::Stopped,
                Some(LiveCommand::Reconnect) => return Waited::Now,
                Some(LiveCommand::Flush | LiveCommand::Presence(_) | LiveCommand::LeavePresence) => {}
            },
        }
    }
}

pub(super) enum Exit {
    End(EndReason),
    Retry(Reached),
    Switch,
    // Reload from the server's snapshot: connect again at once, without
    // showing the session as offline.
    Resync,
    // The server answered 429 or 503: the long waits, on either transport.
    Busy,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Transport {
    Socket,
    Poll,
}

fn looks_blocked(error: &CollabError) -> bool {
    match error {
        CollabError::Network(_) => true,
        CollabError::Api { status, code, .. } => code == "websocket_refused" && *status != 429,
        _ => false,
    }
}

async fn answers_https(link: &LiveLink) -> bool {
    matches!(
        tokio::time::timeout(HTTPS_CHECK_WITHIN, link.client.capabilities()).await,
        Ok(Ok(_))
    )
}

pub(super) fn refused_version(error: &CollabError) -> bool {
    matches!(error, CollabError::Api { code, .. } if code == "protocol_mismatch")
}

// Retrying never helps once the server refuses this app's protocol version
// or a different server answers at the address. The server's manifest says
// which side needs an update. Without the manifest this is left to the
// usual retries.
pub(super) async fn ending_for_version(link: &LiveLink) -> Option<EndReason> {
    let manifest = tokio::time::timeout(HTTPS_CHECK_WITHIN, link.client.capabilities())
        .await
        .ok()?
        .ok()?;
    if manifest.server_id != link.server_id {
        return Some(EndReason::ServerChanged);
    }
    match negotiate(client_protocol(), manifest.protocol) {
        Ok(_) => None,
        Err(VersionMismatch::ClientTooOld) => Some(EndReason::ClientTooOld),
        Err(VersionMismatch::ServerTooOld) => Some(EndReason::ServerTooOld),
    }
}

pub(super) async fn run(
    link: LiveLink,
    project: SharedLive,
    events: UnboundedSender<LiveEvent>,
    mut commands: UnboundedReceiver<LiveCommand>,
    options: TransportOptions,
) {
    lock(&project).set_device(link.device_id);
    let retry = WriterRetry::default();
    let mut attempt = 0usize;
    let mut transport = Transport::Socket;
    let mut refused = 0u32;
    let limit = options.fallback_after.max(1);
    let pace = |probe| Pace {
        probe,
        ping_every: options.ping_every,
        quiet_for: options.quiet_for,
    };
    let mut quietly = false;
    loop {
        if lock(&project).damaged() {
            let _ = events.send(LiveEvent::Status(LiveStatus::Ended {
                reason: failed_ending(),
            }));
            return;
        }
        if !std::mem::take(&mut quietly) {
            let _ = events.send(LiveEvent::Status(LiveStatus::Connecting));
        }
        let mut turned_away = false;
        let exit = match transport {
            Transport::Socket => match connect(&link).await {
                Ok(socket) => {
                    refused = 0;
                    let wire = Wire::socket(socket);
                    serve(
                        &link,
                        &project,
                        &events,
                        &mut commands,
                        wire,
                        pace(None),
                        &retry,
                    )
                    .await
                }
                Err(CollabError::Unauthorized) => Exit::End(EndReason::SignedOut),
                Err(CollabError::SessionEnded(reason)) => {
                    Exit::End(EndReason::of_session(Some(reason)))
                }
                Err(CollabError::ServerChanged { .. }) => Exit::End(EndReason::ServerChanged),
                Err(error) if refused_version(&error) => match ending_for_version(&link).await {
                    Some(reason) => Exit::End(reason),
                    None => Exit::Retry(Reached::Never),
                },
                Err(error) => {
                    turned_away = busy(&error);
                    attempt = after_refusal(attempt, &error);
                    if looks_blocked(&error) && answers_https(&link).await {
                        refused += 1;
                    }
                    if refused >= limit {
                        refused = 0;
                        transport = Transport::Poll;
                        Exit::Switch
                    } else {
                        Exit::Retry(Reached::Never)
                    }
                }
            },
            Transport::Poll => {
                let wire = Wire::poll(&link);
                let probe = pace(Some(options.retry_socket_every));
                let exit =
                    serve(&link, &project, &events, &mut commands, wire, probe, &retry).await;
                match exit {
                    Exit::Switch => transport = Transport::Socket,
                    Exit::Retry(Reached::Never) => {
                        refused += 1;
                        if refused >= limit {
                            refused = 0;
                            transport = Transport::Socket;
                        }
                    }
                    Exit::Retry(_) | Exit::Resync => refused = 0,
                    Exit::End(_) | Exit::Busy => {}
                }
                exit
            }
        };
        let exit = {
            let mut live = lock(&project);
            live.disconnected();
            if live.damaged() {
                Exit::End(failed_ending())
            } else {
                exit
            }
        };
        match exit {
            Exit::End(reason) => {
                if reason.session().is_some() {
                    let _ = link.sessions.clear(link.server_id);
                }
                let _ = events.send(LiveEvent::Status(LiveStatus::Ended { reason }));
                return;
            }
            Exit::Switch => continue,
            Exit::Resync => {
                quietly = true;
                continue;
            }
            Exit::Retry(reached) => attempt = backoff_step(attempt, reached),
            Exit::Busy => {
                turned_away = true;
                attempt = attempt.max(QUICK_ATTEMPTS);
            }
        }
        let delay = if turned_away {
            busy_wait(attempt, random_u64())
        } else {
            backoff_wait(attempt)
        };
        // A server that said how long to stay away with Retry-After gets at
        // least that long.
        let delay = link.client.asked_wait().map_or(delay, |asked| {
            delay.max(u64::try_from(asked.as_millis()).unwrap_or(u64::MAX))
        });
        attempt = attempt.saturating_add(1);
        let _ = events.send(LiveEvent::Status(LiveStatus::Offline {
            retry_in_ms: delay,
        }));
        match wait_out(Duration::from_millis(delay), &mut commands).await {
            Waited::Out => {}
            Waited::Now => attempt = 0,
            Waited::Stopped => {
                let _ = events.send(LiveEvent::Status(LiveStatus::Ended {
                    reason: EndReason::Stopped,
                }));
                return;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    #[test]
    fn the_first_minute_of_retries_never_waits_more_than_five_seconds() {
        assert_eq!(BACKOFF_MS.iter().max(), Some(&5_000));
        assert!((0..QUICK_ATTEMPTS).all(|attempt| backoff_cap(attempt) <= 5_000));
    }

    #[test]
    fn waits_grow_to_a_minute_after_many_failures_and_start_over_once_connected() {
        let caps: Vec<u64> = (0..50).map(backoff_cap).collect();
        assert!(caps.windows(2).all(|pair| pair[0] <= pair[1]), "{caps:?}");
        assert_eq!(caps[0], 500);
        assert!(caps[QUICK_ATTEMPTS] > 5_000, "{caps:?}");
        assert_eq!(caps[49], LONGEST_WAIT_MS);
        assert!(caps.iter().all(|cap| *cap <= LONGEST_WAIT_MS));
        let average_seconds: u64 = caps.iter().map(|cap| cap / 2).sum::<u64>() / 1_000;
        assert!(
            average_seconds > 60 * 10,
            "{average_seconds} s over 50 failures"
        );
        assert_eq!(backoff_cap(backoff_step(49, Reached::Steady)), 500);
        assert_eq!(
            backoff_cap(backoff_step(49, Reached::Briefly)),
            LONGEST_WAIT_MS
        );
    }

    #[test]
    fn a_busy_or_rate_limited_server_gets_the_long_waits_at_once() {
        let refused = |status| CollabError::Api {
            status,
            code: "websocket_refused".to_owned(),
            message: String::new(),
        };
        assert_eq!(after_refusal(2, &refused(429)), QUICK_ATTEMPTS);
        assert_eq!(after_refusal(2, &refused(503)), QUICK_ATTEMPTS);
        assert_eq!(after_refusal(40, &refused(429)), 40);
        assert_eq!(after_refusal(2, &refused(502)), 2);
        assert_eq!(
            after_refusal(2, &CollabError::Network("down".to_owned())),
            2
        );
        assert!(backoff_cap(after_refusal(0, &refused(429))) > 5_000);
        for random in [0, 1, 4_999, 5_000, u64::MAX] {
            let wait = busy_wait(QUICK_ATTEMPTS, random);
            assert!((5_000..=10_000).contains(&wait), "{wait} ms");
            let later = busy_wait(QUICK_ATTEMPTS + 3, random);
            assert!((30_000..=60_000).contains(&later), "{later} ms");
        }
    }

    #[tokio::test]
    async fn reconnect_now_cuts_a_long_wait_short() {
        let (commands, mut receiver) = tokio::sync::mpsc::unbounded_channel();
        commands.send(LiveCommand::Flush).unwrap();
        commands.send(LiveCommand::Reconnect).unwrap();
        let waited = tokio::time::timeout(
            Duration::from_secs(5),
            wait_out(Duration::from_secs(600), &mut receiver),
        )
        .await
        .expect("the wait ends at once");
        assert!(matches!(waited, Waited::Now));
        commands.send(LiveCommand::Stop).unwrap();
        assert!(matches!(
            wait_out(Duration::from_secs(600), &mut receiver).await,
            Waited::Stopped
        ));
        assert!(matches!(
            wait_out(Duration::from_millis(10), &mut receiver).await,
            Waited::Out
        ));
    }

    #[test]
    fn reconnect_waits_spread_over_the_whole_window() {
        for cap in BACKOFF_MS {
            for random in [0, 1, 99, 4_999, u64::MAX] {
                let wait = jittered(cap, random);
                assert!(
                    (JITTER_FLOOR_MS..=cap).contains(&wait),
                    "{wait} ms for a {cap} ms window"
                );
            }
        }
        let spread: BTreeSet<u64> = (0..200u64)
            .map(|n| jittered(5_000, n.wrapping_mul(0x9E37_79B9_7F4A_7C15)))
            .collect();
        assert!(spread.len() > 150, "{} distinct waits", spread.len());
    }

    #[test]
    fn only_a_connection_that_stayed_up_starts_the_waits_over() {
        assert_eq!(Reached::after(Duration::from_millis(300)), Reached::Briefly);
        assert_eq!(Reached::after(STEADY_AFTER), Reached::Steady);
        assert_eq!(backoff_step(3, Reached::Never), 3);
        assert_eq!(backoff_step(3, Reached::Briefly), 3);
        assert_eq!(backoff_step(3, Reached::Steady), 0);
    }
}
