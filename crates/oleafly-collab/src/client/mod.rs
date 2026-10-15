mod access_log;
mod admin_console;
mod code_sign_in;
mod diagnostics;
#[cfg(feature = "e2e-hooks")]
pub mod e2e_route;
mod guests;
mod http;
mod loopback;
mod loopback_text;
mod poll;
mod session;
mod sign_in;
#[cfg(test)]
pub(crate) mod test_util;
mod url;
mod ws;

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use oleafly_collab_protocol::capabilities::{ProtocolRange, PROTOCOL_VERSION};

pub use self::code_sign_in::{
    sign_in_with_code, sign_in_with_code_as, CodeSignInRequest, SignInCode,
};
pub use self::diagnostics::{
    test_connection, test_connection_pinned, CheckId, CheckStatus, ConnectionCheck,
};
pub use self::http::{ServerClient, SnapshotDownload, SnapshotSignature, TransferProgress};
pub(crate) use self::poll::{
    keep_polling, post_outbox, Outbox, PollChannel, PollOpen, PollRequest, PollTiming, Polled,
};
pub use self::session::{session_account, SessionManager};
pub use self::sign_in::{sign_in, sign_in_as, SignInRequest};
pub use self::url::ServerUrl;
pub use self::ws::{connect_socket, SocketConnection};
pub(crate) use self::ws::{Heard, Socket};

pub(crate) const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const SLOWEST_UPLINK_BYTES_PER_SECOND: f64 = 16.0 * 1024.0;

// The time a slow link that still works needs to carry `bytes` up to the
// server, given on top of the usual waits so a large change is not cut off.
pub(crate) fn upload_allowance(bytes: usize) -> Duration {
    Duration::from_secs_f64(bytes as f64 / SLOWEST_UPLINK_BYTES_PER_SECOND)
}

pub(crate) fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or(0)
}

pub(crate) fn client_protocol() -> ProtocolRange {
    ProtocolRange {
        min: PROTOCOL_VERSION,
        max: PROTOCOL_VERSION,
    }
}
