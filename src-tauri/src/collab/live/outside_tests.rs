use std::collections::BTreeSet;
use std::path::Path;

use oleafly_collab::doc::{NodeKind, ProjectDoc};
use oleafly_collab::live::LiveProject;
use oleafly_collab::materialize;
use oleafly_collab::ot::{utf16_len, TextOperation};
use oleafly_collab_protocol::projects::ProjectRole;

use super::super::disk::{sha256_hex, DiskState};
use super::{apply_local_import, apply_to_disk, merged_onto, read_local_changes, WrittenTexts};

fn project_text(root: &Path, text: &str) -> (LiveProject, DiskState, String) {
    let mut doc = ProjectDoc::create().unwrap();
    let main = doc
        .add_node(None, "main.tex", NodeKind::Text, None, text)
        .unwrap();
    std::fs::write(root.join("main.tex"), text).unwrap();
    let layout = materialize::layout(&doc.nodes().unwrap());
    let hashes = [("main.tex".to_owned(), sha256_hex(text.as_bytes()))]
        .into_iter()
        .collect();
    (
        LiveProject::new(doc, 0, ProjectRole::Owner),
        DiskState { layout, hashes },
        main,
    )
}

fn import(root: &Path, live: &mut LiveProject, disk: &mut DiskState, bases: &mut WrittenTexts) {
    let found = read_local_changes(root, disk, live, None).unwrap();
    apply_local_import(live, disk, bases, found, root).unwrap();
}

fn write_back(root: &Path, live: &LiveProject, disk: &mut DiskState, bases: &mut WrittenTexts) {
    let next = materialize::layout(&live.doc().nodes().unwrap());
    let texts: Vec<(String, String)> = next
        .iter()
        .filter(|(_, placed)| placed.kind == NodeKind::Text)
        .map(|(id, placed)| (placed.path.clone(), live.doc().text(id).unwrap()))
        .collect();
    let crlf: BTreeSet<String> = next
        .iter()
        .filter(|(id, _)| live.doc().crlf(id))
        .map(|(_, placed)| placed.path.clone())
        .collect();
    let plan = materialize::plan(&disk.layout, &next);
    let pass = apply_to_disk(root, disk, bases, plan, next, &texts, &crlf, &|_| false).unwrap();
    assert!(pass.conflicts.is_empty(), "{:?}", pass.conflicts);
}

fn typed_before(live: &mut LiveProject, id: &str, anchor: &str, typed: &str) {
    let current = live.doc().text(id).unwrap();
    let at = current
        .find(anchor)
        .unwrap_or_else(|| panic!("{anchor:?} is gone from {current:?}"));
    let mut operation = TextOperation::new();
    operation
        .retain(utf16_len(&current[..at]))
        .insert(typed)
        .retain(utf16_len(&current[at..]));
    live.local_operation(id, &operation).unwrap();
}

fn file_id(live: &LiveProject, path: &str) -> String {
    materialize::layout(&live.doc().nodes().unwrap())
        .into_iter()
        .find(|(_, placed)| placed.path == path)
        .map(|(id, _)| id)
        .unwrap_or_else(|| panic!("{path} is not shared"))
}

fn saved_by_an_outside_editor(read: &str, round: usize) -> String {
    let mut saved = read
        .lines()
        .map(|line| {
            if line.starts_with("% outside save") {
                format!("% outside save {round}")
            } else {
                line.trim_end().to_owned()
            }
        })
        .collect::<Vec<_>>()
        .join("\n");
    saved.push('\n');
    saved
}

