//! The one list of command modules. Each workstream adds its line under its
//! own anchor; `Meta` (help, version, completions, man) stays last.
crate::command_modules! {
    // 0.4.8 F1:
    Build => crate::commands::build::Commands,
    Workspace => crate::commands::workspace::Commands,
    Context => crate::commands::context::Commands,
    Doctor => crate::commands::doctor::Commands,
    Mcp => crate::commands::mcp_cmd::Commands,
    Docs => crate::commands::docs::Commands,
    Cite => crate::commands::cite::Commands,
    Templates => crate::commands::templates::Commands,
    Typst => crate::commands::typst_cmd::Commands,
    Checkpoint => crate::commands::checkpoint::Commands,
    Config => crate::commands::config::Commands,
    // 0.4.8 F2:
    Auth => crate::auth::Commands,
    Remote => crate::remote::Commands,
    Server => crate::server::Commands,
    // 0.4.8 F3:
    Check => crate::check::Commands,
    Lint => crate::lint::Commands,
    // 0.4.8 L:
    Agent => crate::agent::Commands,
    Daemon => crate::daemon::Commands,
    // meta (keep last)
    Meta => crate::commands::meta::Commands,
}
