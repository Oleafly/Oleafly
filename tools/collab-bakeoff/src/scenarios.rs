use crate::engine::NodeKind;
use crate::rng::Rng;
use crate::trace::{
    self, lorem, random_letters, Check, Cut, Injection, Op, Scale, Scenario, TraceConfig,
    DEFAULT_CAP,
};
use crate::utf16::utf16_len;

pub const SECTIONS: &str = "d-sec";
pub const FIGURES: &str = "d-fig";
pub const MAIN: &str = "f-main";
pub const INTRO: &str = "f-intro";
pub const REFS: &str = "f-refs";
pub const FIG: &str = "b-fig1";
pub const MAIN_PREFIX: &str = "\\documentclass{article}\n\\begin{document}\nHello 🌿";
pub const MAIN_TEXT: &str =
    "\\documentclass{article}\n\\begin{document}\nHello 🌿\n\\input{sections/intro}\n\\end{document}\n";
pub const BASE_FILES: usize = 4;

pub const CORE: [&str; 19] = [
    "concurrent_rename_rename",
    "rename_and_edit",
    "move_cycle",
    "move_and_trash",
    "trash_edit_restore",
    "trash_dir_with_edit_inside",
    "same_name_create",
    "case_only_create",
    "figure_collision",
    "ai_rewrite_burst",
    "offline_across_full_snapshot",
    "late_join_after_compaction",
    "out_of_order_and_duplicate_delivery",
    "kill_before_save",
    "kill_after_save_before_send",
    "kill_after_send_before_receipt",
    "fresh_peer_after_crash",
    "surrogate_after_emoji",
    "generated_trace",
];

pub fn text_file(actor: usize, id: &str, parent: Option<&str>, name: &str, text: &str) -> Op {
    Op::Create {
        actor,
        id: id.to_owned(),
        parent: parent.map(str::to_owned),
        name: name.to_owned(),
        kind: NodeKind::Text,
        blob: None,
        text: text.to_owned(),
    }
}

pub fn dir(actor: usize, id: &str, parent: Option<&str>, name: &str) -> Op {
    Op::Create {
        actor,
        id: id.to_owned(),
        parent: parent.map(str::to_owned),
        name: name.to_owned(),
        kind: NodeKind::Dir,
        blob: None,
        text: String::new(),
    }
}

pub fn blob(actor: usize, id: &str, parent: Option<&str>, name: &str, hash: &str) -> Op {
    Op::Create {
        actor,
        id: id.to_owned(),
        parent: parent.map(str::to_owned),
        name: name.to_owned(),
        kind: NodeKind::Blob,
        blob: Some(hash.to_owned()),
        text: String::new(),
    }
}

pub fn splice(actor: usize, id: &str, pos: usize, insert: &str) -> Op {
    Op::Splice {
        actor,
        id: id.to_owned(),
        pos,
        delete: 0,
        insert: insert.to_owned(),
    }
}

fn rename(actor: usize, id: &str, name: &str) -> Op {
    Op::Rename {
        actor,
        id: id.to_owned(),
        name: name.to_owned(),
    }
}

fn markers(values: &[&str]) -> Check {
    Check::MarkersPresent(values.iter().map(|value| (*value).to_owned()).collect())
}

fn contains(path: &str, needle: &str) -> Check {
    Check::FileContains {
        path: path.to_owned(),
        needle: needle.to_owned(),
    }
}

fn no_file(path: &str) -> Check {
    Check::NoFile {
        path: path.to_owned(),
    }
}

pub fn base_setup() -> Vec<Op> {
    vec![
        dir(0, SECTIONS, None, "sections"),
        dir(0, FIGURES, None, "figures"),
        text_file(0, MAIN, None, "main.tex", MAIN_TEXT),
        text_file(0, INTRO, Some(SECTIONS), "intro.tex", "Intro text.\n"),
        text_file(0, REFS, None, "refs.bib", "@article{a, title={A}}\n"),
        blob(0, FIG, Some(FIGURES), "fig1.png", "h-fig1"),
    ]
}

pub fn blank(name: &str, actors: usize) -> Scenario {
    Scenario {
        name: name.to_owned(),
        actors,
        late: Vec::new(),
        cap: DEFAULT_CAP,
        setup: base_setup(),
        ops: Vec::new(),
        checks: Vec::new(),
    }
}