#[test]
fn an_outside_editor_saving_every_second_while_two_people_type_never_multiplies_the_file() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let start = "\\section{Discussion}   \n\
                 Discussion part 1 ends with spaces.  \n\
                 Alice writes here: \n\
                 Discussion part 3 is plain.\n\
                 Discussion part 4 has a tab.\t\n\
                 Carol writes ⟦C⟧ in the middle of this line.\n\
                 Discussion part 6 closes the section. \n\
                 % outside save 0\n";
    let (mut live, mut disk, main) = project_text(root, start);
    let mut bases = WrittenTexts::default();
    bases.record("main.tex", start);
    let rounds = 30;
    for round in 1..=rounds {
        let read = std::fs::read_to_string(root.join("main.tex")).unwrap();
        typed_before(
            &mut live,
            &main,
            "\nDiscussion part 3",
            &format!("⟦a{round}⟧ "),
        );
        typed_before(&mut live, &main, "⟦C⟧", &format!("⟦c{round}⟧ "));
        if round % 2 == 0 {
            write_back(root, &live, &mut disk, &mut bases);
            typed_before(
                &mut live,
                &main,
                "\nDiscussion part 3",
                &format!("⟦b{round}⟧ "),
            );
        }
        std::fs::write(
            root.join("main.tex"),
            saved_by_an_outside_editor(&read, round),
        )
        .unwrap();
        import(root, &mut live, &mut disk, &mut bases);
        write_back(root, &live, &mut disk, &mut bases);
    }
    let text = live.doc().text(&main).unwrap();
    for round in 1..=rounds {
        assert_eq!(text.matches(&format!("⟦a{round}⟧")).count(), 1, "{text}");
        assert_eq!(text.matches(&format!("⟦c{round}⟧")).count(), 1, "{text}");
        let typed_after_a_write = usize::from(round % 2 == 0);
        assert_eq!(
            text.matches(&format!("⟦b{round}⟧")).count(),
            typed_after_a_write,
            "{text}"
        );
    }
    assert_eq!(text.matches("% outside save").count(), 1, "{text}");
    assert!(
        text.ends_with(&format!("% outside save {rounds}\n")),
        "{text}"
    );
    assert_eq!(text.matches("Discussion part 4 has a tab.").count(), 1);
    assert!(!text.contains("tab.\t"), "{text}");
    assert_eq!(
        std::fs::read_to_string(root.join("main.tex")).unwrap(),
        text
    );
}

fn method(parts: usize) -> String {
    (1..=parts)
        .map(|part| format!("Method part {part}. The text about step {part} of the method.\n"))
        .collect()
}

#[test]
fn a_restore_while_two_people_type_reverts_the_sentence_and_keeps_both_typings() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let checkpoint = method(12);
    let edited = checkpoint.replace(
        "The text about step 4 of the method.",
        "Bob rewrote the sentence about step 4 completely.",
    );
    let (mut live, mut disk, main) = project_text(root, &edited);
    let mut bases = WrittenTexts::default();
    bases.record("main.tex", &edited);
    typed_before(
        &mut live,
        &main,
        "The text about step 1 ",
        "alice typed this. ",
    );
    typed_before(
        &mut live,
        &main,
        "The text about step 7 ",
        "carol typed this. ",
    );
    std::fs::write(root.join("main.tex"), &checkpoint).unwrap();
    import(root, &mut live, &mut disk, &mut bases);
    let expected = checkpoint
        .replace(
            "The text about step 1 ",
            "alice typed this. The text about step 1 ",
        )
        .replace(
            "The text about step 7 ",
            "carol typed this. The text about step 7 ",
        );
    assert_eq!(live.doc().text(&main).unwrap(), expected);
}

#[test]
fn the_same_edit_made_on_disk_and_in_the_document_lands_once() {
    let base = "alpha\nbeta\ngamma\n";
    let edited = "alpha\nBETA\ngamma\n";
    let with_more = "alpha\nBETA\ngamma\ndelta\n";
    let alone = merged_onto(base, edited, edited)
        .map(|operation| operation.apply(edited).unwrap())
        .unwrap_or_else(|| edited.to_owned());
    let with_typing = merged_onto(base, edited, with_more)
        .map(|operation| operation.apply(with_more).unwrap())
        .unwrap_or_else(|| edited.to_owned());
    assert_eq!(alone, edited);
    assert_eq!(with_typing, with_more);
}

