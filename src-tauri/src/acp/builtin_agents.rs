pub(super) struct Builtin {
    pub(super) id: &'static str,
    pub(super) name: &'static str,
    pub(super) description: &'static str,
    pub(super) version: &'static str,
    pub(super) dist: BuiltinDist,
}

pub(super) enum BuiltinDist {
    Native {
        cmd: &'static str,
        args: &'static [&'static str],
        alt_cmds: &'static [&'static str],
    },
    Bridge {
        package: &'static str,
        cmd: &'static str,
        args: &'static [&'static str],
        node: u32,
    },
}

pub(super) const BUILTINS: &[Builtin] = &[
    Builtin {
        id: "claude",
        name: "Claude Code",
        description: "Uses the agent's own CLI account and permissions.",
        version: "0.95.0",
        dist: BuiltinDist::Bridge {
            package: "@agentclientprotocol/claude-agent-acp@0.95.0",
            cmd: "claude-agent-acp",
            args: &[],
            node: 22,
        },
    },
    Builtin {
        id: "codex",
        name: "Codex CLI",
        description: "Uses the agent's own CLI account and permissions.",
        version: "2.2.2",
        dist: BuiltinDist::Bridge {
            package: "@agentclientprotocol/codex-acp@2.2.2",
            cmd: "codex-acp",
            args: &[],
            node: 20,
        },
    },
    Builtin {
        id: "gemini",
        name: "Gemini CLI",
        description: "Uses the agent's own CLI account and permissions.",
        version: "0.64.0",
        dist: BuiltinDist::Bridge {
            package: "@google/gemini-cli@0.64.0",
            cmd: "gemini",
            // Every Gemini CLI release takes this flag (still in 0.64.0, as a
            // deprecated alias); `--acp` only exists from 0.33.0, and the same
            // args reach a Gemini the user installed themselves.
            args: &["--experimental-acp"],
            node: 20,
        },
    },
    Builtin {
        id: "pi",
        name: "Pi",
        description: "Uses the agent's own CLI account and permissions.",
        version: "0.0.34",
        dist: BuiltinDist::Bridge {
            package: "pi-acp@0.0.34",
            cmd: "pi-acp",
            args: &[],
            node: 22,
        },
    },
    Builtin {
        id: "opencode",
        name: "OpenCode",
        description: "Serves ACP from the installed CLI.",
        version: "1.19.3",
        dist: BuiltinDist::Native {
            cmd: "opencode",
            args: &["acp"],
            alt_cmds: &[],
        },
    },
    Builtin {
        id: "openclaw",
        name: "OpenClaw",
        description: "Serves ACP from the installed CLI.",
        version: "2026.9.2",
        dist: BuiltinDist::Native {
            cmd: "openclaw",
            args: &["acp"],
            alt_cmds: &[],
        },
    },
    Builtin {
        id: "cline",
        name: "Cline",
        description: "Serves ACP from the installed CLI.",
        version: "3.0.61",
        dist: BuiltinDist::Native {
            cmd: "cline",
            args: &["--acp"],
            alt_cmds: &[],
        },
    },
    Builtin {
        id: "hermes",
        name: "Hermes Agent",
        description: "Serves ACP from the installed CLI.",
        version: "0.22.2",
        dist: BuiltinDist::Native {
            cmd: "hermes",
            args: &["acp"],
            alt_cmds: &[],
        },
    },
    Builtin {
        id: "codebuddy",
        name: "CodeBuddy",
        description: "Serves ACP from the installed CLI.",
        version: "2.146.0",
        dist: BuiltinDist::Native {
            cmd: "codebuddy",
            args: &["--acp"],
            alt_cmds: &[],
        },
    },
    Builtin {
        id: "kimi",
        name: "Kimi Code",
        description: "Serves ACP from the installed CLI.",
        version: "1.52.0",
        dist: BuiltinDist::Native {
            cmd: "kimi",
            args: &["acp"],
            alt_cmds: &[],
        },
    },
    Builtin {
        id: "grok",
        name: "Grok Build",
        description: "Serves ACP from the installed CLI.",
        version: "1.0.63",
        dist: BuiltinDist::Native {
            cmd: "grok",
            args: &["agent", "stdio"],
            alt_cmds: &[],
        },
    },
    Builtin {
        id: "cursor",
        name: "Cursor",
        description: "Serves ACP from the installed CLI.",
        version: "2026.10.16",
        dist: BuiltinDist::Native {
            cmd: "cursor-agent",
            args: &["acp"],
            alt_cmds: &["agent"],
        },
    },
    Builtin {
        id: "deepseek",
        name: "DeepSeek Harness",
        description: "Serves ACP from the installed CLI.",
        version: "0.1.2-rc.1",
        dist: BuiltinDist::Native {
            cmd: "dsh",
            args: &["--profile", "acp"],
            alt_cmds: &[],
        },
    },
    Builtin {
        id: "qoder",
        name: "Qoder",
        description: "Serves ACP from the installed CLI.",
        version: "1.1.45",
        dist: BuiltinDist::Native {
            cmd: "qodercli",
            args: &["--acp"],
            alt_cmds: &[],
        },
    },
    Builtin {
        id: "antigravity",
        name: "Antigravity CLI",
        description: "Serves ACP from the installed CLI.",
        version: "1.5.0",
        dist: BuiltinDist::Native {
            cmd: "agy",
            args: &["acp"],
            alt_cmds: &[],
        },
    },
];