fn scenario(name: &str, actors: usize, ops: Vec<Op>, checks: Vec<Check>) -> Scenario {
    Scenario {
        ops,
        checks,
        ..blank(name, actors)
    }
}

pub fn concurrent_rename_rename() -> Scenario {
    scenario(
        "concurrent_rename_rename",
        3,
        vec![
            rename(1, REFS, "references.bib"),
            rename(2, REFS, "bibliography.bib"),
        ],
        vec![
            Check::Converged,
            Check::ReplayMatches,
            no_file("refs.bib"),
            Check::FileCount(BASE_FILES),
            markers(&["@article{a"]),
        ],
    )
}

pub fn rename_and_edit() -> Scenario {
    scenario(
        "rename_and_edit",
        3,
        vec![
            rename(1, MAIN, "paper.tex"),
            splice(2, MAIN, 0, "%edited-by-2\n"),
        ],
        vec![
            Check::Converged,
            Check::ReplayMatches,
            contains("paper.tex", "%edited-by-2"),
            no_file("main.tex"),
        ],
    )
}

pub fn move_cycle() -> Scenario {
    let mut built = scenario(
        "move_cycle",
        3,
        vec![
            Op::Move {
                actor: 1,
                id: "d-a".to_owned(),
                parent: Some("d-b".to_owned()),
            },
            Op::Move {
                actor: 2,
                id: "d-b".to_owned(),
                parent: Some("d-a".to_owned()),
            },
        ],
        vec![
            Check::Converged,
            Check::ReplayMatches,
            Check::FileCount(BASE_FILES + 1),
            markers(&["inside a"]),
        ],
    );
    built.setup.extend([
        dir(0, "d-a", None, "a"),
        dir(0, "d-b", None, "b"),
        text_file(0, "f-x", Some("d-a"), "x.tex", "inside a\n"),
    ]);
    built
}

pub fn move_and_trash() -> Scenario {
    scenario(
        "move_and_trash",
        3,
        vec![
            Op::Move {
                actor: 1,
                id: INTRO.to_owned(),
                parent: None,
            },
            Op::Trash {
                actor: 2,
                id: INTRO.to_owned(),
            },
        ],
        vec![
            Check::Converged,
            Check::ReplayMatches,
            markers(&["Intro text."]),
        ],
    )
}

pub fn trash_edit_restore() -> Scenario {
    scenario(
        "trash_edit_restore",
        3,
        vec![
            Op::Trash {
                actor: 1,
                id: INTRO.to_owned(),
            },
            splice(2, INTRO, 0, "edited while trashed "),
            Op::SyncAll,
            Op::Restore {
                actor: 0,
                id: INTRO.to_owned(),
                parent: Some(SECTIONS.to_owned()),
            },
        ],
        vec![
            Check::Converged,
            Check::ReplayMatches,
            contains("sections/intro.tex", "edited while trashed"),
        ],
    )
}

pub fn trash_dir_with_edit_inside() -> Scenario {
    scenario(
        "trash_dir_with_edit_inside",
        3,
        vec![
            Op::Trash {
                actor: 1,
                id: SECTIONS.to_owned(),
            },
            splice(2, INTRO, 0, "concurrent "),
            Op::SyncAll,
            Op::Restore {
                actor: 0,
                id: SECTIONS.to_owned(),
                parent: None,
            },
        ],
        vec![
            Check::Converged,
            Check::ReplayMatches,
            contains("sections/intro.tex", "concurrent Intro text."),
        ],
    )
}

pub fn same_name_create() -> Scenario {
    scenario(
        "same_name_create",
        3,
        vec![
            text_file(1, "c-1", None, "notes.tex", "from one\n"),
            text_file(2, "c-2", None, "notes.tex", "from two\n"),
        ],
        vec![
            Check::Converged,
            Check::ReplayMatches,
            Check::FileCount(BASE_FILES + 2),
            markers(&["from one", "from two"]),
        ],
    )
}

pub fn case_only_create() -> Scenario {
    scenario(
        "case_only_create",
        3,
        vec![
            text_file(1, "c-1", None, "Figure.tex", "upper\n"),
            text_file(2, "c-2", None, "figure.tex", "lower\n"),
        ],
        vec![
            Check::Converged,
            Check::ReplayMatches,
            Check::FileCount(BASE_FILES + 2),
            markers(&["upper", "lower"]),
        ],
    )
}

