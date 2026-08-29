//! Session state: context-window accounting, the turn loop, token budgets,
//! and the compaction that rolls a turn over into a fresh context window.

pub(crate) mod compact;
pub(crate) mod context_window;
pub(crate) mod token_budget;
pub(crate) mod turn;

pub use token_budget::{
    should_roll_over, CompactionPhase, CompactionReason, InitialContextInjection, TokenBudget,
};
