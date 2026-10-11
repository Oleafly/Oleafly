mod diagnostics;
mod http;
mod loopback;
mod session;
mod sign_in;
#[cfg(test)]
mod test_util;
mod url;
mod ws;

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use oleafly_collab_protocol::capabilities::{ProtocolRange, PROTOCOL_VERSION};

pub use self::diagnostics::{
    test_connection, test_connection_pinned, CheckId, CheckStatus, ConnectionCheck,
};
pub use self::http::ServerClient;
pub use self::session::{session_account, SessionManager};
pub use self::sign_in::{sign_in, SignInRequest};
pub use self::url::ServerUrl;
pub use self::ws::{connect_socket, SocketConnection};

pub(crate) const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

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