pub fn figure_collision() -> Scenario {
    scenario(
        "figure_collision",
        3,
        vec![
            blob(1, "g-1", Some(FIGURES), "fig2.png", "h-alice"),
            blob(2, "g-2", Some(FIGURES), "fig2.png", "h-bob"),
            blob(1, "g-3", Some(FIGURES), "fig3.png", "h-same"),
            blob(2, "g-4", Some(FIGURES), "fig3.png", "h-same"),
        ],
        vec![
            Check::Converged,
            Check::ReplayMatches,
            Check::FileCount(BASE_FILES + 3),
            markers(&["blob:h-alice", "blob:h-bob", "blob:h-same"]),
        ],
    )
}

pub fn ai_rewrite_burst(scale: Scale) -> Scenario {
    let chapters = scale.pick(6, 30);
    let mut rng = Rng::new(31);
    let mut setup = base_setup();
    setup.push(dir(0, "d-ch", None, "chapters"));
    for index in 0..chapters {
        setup.push(text_file(
            0,
            &format!("ch-{index}"),
            Some("d-ch"),
            &format!("ch{index}.tex"),
            &lorem(&mut rng, 2_000),
        ));
    }
    let mut ops = Vec::new();
    let mut expected = Vec::new();
    for actor in 1..=3 {
        for index in 0..chapters.min(10) {
            let marker = format!("[[typed-{actor}-{index}]]");
            ops.push(splice(actor, &format!("ch-{index}"), 0, &marker));
            expected.push(marker);
        }
    }
    for index in 0..chapters {
        let heading = format!("Rewritten chapter {index}\n");
        ops.push(Op::Replace {
            actor: 4,
            id: format!("ch-{index}"),
            text: format!("{heading}{}", lorem(&mut rng, 2_000)),
        });
        expected.push(heading);
    }
    ops.push(Op::Sync { actor: 4 });
    Scenario {
        name: "ai_rewrite_burst".to_owned(),
        actors: 5,
        late: Vec::new(),
        cap: DEFAULT_CAP,
        setup,
        ops,
        checks: vec![
            Check::Converged,
            Check::ReplayMatches,
            Check::MarkersPresent(expected),
        ],
    }
}

pub fn offline_across_compaction(shallow: bool) -> Scenario {
    let name = if shallow {
        "offline_across_shallow_compaction"
    } else {
        "offline_across_full_snapshot"
    };
    scenario(
        name,
        4,
        vec![
            Op::Offline { actor: 3 },
            splice(3, MAIN, 0, "offline edit\n"),
            splice(1, INTRO, 0, "online one\n"),
            Op::Sync { actor: 1 },
            Op::Compact { actor: 1, shallow },
            splice(2, REFS, 0, "% online two\n"),
            Op::Sync { actor: 2 },
            Op::Compact { actor: 2, shallow },
            splice(1, INTRO, 0, "after compaction\n"),
            Op::Sync { actor: 1 },
            Op::Online { actor: 3 },
            Op::Sync { actor: 3 },
        ],
        vec![
            Check::Converged,
            Check::ReplayMatches,
            markers(&[
                "offline edit",
                "online one",
                "online two",
                "after compaction",
            ]),
        ],
    )
}

pub fn late_join_after_compaction() -> Scenario {
    let mut built = scenario(
        "late_join_after_compaction",
        4,
        vec![
            splice(1, MAIN, 0, "first\n"),
            Op::Sync { actor: 1 },
            Op::Compact {
                actor: 1,
                shallow: true,
            },
            Op::Sync { actor: 2 },
            splice(2, INTRO, 0, "second\n"),
            Op::Sync { actor: 2 },
            Op::Join { actor: 3 },
            splice(3, REFS, 0, "% third\n"),
            Op::Sync { actor: 3 },
        ],
        vec![
            Check::Converged,
            Check::ReplayMatches,
            markers(&["first", "second", "third"]),
        ],
    );
    built.late = vec![3];
    built
}