#[test]
fn an_edit_already_in_the_document_from_an_outside_write_lands_once() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let base = "one\ntwo\nthree\n";
    let (mut live, mut disk, main) = project_text(root, base);
    let mut bases = WrittenTexts::default();
    bases.record("main.tex", base);
    live.local_text(&main, "one\nTWO REWRITTEN\nthree\nfour\n")
        .unwrap();
    std::fs::write(root.join("main.tex"), "one\nTWO REWRITTEN\nthree\n").unwrap();
    import(root, &mut live, &mut disk, &mut bases);
    assert_eq!(
        live.doc().text(&main).unwrap(),
        "one\nTWO REWRITTEN\nthree\nfour\n"
    );
}

struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }

    fn below(&mut self, bound: usize) -> usize {
        (self.next() % bound as u64) as usize
    }
}

const FLAVOURS: [&str; 5] = ["", "é", "😀", "ß", "中"];
const SEPARATORS: [&str; 3] = [" ", "\n", ", "];

#[test]
fn independent_random_edits_on_disk_and_in_the_document_never_duplicate_or_lose_text() {
    let mut rng = Rng(0x5eed_cafe_f00d_1234);
    for case in 0..300 {
        let count = 8 + rng.below(40);
        let tokens: Vec<String> = (0..count)
            .map(|index| {
                format!(
                    "t{index}{}{}",
                    FLAVOURS[rng.below(FLAVOURS.len())],
                    SEPARATORS[rng.below(SEPARATORS.len())]
                )
            })
            .collect();
        let mut disk = tokens.clone();
        let mut doc = tokens.clone();
        let mut expected = tokens.clone();
        for index in 0..count {
            let side = match index % 4 {
                0 => &mut disk,
                2 => &mut doc,
                _ => continue,
            };
            let mark = if index % 4 == 0 { "d" } else { "c" };
            let edited = match rng.below(5) {
                0 => continue,
                1 => String::new(),
                2 => format!("{mark}{case}x{index}{} ", FLAVOURS[rng.below(5)]),
                3 => format!("{mark}{case}i{index} {}", tokens[index]),
                _ => format!("t{mark}{case}w{}", &tokens[index][1..]),
            };
            side[index] = edited.clone();
            expected[index] = edited;
        }
        let (base, disk, doc, expected) = (
            tokens.concat(),
            disk.concat(),
            doc.concat(),
            expected.concat(),
        );
        let merged = match merged_onto(&base, &disk, &doc) {
            Some(operation) => operation.apply(&doc).unwrap(),
            None => disk.clone(),
        };
        assert_eq!(
            merged, expected,
            "case {case}\nbase {base:?}\ndisk {disk:?}\ndoc {doc:?}"
        );
    }
}

#[test]
fn putting_a_file_back_to_an_earlier_version_from_outside_reaches_the_document() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let first = "\\section{Results}\nVersion one of the results.\nClosing line.\n";
    let second = "\\section{Results}\nVersion two of the results, rewritten.\nClosing line.\n";
    let (mut live, mut disk, main) = project_text(root, first);
    let mut bases = WrittenTexts::default();
    bases.record("main.tex", first);
    live.local_text(&main, second).unwrap();
    write_back(root, &live, &mut disk, &mut bases);
    std::fs::write(root.join("main.tex"), first).unwrap();
    import(root, &mut live, &mut disk, &mut bases);
    assert_eq!(live.doc().text(&main).unwrap(), first);
}

#[test]
fn a_file_put_back_while_someone_types_elsewhere_keeps_the_typing() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let first = "\\section{Results}\nVersion one of the results.\nClosing line.\n";
    let second = "\\section{Results}\nVersion two of the results, rewritten.\nClosing line.\n";
    let (mut live, mut disk, main) = project_text(root, first);
    let mut bases = WrittenTexts::default();
    bases.record("main.tex", first);
    live.local_text(&main, second).unwrap();
    write_back(root, &live, &mut disk, &mut bases);
    typed_before(&mut live, &main, "Closing line.", "Typed meanwhile. ");
    std::fs::write(root.join("main.tex"), first).unwrap();
    import(root, &mut live, &mut disk, &mut bases);
    assert_eq!(
        live.doc().text(&main).unwrap(),
        "\\section{Results}\nVersion one of the results.\nTyped meanwhile. Closing line.\n"
    );
}

