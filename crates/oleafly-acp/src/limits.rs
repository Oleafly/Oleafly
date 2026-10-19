//! Every limit and timeout the client enforces. The values match what
//! Oleafly's own ACP client used before it moved onto the official SDK.
use std::time::Duration;

/// Largest message the client reads or writes, newline included.
pub const MAX_FRAME: usize = 1 << 20;
/// Largest `session/update` that is read and cut instead of ending the
/// connection. Pi sends a whole-file diff in one update.
pub const MAX_DROPPED_UPDATE: usize = 16 << 20;
/// Requests to the agent that may wait for a reply at once.
pub const MAX_PENDING: usize = 32;
/// Bytes of the agent's stderr kept for error messages.
pub const MAX_STDERR_TAIL: usize = 8 * 1024;
/// How long one write to the agent's stdin may take.
pub const WRITE_TIMEOUT: Duration = Duration::from_secs(10);
/// Default deadline for a request.
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
/// Deadline for `authenticate` (a browser sign-in can take a while).
pub const AUTH_TIMEOUT: Duration = Duration::from_secs(180);
/// Deadline for a sign-in that asks the user questions.
pub const AUTH_ELICITATION_TIMEOUT: Duration = Duration::from_secs(15 * 60);
/// How long a cancelled turn may take to settle before the agent is stopped.
pub const CANCEL_GRACE: Duration = Duration::from_secs(10);
/// Default inactivity limit for an interactive turn.
pub const DEFAULT_INACTIVITY: Duration = Duration::from_secs(20 * 60);
/// Largest `session/prompt` payload, leaving room for the envelope.
pub const PROMPT_BUDGET: usize = MAX_FRAME - 1024;