pub fn out_of_order_delivery() -> Scenario {
    let mut ops = Vec::new();
    let mut expected = Vec::new();
    for index in 0..5 {
        let marker = format!("[seq-{index}]");
        ops.push(splice(1, MAIN, 0, &marker));
        ops.push(Op::Sync { actor: 1 });
        expected.push(marker);
    }
    ops.push(Op::ReverseNextPull { actor: 2 });
    ops.push(Op::Sync { actor: 2 });
    scenario(
        "out_of_order_and_duplicate_delivery",
        3,
        ops,
        vec![
            Check::Converged,
            Check::ReplayMatches,
            Check::MarkersPresent(expected),
        ],
    )
}

fn malformed(name: &str, injections: Vec<Injection>) -> Scenario {
    let mut ops = vec![
        splice(1, MAIN, 0, "before injection\n"),
        Op::Sync { actor: 1 },
    ];
    ops.extend(injections.into_iter().map(Op::Inject));
    ops.push(splice(2, INTRO, 0, "after injection\n"));
    ops.push(Op::Sync { actor: 2 });
    scenario(
        name,
        3,
        ops,
        vec![
            Check::Converged,
            Check::ReplayMatches,
            markers(&["before injection", "after injection"]),
        ],
    )
}

pub fn malformed_random_bytes() -> Scenario {
    malformed(
        "malformed_random_bytes",
        vec![
            Injection::RandomBytes { len: 512, seed: 7 },
            Injection::RandomBytes { len: 3, seed: 8 },
        ],
    )
}

pub fn malformed_empty() -> Scenario {
    malformed("malformed_empty", vec![Injection::Empty])
}

pub fn malformed_truncated() -> Scenario {
    malformed("malformed_truncated", vec![Injection::TruncatedLast])
}

pub fn corrupt_in_transit() -> Scenario {
    let paragraph = "abcdefghij".repeat(200);
    scenario(
        "corrupt_in_transit",
        3,
        vec![
            Op::CorruptNext { actor: 1 },
            splice(1, INTRO, 0, &paragraph),
            Op::Sync { actor: 1 },
        ],
        vec![Check::CorruptionRejected { author: 1 }],
    )
}

pub fn oversized_paste(scale: Scale) -> Scenario {
    let size = scale.pick(64 * 1024, 3 * 1024 * 1024);
    let paste = format!("{}PASTE-END", random_letters(&mut Rng::new(41), size));
    scenario(
        "oversized_paste",
        3,
        vec![splice(1, MAIN, 0, &paste), Op::Sync { actor: 1 }],
        vec![
            Check::Converged,
            Check::ReplayMatches,
            contains("main.tex", "PASTE-END"),
        ],
    )
}

pub fn oversized_refused(scale: Scale) -> Scenario {
    let cap = scale.pick(16 * 1024, 64 * 1024);
    let paste = format!("{}PASTE-END", random_letters(&mut Rng::new(43), cap * 4));
    let mut built = scenario(
        "oversized_refused",
        3,
        vec![
            splice(1, MAIN, 0, &paste),
            Op::Sync { actor: 1 },
            splice(2, INTRO, 0, "meanwhile\n"),
            Op::Sync { actor: 2 },
            Op::Sync { actor: 1 },
            Op::SetCap(DEFAULT_CAP),
            Op::Sync { actor: 1 },
        ],
        vec![
            Check::Converged,
            Check::ReplayMatches,
            contains("main.tex", "PASTE-END"),
            markers(&["meanwhile"]),
        ],
    );
    built.cap = cap;
    built
}

fn kill(name: &str, cut: Cut, expected: &[&str]) -> Scenario {
    scenario(
        name,
        3,
        vec![
            Op::Persist { actor: 1 },
            splice(1, MAIN, 0, "acked\n"),
            Op::Sync { actor: 1 },
            splice(1, MAIN, 0, "unsent\n"),
            Op::Crash {
                actor: 1,
                cut,
                reuse_peer: false,
            },
            Op::Sync { actor: 1 },
        ],
        vec![Check::Converged, Check::ReplayMatches, markers(expected)],
    )
}

pub fn kill_before_save() -> Scenario {
    kill("kill_before_save", Cut::BeforeSave, &["acked"])
}

pub fn kill_mid_save(cut: Cut) -> Scenario {
    kill(&format!("kill_mid_save_{}", cut.slug()), cut, &["acked"])
}

pub fn kill_after_clean_save() -> Scenario {
    kill("kill_after_clean_save", Cut::Clean, &["acked", "unsent"])
}

