//! Oleafly's Agent Client Protocol client, without Tauri. The official
//! `agent-client-protocol` SDK runs the JSON-RPC connection; this crate adds
//! the limits, ordering, redaction and parsing Oleafly relies on, so the
//! app, the CLI and the background daemon talk to CLI agents the same way.
pub mod bound;
pub mod capabilities;
pub mod client;
pub mod controls;
pub mod elicitation;
pub mod error;
pub mod launch;
pub mod limits;
pub mod orphans;
pub mod paths;
pub mod process;
pub mod prompt;
pub mod providers;
pub mod redact;
pub mod transport;
pub mod usage;
pub mod v2;

pub use client::{
    AcpClient, ClientHost, ClientInfo, ClientOptions, IncomingRequest, InitializeError, Negotiated,
    NullHost, ProtocolVersion, TurnTiming,
};
pub use error::RpcError;
