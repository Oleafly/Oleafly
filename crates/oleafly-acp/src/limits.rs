use std::time::Duration;

pub const MAX_FRAME: usize = 1 << 20;
pub const MAX_DROPPED_UPDATE: usize = 16 << 20;
pub const MAX_PENDING: usize = 32;
pub const MAX_STDERR_TAIL: usize = 8 * 1024;
pub const WRITE_TIMEOUT: Duration = Duration::from_secs(10);
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
pub const AUTH_TIMEOUT: Duration = Duration::from_secs(180);
pub const AUTH_ELICITATION_TIMEOUT: Duration = Duration::from_secs(15 * 60);
pub const CANCEL_GRACE: Duration = Duration::from_secs(10);
pub const DEFAULT_INACTIVITY: Duration = Duration::from_secs(20 * 60);
pub const PROMPT_BUDGET: usize = MAX_FRAME - 1024;
