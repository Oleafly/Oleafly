use serde::Serialize;

use crate::engine::NodeKind;
use crate::rng::Rng;

pub const DEFAULT_CAP: usize = 8 * 1024 * 1024;

pub const WORDS: [&str; 20] = [
    "the",
    "model",
    "results",
    "we",
    "show",
    "that",
    "naïve",
    "baseline",
    "café",
    "🌿",
    "数据",
    "Ω",
    "proof",
    "lemma",
    "\\cite{a}",
    "$x^2$",
    "table",
    "figure",
    "section",
    "data",
];

pub const TRACE_DIRS: [&str; 5] = ["chapters", "figures", "sections", "data", "appendix"];

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Scale {
    Small,
    Full,
}

impl Scale {
    pub fn pick(self, small: usize, full: usize) -> usize {
        match self {
            Scale::Small => small,
            Scale::Full => full,
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Scale::Small => "small",
            Scale::Full => "full",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Cut {
    Clean,
    BeforeSave,
    Empty,
    OneByte,
    Half,
    DropLastByte,
}

impl Cut {
    pub fn apply(self, bytes: &[u8]) -> Vec<u8> {
        match self {
            Cut::Clean => bytes.to_vec(),
            Cut::BeforeSave | Cut::Empty => Vec::new(),
            Cut::OneByte => bytes.iter().take(1).copied().collect(),
            Cut::Half => bytes[..bytes.len() / 2].to_vec(),
            Cut::DropLastByte => bytes[..bytes.len().saturating_sub(1)].to_vec(),
        }
    }

    pub fn slug(self) -> &'static str {
        match self {
            Cut::Clean => "clean",
            Cut::BeforeSave => "before_save",
            Cut::Empty => "empty",
            Cut::OneByte => "one_byte",
            Cut::Half => "half",
            Cut::DropLastByte => "drop_last_byte",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Injection {
    RandomBytes { len: usize, seed: u64 },
    Empty,
    TruncatedLast,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Op {
    Create {
        actor: usize,
        id: String,
        parent: Option<String>,
        name: String,
        kind: NodeKind,
        blob: Option<String>,
        text: String,
    },
    Rename {
        actor: usize,
        id: String,
        name: String,
    },
    Move {
        actor: usize,
        id: String,
        parent: Option<String>,
    },
    Trash {
        actor: usize,
        id: String,
    },
    Restore {
        actor: usize,
        id: String,
        parent: Option<String>,
    },
    Edit {
        actor: usize,
        id: String,
        at: u64,
        delete: u64,
        insert: String,
    },
    Splice {
        actor: usize,
        id: String,
        pos: usize,
        delete: usize,
        insert: String,
    },
    Replace {
        actor: usize,
        id: String,
        text: String,
    },
    Sync {
        actor: usize,
    },
    SyncAll,
    Offline {
        actor: usize,
    },
    Online {
        actor: usize,
    },
    Compact {
        actor: usize,
        shallow: bool,
    },
    Persist {
        actor: usize,
    },
    Crash {
        actor: usize,
        cut: Cut,
        reuse_peer: bool,
    },
    SendWithoutReceipt {
        actor: usize,
    },
    ReverseNextPull {
        actor: usize,
    },
    Join {
        actor: usize,
    },
    Inject(Injection),
    CorruptNext {
        actor: usize,
    },
    SetCap(usize),
}

impl Op {
    pub fn actor(&self) -> Option<usize> {
        match self {
            Op::Create { actor, .. }
            | Op::Rename { actor, .. }
            | Op::Move { actor, .. }
            | Op::Trash { actor, .. }
            | Op::Restore { actor, .. }
            | Op::Edit { actor, .. }
            | Op::Splice { actor, .. }
            | Op::Replace { actor, .. }
            | Op::Sync { actor }
            | Op::Offline { actor }
            | Op::Online { actor }
            | Op::Compact { actor, .. }
            | Op::Persist { actor }
            | Op::Crash { actor, .. }
            | Op::SendWithoutReceipt { actor }
            | Op::ReverseNextPull { actor }
            | Op::Join { actor }
            | Op::CorruptNext { actor } => Some(*actor),
            Op::SyncAll | Op::Inject(_) | Op::SetCap(_) => None,
        }
    }

    pub fn label(&self) -> String {
        match self {
            Op::Create { actor, id, .. } => format!("create {id} by {actor}"),
            Op::Rename { actor, id, .. } => format!("rename {id} by {actor}"),
            Op::Move { actor, id, .. } => format!("move {id} by {actor}"),
            Op::Trash { actor, id } => format!("trash {id} by {actor}"),
            Op::Restore { actor, id, .. } => format!("restore {id} by {actor}"),
            Op::Edit { actor, id, .. } => format!("edit {id} by {actor}"),
            Op::Splice { actor, id, pos, .. } => format!("splice {id} at {pos} by {actor}"),
            Op::Replace { actor, id, .. } => format!("replace {id} by {actor}"),
            other => format!("{other:?}"),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Check {
    Converged,
    ReplayMatches,
    FileContains { path: String, needle: String },
    NoFile { path: String },
    FileCount(usize),
    MarkersPresent(Vec<String>),
    CorruptionRejected { author: usize },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Scenario {
    pub name: String,
    pub actors: usize,
    pub late: Vec<usize>,
    pub cap: usize,
    pub setup: Vec<Op>,
    pub ops: Vec<Op>,
    pub checks: Vec<Check>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct TraceConfig {
    pub files: usize,
    pub bytes: usize,
    pub actors: usize,
    pub steps: usize,
    pub sync_every: usize,
    pub settle_every: usize,
}

impl TraceConfig {
    pub fn full() -> TraceConfig {
        TraceConfig {
            files: 50,
            bytes: 500_000,
            actors: 20,
            steps: 6_000,
            sync_every: 12,
            settle_every: 500,
        }
    }

    pub fn small() -> TraceConfig {
        TraceConfig {
            files: 10,
            bytes: 20_000,
            actors: 4,
            steps: 300,
            sync_every: 8,
            settle_every: 100,
        }
    }

    pub fn for_scale(scale: Scale) -> TraceConfig {
        match scale {
            Scale::Small => TraceConfig::small(),
            Scale::Full => TraceConfig::full(),
        }
    }
}

pub fn lorem(rng: &mut Rng, bytes: usize) -> String {
    let mut text = String::new();
    let mut words_in_line = 0;
    while text.len() < bytes {
        if let Some(word) = rng.pick(&WORDS) {
            text.push_str(word);
        }
        words_in_line += 1;
        if words_in_line >= 12 {
            text.push('\n');
            words_in_line = 0;
        } else {
            text.push(' ');
        }
    }
    text.push('\n');
    text
}

pub fn random_letters(rng: &mut Rng, len: usize) -> String {
    (0..len)
        .map(|_| char::from(b'a' + rng.below(26) as u8))
        .collect()
}

fn word(rng: &mut Rng) -> String {
    format!("{} ", rng.pick(&WORDS).copied().unwrap_or("x"))
}

pub fn generate(config: TraceConfig, seed: u64) -> Scenario {
    let mut rng = Rng::new(seed);
    let dirs: Vec<String> = (0..TRACE_DIRS.len())
        .map(|index| format!("d{index}"))
        .collect();
    let mut setup = Vec::new();
    for (index, name) in TRACE_DIRS.iter().enumerate() {
        setup.push(Op::Create {
            actor: 0,
            id: dirs[index].clone(),
            parent: None,
            name: (*name).to_owned(),
            kind: NodeKind::Dir,
            blob: None,
            text: String::new(),
        });
    }
    let blobs = config.files / 10;
    let texts = config.files - blobs;
    let per_file = config.bytes.div_ceil(texts.max(1));
    let mut text_ids = Vec::new();
    let mut names = Vec::new();
    for index in 0..config.files {
        let id = format!("f{index:03}");
        if index < blobs {
            setup.push(Op::Create {
                actor: 0,
                id,
                parent: Some(dirs[1].clone()),
                name: format!("fig{index}.png"),
                kind: NodeKind::Blob,
                blob: Some(format!("h{index}")),
                text: String::new(),
            });
            continue;
        }
        let parent = match index % 5 {
            0 => None,
            1 => Some(dirs[0].clone()),
            2 => Some(dirs[2].clone()),
            3 => Some(dirs[3].clone()),
            _ => Some(dirs[4].clone()),
        };
        let name = if index % 7 == 0 {
            format!("refs{index}.bib")
        } else {
            format!("file{index:03}.tex")
        };
        setup.push(Op::Create {
            actor: 0,
            id: id.clone(),
            parent,
            name: name.clone(),
            kind: NodeKind::Text,
            blob: None,
            text: lorem(&mut rng, per_file),
        });
        text_ids.push(id);
        names.push(name);
    }
    let mut ops = Vec::new();
    let mut created: Vec<Vec<String>> = vec![Vec::new(); config.actors];
    let mut published = text_ids.clone();
    let mut nodes: Vec<String> = dirs.iter().chain(text_ids.iter()).cloned().collect();
    for step in 0..config.steps {
        let actor = rng.index(config.actors);
        let roll = rng.below(1_000);
        let candidates: Vec<&String> = published.iter().chain(created[actor].iter()).collect();
        let target = candidates[rng.index(candidates.len())].clone();
        let op = if roll < 880 {
            let delete = if rng.chance(25) { rng.below(12) } else { 0 };
            let insert = if delete == 0 || rng.chance(85) {
                word(&mut rng)
            } else {
                String::new()
            };
            Op::Edit {
                actor,
                id: target,
                at: rng.next_u64(),
                delete,
                insert,
            }
        } else if roll < 905 {
            let name = if rng.chance(30) {
                rng.pick(&names)
                    .map(|name| name.to_uppercase())
                    .unwrap_or_default()
            } else if rng.chance(30) {
                rng.pick(&names).cloned().unwrap_or_default()
            } else {
                format!("renamed{step}.tex")
            };
            Op::Rename {
                actor,
                id: rng.pick(&nodes).cloned().unwrap_or_default(),
                name,
            }
        } else if roll < 930 {
            let parent = if rng.chance(20) {
                None
            } else {
                rng.pick(&dirs).cloned()
            };
            Op::Move {
                actor,
                id: rng.pick(&nodes).cloned().unwrap_or_default(),
                parent,
            }
        } else if roll < 945 {
            Op::Trash { actor, id: target }
        } else if roll < 960 {
            Op::Restore {
                actor,
                id: target,
                parent: rng.pick(&dirs).cloned(),
            }
        } else if roll < 980 {
            let id = format!("c{step}");
            created[actor].push(id.clone());
            let name = rng
                .pick(&names)
                .cloned()
                .unwrap_or_else(|| "new.tex".to_owned());
            Op::Create {
                actor,
                id,
                parent: rng.pick(&dirs).cloned(),
                name,
                kind: NodeKind::Text,
                blob: None,
                text: lorem(&mut rng, 200),
            }
        } else if roll < 995 {
            Op::Offline { actor }
        } else {
            Op::Compact {
                actor,
                shallow: false,
            }
        };
        ops.push(op);
        if step % config.sync_every == config.sync_every - 1 {
            ops.push(Op::Sync { actor });
        }
        if step % config.settle_every == config.settle_every - 1 {
            for other in 0..config.actors {
                ops.push(Op::Online { actor: other });
            }
            ops.push(Op::SyncAll);
            for list in &mut created {
                published.append(list);
            }
            nodes = dirs.iter().chain(published.iter()).cloned().collect();
        }
    }
    Scenario {
        name: "generated_trace".to_owned(),
        actors: config.actors,
        late: Vec::new(),
        cap: DEFAULT_CAP,
        setup,
        ops,
        checks: vec![Check::Converged, Check::ReplayMatches],
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct MonthsConfig {
    pub days: u32,
    pub edits_per_day: usize,
    pub actors: usize,
    pub active_per_day: usize,
    pub sync_every: usize,
    pub compact_every_days: u32,
}

impl MonthsConfig {
    pub fn six_months() -> MonthsConfig {
        MonthsConfig {
            days: 180,
            edits_per_day: 300,
            actors: 20,
            active_per_day: 3,
            sync_every: 25,
            compact_every_days: 30,
        }
    }

    pub fn smoke() -> MonthsConfig {
        MonthsConfig {
            days: 3,
            edits_per_day: 30,
            actors: 4,
            active_per_day: 2,
            sync_every: 10,
            compact_every_days: 2,
        }
    }
}

pub fn months(config: MonthsConfig, base: TraceConfig, seed: u64) -> Scenario {
    let mut scenario = generate(
        TraceConfig {
            steps: 0,
            actors: config.actors,
            ..base
        },
        seed,
    );
    scenario.name = "six_months".to_owned();
    let text_ids: Vec<String> = scenario
        .setup
        .iter()
        .filter_map(|op| match op {
            Op::Create {
                id,
                kind: NodeKind::Text,
                ..
            } => Some(id.clone()),
            _ => None,
        })
        .collect();
    let mut rng = Rng::new(seed ^ 0x5eed);
    let mut ops = Vec::new();
    for day in 0..config.days {
        let active: Vec<usize> = (0..config.active_per_day.max(1))
            .map(|_| rng.index(config.actors))
            .collect();
        for actor in &active {
            ops.push(Op::Online { actor: *actor });
        }
        for edit in 0..config.edits_per_day {
            let actor = active[edit % active.len()];
            let id = text_ids[rng.index(text_ids.len())].clone();
            let delete = if rng.chance(15) { rng.below(6) } else { 0 };
            let insert = if delete > 0 && rng.chance(50) {
                String::new()
            } else {
                word(&mut rng)
            };
            ops.push(Op::Edit {
                actor,
                id,
                at: rng.next_u64(),
                delete,
                insert,
            });
            if edit % config.sync_every == config.sync_every - 1 {
                ops.push(Op::Sync { actor });
            }
        }
        for actor in &active {
            ops.push(Op::Sync { actor: *actor });
        }
        if config.compact_every_days > 0
            && day % config.compact_every_days == config.compact_every_days - 1
        {
            ops.push(Op::Compact {
                actor: active[0],
                shallow: false,
            });
        }
        for actor in &active {
            ops.push(Op::Offline { actor: *actor });
        }
    }
    scenario.ops = ops;
    scenario.checks = vec![Check::Converged];
    scenario
}