pub fn kill_after_save_before_send() -> Scenario {
    scenario(
        "kill_after_save_before_send",
        3,
        vec![
            splice(1, MAIN, 0, "saved-not-sent\n"),
            Op::Persist { actor: 1 },
            Op::Crash {
                actor: 1,
                cut: Cut::BeforeSave,
                reuse_peer: false,
            },
            Op::Sync { actor: 1 },
        ],
        vec![
            Check::Converged,
            Check::ReplayMatches,
            markers(&["saved-not-sent"]),
        ],
    )
}

pub fn kill_after_send_before_receipt() -> Scenario {
    scenario(
        "kill_after_send_before_receipt",
        3,
        vec![
            splice(1, MAIN, 0, "sent-no-receipt\n"),
            Op::SendWithoutReceipt { actor: 1 },
            Op::Persist { actor: 1 },
            Op::Crash {
                actor: 1,
                cut: Cut::BeforeSave,
                reuse_peer: false,
            },
            Op::Sync { actor: 1 },
        ],
        vec![
            Check::Converged,
            Check::ReplayMatches,
            markers(&["sent-no-receipt"]),
        ],
    )
}

fn crash_then_offline_edit(name: &str, reuse_peer: bool) -> Scenario {
    scenario(
        name,
        3,
        vec![
            Op::Persist { actor: 1 },
            splice(1, MAIN, 0, "before crash\n"),
            Op::Sync { actor: 1 },
            Op::Crash {
                actor: 1,
                cut: Cut::BeforeSave,
                reuse_peer,
            },
            Op::Offline { actor: 1 },
            splice(1, INTRO, 0, "after crash\n"),
            Op::Online { actor: 1 },
            Op::Sync { actor: 1 },
        ],
        vec![
            Check::Converged,
            Check::ReplayMatches,
            markers(&["before crash", "after crash"]),
        ],
    )
}

pub fn fresh_peer_after_crash() -> Scenario {
    crash_then_offline_edit("fresh_peer_after_crash", false)
}

pub fn reused_peer_after_crash() -> Scenario {
    crash_then_offline_edit("reused_peer_after_crash", true)
}

pub fn surrogate_after_emoji() -> Scenario {
    let after = utf16_len(MAIN_PREFIX);
    scenario(
        "surrogate_after_emoji",
        3,
        vec![
            splice(1, MAIN, after, " edited"),
            splice(2, MAIN, after - 2, "Y"),
        ],
        vec![
            Check::Converged,
            Check::ReplayMatches,
            contains("main.tex", "Hello Y🌿 edited\n"),
        ],
    )
}

pub fn surrogate_mid_pair() -> Scenario {
    let inside = utf16_len(MAIN_PREFIX) - 1;
    scenario(
        "surrogate_mid_pair",
        3,
        vec![splice(1, MAIN, inside, "X"), Op::Sync { actor: 1 }],
        vec![
            Check::Converged,
            Check::ReplayMatches,
            contains("main.tex", "🌿"),
        ],
    )
}

pub fn corpus(scale: Scale, seed: u64) -> Vec<Scenario> {
    vec![
        concurrent_rename_rename(),
        rename_and_edit(),
        move_cycle(),
        move_and_trash(),
        trash_edit_restore(),
        trash_dir_with_edit_inside(),
        same_name_create(),
        case_only_create(),
        figure_collision(),
        ai_rewrite_burst(scale),
        offline_across_compaction(true),
        offline_across_compaction(false),
        late_join_after_compaction(),
        out_of_order_delivery(),
        malformed_random_bytes(),
        malformed_empty(),
        malformed_truncated(),
        corrupt_in_transit(),
        oversized_paste(scale),
        oversized_refused(scale),
        kill_before_save(),
        kill_mid_save(Cut::Empty),
        kill_mid_save(Cut::OneByte),
        kill_mid_save(Cut::Half),
        kill_mid_save(Cut::DropLastByte),
        kill_after_clean_save(),
        kill_after_save_before_send(),
        kill_after_send_before_receipt(),
        fresh_peer_after_crash(),
        reused_peer_after_crash(),
        surrogate_after_emoji(),
        surrogate_mid_pair(),
        trace::generate(TraceConfig::for_scale(scale), seed),
    ]
}