#[test]
fn a_crlf_file_keeps_crlf_on_this_disk_after_a_remote_edit() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let (mut live, mut disk, main) = project_text(root, "one\ntwo\n");
    std::fs::write(root.join("main.tex"), "one\r\ntwo\r\n").unwrap();
    disk.hashes
        .insert("main.tex".to_owned(), sha256_hex(b"one\r\ntwo\r\n"));
    let mut bases = WrittenTexts::default();
    bases.record("main.tex", "one\ntwo\n");
    live.local_text(&main, "one\ntwo\nthree\n").unwrap();
    write_back(root, &live, &mut disk, &mut bases);
    assert_eq!(
        std::fs::read(root.join("main.tex")).unwrap(),
        b"one\r\ntwo\r\nthree\r\n"
    );
    assert_eq!(live.doc().text(&main).unwrap(), "one\ntwo\nthree\n");
    assert!(read_local_changes(root, &disk, &live, None)
        .unwrap()
        .is_empty());
}

#[test]
fn an_lf_file_and_a_mixed_file_stay_as_they_are_after_a_remote_edit() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let (mut live, mut disk, main) = project_text(root, "one\ntwo\n");
    let mut bases = WrittenTexts::default();
    bases.record("main.tex", "one\ntwo\n");
    live.local_text(&main, "one\ntwo\nthree\n").unwrap();
    write_back(root, &live, &mut disk, &mut bases);
    assert_eq!(
        std::fs::read(root.join("main.tex")).unwrap(),
        b"one\ntwo\nthree\n"
    );
    std::fs::write(root.join("main.tex"), "one\r\ntwo\nthree\n").unwrap();
    import(root, &mut live, &mut disk, &mut bases);
    live.local_text(&main, "one\ntwo\nthree\nfour\n").unwrap();
    write_back(root, &live, &mut disk, &mut bases);
    assert_eq!(
        std::fs::read(root.join("main.tex")).unwrap(),
        b"one\ntwo\nthree\nfour\n"
    );
}

#[test]
fn a_crlf_file_added_by_one_person_reaches_another_disk_as_crlf_and_the_document_stays_lf() {
    let one = tempfile::tempdir().unwrap();
    let (mut live, mut disk, _) = project_text(one.path(), "plain\n");
    let mut bases = WrittenTexts::default();
    std::fs::write(one.path().join("win.tex"), "a\r\nb\r\n").unwrap();
    import(one.path(), &mut live, &mut disk, &mut bases);
    let win = file_id(&live, "win.tex");
    assert_eq!(live.doc().text(&win).unwrap(), "a\nb\n");

    let two = tempfile::tempdir().unwrap();
    let other = LiveProject::new(
        ProjectDoc::load(&live.doc().snapshot().unwrap()).unwrap(),
        0,
        ProjectRole::Editor,
    );
    write_back(
        two.path(),
        &other,
        &mut DiskState::default(),
        &mut WrittenTexts::default(),
    );
    assert_eq!(
        std::fs::read(two.path().join("win.tex")).unwrap(),
        b"a\r\nb\r\n"
    );
    assert_eq!(
        std::fs::read(two.path().join("main.tex")).unwrap(),
        b"plain\n"
    );
}

#[test]
fn a_crlf_file_changed_while_the_app_was_closed_merges_from_the_text_last_written() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let (mut live, mut disk, main) = project_text(root, "one\ntwo\n");
    disk.hashes
        .insert("main.tex".to_owned(), sha256_hex(b"one\r\ntwo\r\n"));
    std::fs::write(root.join("main.tex"), "one\r\nTWO\r\n").unwrap();
    let mut bases = super::initial_bases(root, &disk, &live);
    live.local_text(&main, "one\ntwo\nthree\n").unwrap();
    import(root, &mut live, &mut disk, &mut bases);
    assert_eq!(live.doc().text(&main).unwrap(), "one\nTWO\nthree\n");
}
