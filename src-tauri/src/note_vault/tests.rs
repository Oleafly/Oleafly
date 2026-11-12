use super::*;

fn import_vault(
    root: &Path,
    options: ImportOptions,
    cancel: &AtomicBool,
    progress: &mut dyn FnMut(ImportProgress),
) -> Result<ImportReport, String> {
    import_vault_with(
        root,
        options,
        cancel,
        progress,
        &disk_room,
        &CreatedNotes::default(),
    )
}

fn import_markdown_files(
    files: &[PathBuf],
    options: ImportOptions,
    cancel: &AtomicBool,
    progress: &mut dyn FnMut(ImportProgress),
) -> Result<ImportReport, String> {
    import_files_with(
        files,
        options,
        cancel,
        progress,
        &disk_room,
        &CreatedNotes::default(),
    )
}

fn file(rel: &str) -> VaultFile {
    VaultFile {
        rel: rel.to_string(),
        path: PathBuf::from(rel),
        size: 1,
    }
}

fn vault(notes: &[&str], files: &[&str]) -> Vault {
    Vault {
        notes: notes.iter().map(|rel| file(rel)).collect(),
        files: files.iter().map(|rel| file(rel)).collect(),
        ..Vault::default()
    }
}

fn note_index(lookups: &Lookups, raw: &str, dir: &str) -> Option<usize> {
    match lookups.resolve(raw, dir) {
        Some(Target::Note(index)) => Some(index),
        _ => None,
    }
}

fn file_index(lookups: &Lookups, raw: &str, dir: &str) -> Option<usize> {
    match lookups.resolve(raw, dir) {
        Some(Target::File(index)) => Some(index),
        _ => None,
    }
}

#[test]
fn resolves_names_the_way_obsidian_does() {
    let vault = vault(
        &[
            "Inbox.md",
            "Projects/Alpha.md",
            "Projects/Notes/Alpha.md",
            "Archive/Beta.md",
            "Daily/2024-01-01.md",
            "Daily/Beta.md",
        ],
        &[
            "attachments/Figure 1.png",
            "data/table.csv",
            "other/table.csv",
        ],
    );
    let lookups = Lookups::new(&vault);
    assert_eq!(note_index(&lookups, "Inbox", ""), Some(0));
    assert_eq!(note_index(&lookups, "inbox.MD", ""), Some(0));
    assert_eq!(note_index(&lookups, "projects/alpha", ""), Some(1));
    assert_eq!(note_index(&lookups, "Alpha", ""), None);
    assert_eq!(note_index(&lookups, "Alpha", "projects/notes"), Some(2));
    assert_eq!(note_index(&lookups, "Notes/Alpha", ""), Some(2));
    assert_eq!(note_index(&lookups, "Beta", ""), None);
    assert_eq!(note_index(&lookups, "Beta", "daily"), Some(5));
    assert_eq!(note_index(&lookups, "../Archive/Beta", "daily"), Some(3));
    assert_eq!(note_index(&lookups, "2024-01-01", ""), Some(4));
    assert_eq!(note_index(&lookups, "../../Inbox", ""), None);
    assert_eq!(note_index(&lookups, "   ", ""), None);
    assert_eq!(note_index(&lookups, "Missing", ""), None);
    assert_eq!(file_index(&lookups, "Figure 1.png", "daily"), Some(0));
    assert_eq!(
        file_index(&lookups, "attachments\\figure 1.PNG", ""),
        Some(0)
    );
    assert_eq!(file_index(&lookups, "table.csv", ""), None);
    assert_eq!(file_index(&lookups, "data/table.csv", ""), Some(1));
}

fn convert(text: &str, rel: &str, vault: &Vault) -> (String, usize) {
    let lookups = Lookups::new(vault);
    let ids: Vec<Option<String>> = (0..vault.notes.len())
        .map(|index| Some(format!("id-{index}")))
        .collect();
    let shared = ImportShared::default();
    let context = ImportContext {
        vault,
        lookups: &lookups,
        ids: &ids,
        shared: &shared,
    };
    let mut conversion = NoteConversion::new(&context, "self", rel);
    let body = conversion.body(text);
    (body, conversion.unresolved)
}

#[test]
fn converts_wikilinks_embeds_headings_and_block_refs() {
    let vault = vault(&["Alpha.md", "Sub/Beta.md"], &[]);
    let text = "See [[Alpha]], [[Alpha|the alpha]], [[Beta#Methods and *Data*]], [[Beta#^abc123]] and [[Beta#^abc|ref]].\n![[Alpha]] ![[Beta#Results]] [[#Local heading]] [[Alpha.md]]\n";
    let (body, unresolved) = convert(text, "Inbox.md", &vault);
    assert_eq!(
        body,
        "See [Alpha](oleafly://note/id-0), [the alpha](oleafly://note/id-0), [Beta > Methods and *Data*](oleafly://note/id-1#methods-and-data), [Beta > ^abc123](oleafly://note/id-1#^abc123) and [ref](oleafly://note/id-1#^abc).\n![Alpha](oleafly://note/id-0) ![Beta > Results](oleafly://note/id-1#results) [Local heading](oleafly://note/self#local-heading) [Alpha](oleafly://note/id-0)\n"
    );
    assert_eq!(unresolved, 0);
}

#[test]
fn leaves_unresolved_links_and_code_alone() {
    let vault = vault(&["Alpha.md"], &[]);
    let text = "[[Missing]] and ![[Gone.png]] and [x](Nope.md)\n`[[Alpha]]` ``[[Alpha]]``\n```\n[[Alpha]]\n```\n~~~~md\n[[Alpha]]\n~~~~\n\\[[Alpha]] [[]] [[#^block]] [web](https://example.org/a.md) [top](#heading)\n| a | [[Alpha\\|alias]] |\n";
    let (body, unresolved) = convert(text, "Inbox.md", &vault);
    assert_eq!(
        body,
        "[[Missing]] and ![[Gone.png]] and [x](Nope.md)\n`[[Alpha]]` ``[[Alpha]]``\n```\n[[Alpha]]\n```\n~~~~md\n[[Alpha]]\n~~~~\n\\[[Alpha]] [[]] [\\^block](oleafly://note/self#^block) [web](https://example.org/a.md) [top](#heading)\n| a | [alias](oleafly://note/id-0) |\n"
    );
    assert_eq!(unresolved, 3);
}

#[test]
fn converts_relative_markdown_links_to_notes() {
    let vault = vault(&["Notes/Alpha Beta.md", "Gamma.md"], &[]);
    let text = "[ab](Alpha%20Beta.md#Some%20Heading) [g](../Gamma.md) [block](<Alpha Beta.md#^x>) ![embed](Gamma.md)";
    let (body, unresolved) = convert(text, "Notes/Inbox.md", &vault);
    assert_eq!(
        body,
        "[ab](oleafly://note/id-0#some-heading) [g](oleafly://note/id-1) [block](oleafly://note/id-0#^x) ![embed](oleafly://note/id-1)"
    );
    assert_eq!(unresolved, 0);
}

fn write(root: &Path, rel: &str, bytes: &[u8]) {
    let path = root.join(rel);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, bytes).unwrap();
}

#[test]
fn plans_attachment_paths_with_content_hashes() {
    let root = tempfile::tempdir().unwrap();
    write(root.path(), "img/Fig 1.png", b"png-bytes");
    write(root.path(), "copy/Fig 1.png", b"png-bytes");
    write(root.path(), "data.csv", b"a,b\n");
    write(root.path(), "run.ipynb", b"{}");
    write(root.path(), "doc.pdf", b"%PDF");
    let cancel = AtomicBool::new(false);
    let scanned = scan_vault(root.path(), &cancel).unwrap().unwrap();
    let sha = crate::project::file_sha256(&root.path().join("img/Fig 1.png")).unwrap();
    let hash = &sha[..8];
    let text = "![[Fig 1.png|300]] ![[img/Fig 1.png|A figure]] ![](copy/Fig%201.png) [[data.csv]]\n![[run.ipynb]]\n![[doc.pdf]] [paper](doc.pdf)\n";
    let (body, unresolved) = convert(text, "Inbox.md", &scanned);
    assert_eq!(unresolved, 1);
    let lookups = Lookups::new(&scanned);
    let ids: Vec<Option<String>> = Vec::new();
    let shared = ImportShared::default();
    let context = ImportContext {
        vault: &scanned,
        lookups: &lookups,
        ids: &ids,
        shared: &shared,
    };
    let mut conversion = NoteConversion::new(&context, "self", "Inbox.md");
    let converted = conversion.body("![[img/Fig 1.png]] ![](copy/Fig%201.png) [d](data.csv)");
    assert_eq!(
        converted,
        format!("![Fig 1.png](assets/Fig-1-{hash}.png) ![](assets/Fig-1-{hash}.png) [d](assets/data-{}.csv)", &crate::project::file_sha256(&root.path().join("data.csv")).unwrap()[..8])
    );
    assert_eq!(conversion.assets.copies.len(), 2);
    assert!(body.starts_with("![[Fig 1.png|300]] "), "{body}");
    assert!(
        body.contains(&format!("![A figure](assets/Fig-1-{hash}.png)")),
        "{body}"
    );
    assert!(body.contains("```notebook\nassets/run-"), "{body}");
    assert!(body.contains("[doc.pdf](assets/doc-"), "{body}");
    assert!(body.contains("[paper](assets/doc-"), "{body}");
}

#[test]
fn resolves_links_whatever_the_unicode_form_or_case() {
    let composed = vault(
        &["Caf\u{e9}.md", "Notes/R\u{e9}sum\u{e9}.md"],
        &["img/\u{c9}t\u{e9}.png"],
    );
    let lookups = Lookups::new(&composed);
    assert_eq!(note_index(&lookups, "Cafe\u{301}", ""), Some(0));
    assert_eq!(note_index(&lookups, "CAF\u{c9}", ""), Some(0));
    assert_eq!(note_index(&lookups, "Re\u{301}sume\u{301}", ""), Some(1));
    assert_eq!(file_index(&lookups, "E\u{301}te\u{301}.PNG", ""), Some(0));
    let decomposed = vault(&["Notes/Cafe\u{301}.md"], &[]);
    let lookups = Lookups::new(&decomposed);
    assert_eq!(note_index(&lookups, "Caf\u{e9}", "notes"), Some(0));
}

#[test]
fn reuses_one_attachment_for_names_that_differ_only_in_case() {
    let root = tempfile::tempdir().unwrap();
    write(root.path(), "a/Fig.png", b"same");
    write(root.path(), "b/fig.png", b"same");
    let scanned = scan_vault(root.path(), &AtomicBool::new(false))
        .unwrap()
        .unwrap();
    let lookups = Lookups::new(&scanned);
    let ids: Vec<Option<String>> = Vec::new();
    let shared = ImportShared::default();
    let context = ImportContext {
        vault: &scanned,
        lookups: &lookups,
        ids: &ids,
        shared: &shared,
    };
    let mut conversion = NoteConversion::new(&context, "one", "One.md");
    let body = conversion.body("![](a/Fig.png) ![](b/fig.png)");
    let hash = &crate::project::file_sha256(&root.path().join("a/Fig.png")).unwrap()[..8];
    assert_eq!(
        body,
        format!("![](assets/Fig-{hash}.png) ![](assets/Fig-{hash}.png)")
    );
    assert_eq!(conversion.assets.copies.len(), 1);
}

#[test]
fn imports_cloud_placeholders_but_not_links_or_other_reparse_points() {
    use crate::paths::{classify_reparse_tag, ReparseClass};
    assert!(reparse_allows_import(Ok(ReparseClass::None)));
    assert!(reparse_allows_import(Ok(classify_reparse_tag(
        0x400,
        0x9000_601A
    ))));
    assert!(reparse_allows_import(Ok(classify_reparse_tag(
        0x400,
        0x8000_0021
    ))));
    assert!(!reparse_allows_import(Ok(classify_reparse_tag(
        0x400,
        0xA000_000C
    ))));
    assert!(!reparse_allows_import(Ok(classify_reparse_tag(
        0x400,
        0x8000_0017
    ))));
    assert!(!reparse_allows_import(Err(std::io::Error::other("gone"))));
}

#[cfg(unix)]
#[test]
fn counts_folders_it_cannot_read_as_skipped() {
    use std::os::unix::fs::PermissionsExt;
    let root = tempfile::tempdir().unwrap();
    write(root.path(), "Keep.md", b"# Keep\n");
    write(root.path(), "Locked/Inside.md", b"# Inside\n");
    let locked = root.path().join("Locked");
    std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o000)).unwrap();
    let readable = std::fs::read_dir(&locked).is_ok();
    let scanned = scan_vault(root.path(), &AtomicBool::new(false));
    std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o755)).unwrap();
    if readable {
        return;
    }
    let scanned = scanned.unwrap().unwrap();
    assert_eq!(scanned.notes.len(), 1);
    assert_eq!(scanned.skipped, 1);
}

#[test]
fn notes_share_one_hash_per_file_and_one_attachment_budget() {
    let root = tempfile::tempdir().unwrap();
    write(root.path(), "a.png", b"aaaaaa");
    write(root.path(), "b.png", b"bbbbbb");
    let cancel = AtomicBool::new(false);
    let scanned = scan_vault(root.path(), &cancel).unwrap().unwrap();
    let lookups = Lookups::new(&scanned);
    let ids: Vec<Option<String>> = Vec::new();
    let shared = ImportShared::with_budget(10);
    let context = ImportContext {
        vault: &scanned,
        lookups: &lookups,
        ids: &ids,
        shared: &shared,
    };
    let mut first = NoteConversion::new(&context, "one", "One.md");
    let one = first.body("![](a.png) ![](a.png)");
    assert_eq!(first.assets.copies.len(), 1);
    assert_eq!(shared.planned.get(), 6);
    std::fs::remove_file(root.path().join("a.png")).unwrap();
    let mut second = NoteConversion::new(&context, "two", "Two.md");
    let two = second.body("![](a.png) ![](b.png)");
    assert!(one.contains("](assets/a-"), "{one}");
    assert!(two.contains("](assets/a-"), "{two}");
    assert!(!two.contains("](assets/b-"), "{two}");
    assert_eq!(second.assets.copies.len(), 1);
    assert_eq!(second.assets.skipped, 1);
    assert_eq!(shared.planned.get(), 6);
    assert_eq!(shared.hashes.borrow().len(), 2);
    let roomy = ImportShared::with_budget(12);
    let context = ImportContext {
        shared: &roomy,
        ..context
    };
    let mut third = NoteConversion::new(&context, "three", "Three.md");
    third.body("![](b.png)");
    assert_eq!(third.assets.copies.len(), 1);
    assert_eq!(roomy.planned.get(), 6);
    assert_eq!(ImportShared::default().budget, MAX_IMPORT_ATTACHMENT_BYTES);
}

#[test]
fn a_file_linked_from_many_notes_is_charged_to_the_budget_once() {
    let root = tempfile::tempdir().unwrap();
    write(root.path(), "logo.png", b"123456");
    write(root.path(), "zz/late.png", b"1");
    let scanned = scan_vault(root.path(), &AtomicBool::new(false))
        .unwrap()
        .unwrap();
    let lookups = Lookups::new(&scanned);
    let ids: Vec<Option<String>> = Vec::new();
    let shared = ImportShared::with_budget(10);
    let context = ImportContext {
        vault: &scanned,
        lookups: &lookups,
        ids: &ids,
        shared: &shared,
    };
    for index in 0..20 {
        let mut note = NoteConversion::new(&context, "n", &format!("Note {index}.md"));
        assert!(note.body("![](logo.png)").contains("](assets/logo-"));
        assert_eq!(note.assets.copies.len(), 1);
    }
    let mut last = NoteConversion::new(&context, "z", "Last.md");
    assert!(last.body("![](zz/late.png)").contains("](assets/late-"));
    assert_eq!(last.assets.skipped, 0);
    assert_eq!(shared.planned.get(), 7);
}

#[test]
fn unwraps_emphasis_that_starts_with_a_letter_outside_ascii() {
    assert_eq!(
        note_title(None, "# *Über* die Theorie\n", "x.md"),
        "Über die Theorie"
    );
    assert_eq!(
        note_title(None, "# **日本** の研究\n", "x.md"),
        "日本 の研究"
    );
    assert_eq!(heading_slug(&plain_heading("_β_ test")), "β-test");
    let vault = vault(&["Note.md"], &[]);
    let (body, _) = convert("[[Note#_é_ tude]]", "Inbox.md", &vault);
    assert_eq!(body, "[Note > _é_ tude](oleafly://note/id-0#%C3%A9-tude)");
}

#[test]
fn refuses_an_import_that_would_leave_too_little_free_space() {
    let mib = 1024 * 1024;
    let gib = 1024 * mib;
    assert!(room_for(gib, 4 * gib).is_ok());
    assert!(room_for(3 * gib, 4 * gib).is_ok());
    assert!(room_for(5 * mib, gib).is_ok());
    assert!(room_for(5 * mib, 300 * mib).is_ok());
    let tight = crate::app_error::english(&room_for(4 * gib, 4 * gib).unwrap_err()).unwrap();
    assert!(tight.contains("needs about 4.6 GB."), "{tight}");
    assert!(room_for(5 * gib, 4 * gib).is_err());
    assert!(room_for(0, 200 * mib).is_err());
    assert!(room_for(u64::MAX, u64::MAX - 1).is_err());
}

#[test]
fn a_folder_with_too_many_entries_is_refused_before_anything_is_imported() {
    let vault = tempfile::tempdir().unwrap();
    for name in ["a.md", "b.md", "c.png", "d/e.md"] {
        write(vault.path(), name, b"x");
    }
    let cancel = AtomicBool::new(false);
    let scanned = scan_vault_within(vault.path(), &cancel, 5)
        .unwrap()
        .unwrap();
    assert_eq!(scanned.notes.len(), 3);
    assert_eq!(scanned.skipped, 0);
    let refused = scan_vault_within(vault.path(), &cancel, 4).unwrap_err();
    assert_eq!(
        crate::app_error::english(&refused).unwrap(),
        "This folder has too many files to import. Choose a smaller folder."
    );
}

#[test]
fn imported_titles_are_stored_composed() {
    assert_eq!(note_title(None, "", "dir/E\u{301}cole.md"), "\u{c9}cole");
    assert_eq!(
        note_title(None, "# Re\u{301}sume\u{301}\n", "x.md"),
        "R\u{e9}sum\u{e9}"
    );
    let front = ["title: Cafe\u{301}"];
    assert_eq!(note_title(Some(&front), "", "x.md"), "Caf\u{e9}");
}

#[test]
fn fences_inside_nested_lists_keep_their_links() {
    let body = "- item\n  - nested\n    ```\n    [[Kept]]\n    ```\n[[Out]]";
    let kinds: Vec<bool> = blocks(body)
        .iter()
        .map(|block| matches!(block, Block::Fence { .. }))
        .collect();
    assert_eq!(kinds, vec![false, false, true, false]);
}

#[test]
fn retargets_only_the_links_that_point_at_a_moved_asset() {
    let source = "---\nkind: note\nid: n\n---\n![a](assets/x-1.png) `assets/x-1.png` [b](assets/x-1.png.bak)\nassets/x-1.png [c](assets/x-1.png)\n```notebook\n  assets/x-1.png\n```\n```\n[d](assets/x-1.png)\n```";
    let moved = vec![("assets/x-1.png".to_string(), "assets/x-1-2.png".to_string())];
    assert_eq!(
        retarget_assets(source, &moved),
        "---\nkind: note\nid: n\n---\n![a](assets/x-1-2.png) `assets/x-1.png` [b](assets/x-1.png.bak)\nassets/x-1.png [c](assets/x-1-2.png)\n```notebook\n  assets/x-1-2.png\n```\n```\n[d](assets/x-1.png)\n```"
    );
    assert_eq!(retarget_assets("plain", &moved), "plain");
}

#[test]
fn every_line_of_an_imported_note_is_searchable() {
    let _env_guard = crate::paths::data_dir_env_lock();
    let data = tempfile::tempdir().unwrap();
    std::env::set_var("OLEAFLY_DATA_DIR", data.path());
    let vault = tempfile::tempdir().unwrap();
    let mut text = "word ".repeat(3 * 1024 * 1024 / 5);
    text.push_str("\n#late\n");
    assert!(text.len() as u64 <= MAX_NOTE_BYTES);
    write(vault.path(), "Big.md", text.as_bytes());
    let report = import_vault(
        vault.path(),
        ImportOptions::default(),
        &AtomicBool::new(false),
        &mut |_| {},
    )
    .unwrap();
    assert_eq!(report.summary.notes, 1);
    let tags = crate::note_search::note_tags_blocking().unwrap();
    assert!(tags.iter().any(|tag| tag.tag == "late"), "{tags:?}");
    std::env::remove_var("OLEAFLY_DATA_DIR");
}

#[test]
fn a_folder_import_reports_an_attachment_it_could_not_copy() {
    let _env_guard = crate::paths::data_dir_env_lock();
    let data = tempfile::tempdir().unwrap();
    std::env::set_var("OLEAFLY_DATA_DIR", data.path());
    let vault = tempfile::tempdir().unwrap();
    write(vault.path(), "One.md", b"# One\n![[pic.png]]\n");
    write(vault.path(), "img/pic.png", b"0123456789");
    let picture = vault.path().join("img/pic.png");
    let report = import_vault_with(
        vault.path(),
        ImportOptions::default(),
        &AtomicBool::new(false),
        &mut |_| {},
        &|_| {
            std::fs::remove_file(&picture).unwrap();
            Ok(())
        },
        &CreatedNotes::default(),
    )
    .unwrap();
    assert_eq!(report.summary.notes, 1);
    assert_eq!(report.summary.attachments, 0);
    assert_eq!(report.summary.not_copied, vec!["img/pic.png".to_string()]);
    std::env::remove_var("OLEAFLY_DATA_DIR");
}

#[test]
fn checks_free_space_for_every_note_and_attachment_before_writing() {
    let _env_guard = crate::paths::data_dir_env_lock();
    let data = tempfile::tempdir().unwrap();
    std::env::set_var("OLEAFLY_DATA_DIR", data.path());
    let vault = tempfile::tempdir().unwrap();
    write(vault.path(), "One.md", b"# One\n![[pic.png]]\n");
    write(vault.path(), "Two.md", b"# Two\n![[pic.png]]\n");
    write(vault.path(), "pic.png", b"0123456789");
    let asked = std::cell::Cell::new(0u64);
    let refused = import_vault_with(
        vault.path(),
        ImportOptions::default(),
        &AtomicBool::new(false),
        &mut |_| {},
        &|needed| {
            asked.set(needed);
            Err("full".into())
        },
        &CreatedNotes::default(),
    );
    assert_eq!(refused.unwrap_err(), "full");
    assert!(asked.get() > 20, "{}", asked.get());
    assert!(crate::project::list_projects_blocking()
        .unwrap_or_default()
        .is_empty());
    let report = import_vault_with(
        vault.path(),
        ImportOptions::default(),
        &AtomicBool::new(false),
        &mut |_| {},
        &|_| Ok(()),
        &CreatedNotes::default(),
    )
    .unwrap();
    assert_eq!(report.summary.notes, 2);
    assert_eq!(report.summary.attachments, 2);
    std::env::remove_var("OLEAFLY_DATA_DIR");
}

#[test]
fn skips_hidden_folders_large_notes_and_links() {
    let root = tempfile::tempdir().unwrap();
    write(root.path(), "Keep.md", b"# Keep\n");
    write(root.path(), ".obsidian/workspace.md", b"x");
    write(root.path(), ".trash/Old.md", b"x");
    write(root.path(), "Sub/.hidden/Secret.md", b"x");
    write(root.path(), "Sub/.dot.md", b"x");
    write(
        root.path(),
        "Big.md",
        &vec![b'a'; (MAX_NOTE_BYTES + 1) as usize],
    );
    write(root.path(), "Sub/Note.MD", b"text");
    #[cfg(unix)]
    std::os::unix::fs::symlink(root.path().join("Keep.md"), root.path().join("Link.md")).unwrap();
    let cancel = AtomicBool::new(false);
    let scanned = scan_vault(root.path(), &cancel).unwrap().unwrap();
    let notes: Vec<&str> = scanned.notes.iter().map(|file| file.rel.as_str()).collect();
    assert_eq!(notes, vec!["Keep.md", "Sub/Note.MD"]);
    assert_eq!(scanned.skipped, 1);
    cancel.store(true, Ordering::SeqCst);
    assert!(scan_vault(root.path(), &cancel).unwrap().is_none());
    assert!(scan_vault(&root.path().join("missing"), &AtomicBool::new(false)).is_err());
}

#[test]
fn reads_titles_and_keeps_the_original_front_matter() {
    let text =
        "---\ntitle: \"Deep: learning\"\ntags: [ml]\nid: zettel-42\nkind: page\n---\n# Heading\n";
    let split = split_front_matter(text);
    let front = split.lines.as_deref();
    assert_eq!(note_title(front, split.body, "x/File.md"), "Deep: learning");
    let source = imported_source(front, "Deep: learning", "new-id", Some("x"), split.body);
    assert_eq!(
        source,
        "---\ntitle: \"Deep: learning\"\ntags: [ml, x]\nimported-id: zettel-42\nkind: note\nid: new-id\n---\n# Heading\n"
    );
    let plain = "Intro\n\n# **First** title #\n";
    assert_eq!(note_title(None, plain, "Folder/Name.md"), "First title");
    assert_eq!(
        imported_source(None, "First title", "n", None, plain),
        "---\ntitle: First title\nkind: note\nid: n\n---\n\nIntro\n\n# **First** title #\n"
    );
    assert_eq!(
        note_title(None, "## Only h2\n```\n# code\n```\n", "Folder/Name.md"),
        "Name"
    );
    assert_eq!(note_title(Some(&["title: ''"]), "", "A.md"), "A");
    assert_eq!(note_title(Some(&["title: 'It''s'"]), "", "A.md"), "It's");
    assert_eq!(note_title(None, "", " .md"), UNTITLED);
    let empty_title = imported_source(Some(&["title:", "aliases:", "  - x"]), "T", "n", None, "");
    assert_eq!(
        empty_title,
        "---\naliases:\n  - x\ntitle: T\nkind: note\nid: n\n---\n"
    );
    let oleafly = imported_source(Some(&["kind: note", "id: old"]), "T", "n", None, "\nBody");
    assert_eq!(oleafly, "---\ntitle: T\nkind: note\nid: n\n---\n\nBody");
}

#[test]
fn keeps_a_long_title_whole_in_the_front_matter() {
    let heading = format!("{} {}", "A".repeat(150), "B".repeat(80));
    let body = format!("# {heading}\n\nText\n");
    let name = note_title(None, &body, "Long.md");
    assert_eq!(name.chars().count(), MAX_TITLE_CHARS);
    assert_eq!(full_note_title(None, &body, "Long.md"), heading);
    assert_eq!(full_note_title(None, "", " .md"), UNTITLED);
    let source = imported_source(
        None,
        &full_note_title(None, &body, "Long.md"),
        "n",
        None,
        &body,
    );
    assert!(source.starts_with(&format!("---\ntitle: {heading}\n")));
}

#[test]
fn adds_folder_tags_to_every_tags_shape() {
    let tag = |lines: &[&str]| {
        let mut lines: Vec<String> = lines.iter().map(|line| line.to_string()).collect();
        add_tag(&mut lines, "lab/2024");
        lines
    };
    assert_eq!(tag(&[]), vec!["tags:", "  - lab/2024"]);
    assert_eq!(
        tag(&["tags:", "- a", "- b", "next: 1"]),
        vec!["tags:", "- a", "- b", "- lab/2024", "next: 1"]
    );
    assert_eq!(
        tag(&["tags:", "    - Lab/2024"]),
        vec!["tags:", "    - Lab/2024"]
    );
    assert_eq!(tag(&["tags:"]), vec!["tags:", "  - lab/2024"]);
    assert_eq!(tag(&["tags: []"]), vec!["tags: [lab/2024]"]);
    assert_eq!(
        tag(&["tags: [a, \"#lab/2024\"]"]),
        vec!["tags: [a, \"#lab/2024\"]"]
    );
    assert_eq!(tag(&["tags: a, b"]), vec!["tags: a, b, lab/2024"]);
    assert_eq!(tag(&["tags: a b"]), vec!["tags: a b lab/2024"]);
    assert_eq!(tag(&["tags: \"a\""]), vec!["tags: a lab/2024"]);
    assert_eq!(tag(&["tags: lab/2024"]), vec!["tags: lab/2024"]);
    assert_eq!(
        folder_tag("Lab notes/2024 Q1/Run.md").as_deref(),
        Some("Lab-notes/2024-Q1")
    );
    assert_eq!(folder_tag("2024/11/Run.md").as_deref(), Some("2024/11"));
    assert_eq!(folder_tag("Run.md"), None);
    assert_eq!(folder_tag("123/Run.md"), None);
    assert_eq!(folder_tag("!!!/Run.md"), None);
}

#[test]
fn slugs_headings_like_github() {
    assert_eq!(heading_slug("Methods and Data"), "methods-and-data");
    assert_eq!(heading_slug("Über: Größe?"), "über-größe");
    assert_eq!(heading_slug("snake_case-name"), "snake_case-name");
    let body = "# Intro\n## Intro\n### Intro\n```\n# Not a heading\n```\n#Nope\n## [Linked](x) `code` _em_ ~~gone~~ ==mark== [[Note|alias]] ##\n####### seven\n";
    assert_eq!(
        headings(body),
        vec![
            ("intro".to_string(), "Intro".to_string()),
            ("intro-1".to_string(), "Intro".to_string()),
            ("intro-2".to_string(), "Intro".to_string()),
            (
                "linked-code-em-gone-mark-alias".to_string(),
                "Linked code em gone mark alias".to_string()
            ),
        ]
    );
    assert_eq!(
        plain_heading("a \\* b ![img](x.png) snake_case"),
        "a * b img snake_case"
    );
}

#[test]
fn makes_safe_unique_file_names() {
    assert_eq!(
        safe_stem("A/B: testing? <draft> #1 [x]|y^"),
        "A B testing draft 1 x y"
    );
    assert_eq!(safe_stem("..hidden."), "hidden");
    assert_eq!(safe_stem("  "), UNTITLED);
    assert_eq!(safe_stem("con"), "con note");
    assert_eq!(safe_stem("con.backup"), "con note.backup");
    assert_eq!(safe_stem("Con. Lecture"), "Con note. Lecture");
    assert_eq!(safe_stem("aux.final"), "aux note.final");
    assert_eq!(safe_stem("COM\u{b9}"), "COM\u{b9} note");
    assert_eq!(safe_stem("lpt9"), "lpt9 note");
    assert_eq!(safe_stem("console"), "console");
    assert_eq!(safe_stem("com10"), "com10");
    assert_eq!(safe_stem("a\u{ad}b\u{200b}c\u{202e}d"), "abcd");
    assert_eq!(safe_stem("Cafe\u{301}"), "Caf\u{e9}");
    assert_eq!(safe_file_name("con.png"), "con note.png");
    assert_eq!(safe_stem(&"x".repeat(300)).len(), MAX_STEM_BYTES);
    let wide = safe_stem(&"研究".repeat(150));
    assert!(wide.len() <= MAX_STEM_BYTES, "{}", wide.len());
    assert_eq!(wide, "研究".repeat(33));
    assert!(
        format!(
            "{} 999.md",
            safe_file_name(&format!("{}.png", "😀a".repeat(100)))
        )
        .len()
            < 255
    );
    assert_eq!(safe_file_name("dir/Fig: 1.PNG"), "Fig 1.png");
    assert_eq!(safe_file_name("README"), "README");
    assert_eq!(numbered("Fig.png", 2), "Fig 2.png");
    assert_eq!(numbered("Notes", 3), "Notes 3");
}

fn export_note(id: &str, title: &str, text: &str, assets: Vec<ExportAsset>) -> ExportNote {
    ExportNote {
        note_id: Some(id.to_string()),
        title: title.to_string(),
        text: text.to_string(),
        assets,
    }
}

#[test]
fn exports_links_back_to_wikilinks() {
    let folder = tempfile::tempdir().unwrap();
    let assets_dir = tempfile::tempdir().unwrap();
    write(assets_dir.path(), "fig-1a2b3c4d.png", b"png");
    write(assets_dir.path(), "other-1a2b3c4d.png", b"other");
    write(assets_dir.path(), "run-00000000.ipynb", b"{}");
    let asset = |rel: &str, file: &str, original: Option<&str>| ExportAsset {
        rel: rel.to_string(),
        path: assets_dir.path().join(file),
        original: original.map(str::to_string),
    };
    let alpha = export_note(
        "a",
        "Alpha: one",
        "---\ntitle: \"Alpha: one\"\nkind: note\nid: a\ncolor: mint\n---\n# Alpha\n[Beta](oleafly://note/b) [the beta](oleafly://note/b) [Beta > Methods](oleafly://note/b#methods) [x](oleafly://note/b#unknown-slug) ![Beta](oleafly://note/b#results-1)\n![Fig](assets/fig-1a2b3c4d.png) ![fig.png](assets/fig-1a2b3c4d.png) [data](./assets/missing.csv) [Gone](oleafly://note/zzz) [[Kept]] [p](oleafly://project/p)\n| t | [alias](oleafly://note/b) |\n```notebook\nassets/run-00000000.ipynb\n```\n```notebook\nassets/run-00000000.ipynb\ncells: 1-2\n```\n`[c](oleafly://note/b)`\n",
        vec![
            asset("assets/fig-1a2b3c4d.png", "fig-1a2b3c4d.png", Some("fig.png")),
            asset("assets/run-00000000.ipynb", "run-00000000.ipynb", None),
        ],
    );
    let beta = export_note(
        "b",
        "Beta",
        "---\nkind: note\nid: b\n---\n## Methods\n## Results\n## Results\n![Other](assets/other-1a2b3c4d.png)\n",
        vec![asset("assets/other-1a2b3c4d.png", "other-1a2b3c4d.png", Some("fig.png"))],
    );
    let twin = export_note("c", "Beta", "Twin", Vec::new());
    let summary = export_notes(&[alpha, beta, twin], &HashMap::new(), folder.path()).unwrap();
    assert_eq!(summary.notes, 3);
    assert_eq!(summary.attachments, 3);
    assert_eq!(summary.paper_links, ["p"]);
    let alpha = std::fs::read_to_string(folder.path().join("Alpha one.md")).unwrap();
    assert_eq!(
        alpha,
        "---\ntitle: \"Alpha: one\"\ncolor: mint\n---\n# Alpha\n[[Beta]] [[Beta|the beta]] [[Beta#Methods]] [[Beta#unknown-slug|x]] ![[Beta#Results]]\n![[fig.png|Fig]] ![[fig.png]] [data](./assets/missing.csv) [Gone](oleafly://note/zzz) [[Kept]] p\n| t | [[Beta\\|alias]] |\n![[run-00000000.ipynb]]\n```notebook\nattachments/run-00000000.ipynb\ncells: 1-2\n```\n`[c](oleafly://note/b)`\n"
    );
    let beta = std::fs::read_to_string(folder.path().join("Beta.md")).unwrap();
    assert_eq!(
        beta,
        "## Methods\n## Results\n## Results\n![[fig 2.png|Other]]\n"
    );
    assert_eq!(
        std::fs::read_to_string(folder.path().join("Beta 2.md")).unwrap(),
        "Twin"
    );
    assert_eq!(
        std::fs::read(folder.path().join("attachments/fig.png")).unwrap(),
        b"png"
    );
    assert_eq!(
        std::fs::read(folder.path().join("attachments/fig 2.png")).unwrap(),
        b"other"
    );
}

#[test]
fn exports_block_links_as_wikilinks_and_keeps_block_ids() {
    let folder = tempfile::tempdir().unwrap();
    let alpha = export_note(
        "a",
        "Alpha",
        "---\nkind: note\nid: a\n---\nSee [Beta > Accuracy rose](oleafly://note/b#^acc), [ref](oleafly://note/b#%5Eacc), [x](oleafly://note/b#results) ![Beta](oleafly://note/b#^tbl)\n",
        Vec::new(),
    );
    let beta_text = "## Results ^res\nAccuracy rose ^acc\n\n| a |\n| --- |\n\n^tbl\n";
    let beta = export_note(
        "b",
        "Beta",
        &format!("---\nkind: note\nid: b\n---\n{beta_text}"),
        Vec::new(),
    );
    export_notes(&[alpha, beta], &HashMap::new(), folder.path()).unwrap();
    assert_eq!(
        std::fs::read_to_string(folder.path().join("Alpha.md")).unwrap(),
        "See [[Beta#^acc|Beta > Accuracy rose]], [[Beta#^acc|ref]], [[Beta#Results|x]] ![[Beta#^tbl]]\n"
    );
    assert_eq!(
        std::fs::read_to_string(folder.path().join("Beta.md")).unwrap(),
        beta_text
    );
}

#[test]
fn exports_only_the_attachments_a_note_links_to() {
    let folder = tempfile::tempdir().unwrap();
    let assets_dir = tempfile::tempdir().unwrap();
    for name in ["used.png", "deleted.png", "run.ipynb"] {
        write(assets_dir.path(), name, name.as_bytes());
    }
    let asset = |name: &str| ExportAsset {
        rel: format!("assets/{name}"),
        path: assets_dir.path().join(name),
        original: None,
    };
    let note = export_note(
        "a",
        "Alpha",
        "![u](assets/used.png)\n```notebook\nassets/run.ipynb\n```\n`![d](assets/deleted.png)`\n",
        vec![asset("used.png"), asset("deleted.png"), asset("run.ipynb")],
    );
    let summary = export_notes(&[note], &HashMap::new(), folder.path()).unwrap();
    assert_eq!(summary.attachments, 2);
    let mut copied: Vec<String> = std::fs::read_dir(folder.path().join(ATTACHMENTS))
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    copied.sort();
    assert_eq!(copied, vec!["run.ipynb", "used.png"]);
}

#[test]
fn exports_the_files_table_and_molecule_blocks_read_and_points_them_at_the_copies() {
    let folder = tempfile::tempdir().unwrap();
    let assets_dir = tempfile::tempdir().unwrap();
    let names = [
        "data.csv",
        "mol.pdb",
        "unused.csv",
        "braced.csv",
        "old.csv",
        "new.csv",
        "titled.csv",
    ];
    for name in names {
        write(assets_dir.path(), name, name.as_bytes());
    }
    let asset = |name: &str| ExportAsset {
        rel: format!("assets/{name}"),
        path: assets_dir.path().join(name),
        original: None,
    };
    let note = export_note(
        "a",
        "Alpha",
        "```csv\nPath:  assets/data.csv\nthousands: yes\n```\n```pdb\nformat: pdb\npath: ./assets/mol.pdb\n```\n```csv\na,b\npath: assets/unused.csv\n```\n```{=csv}\npath: assets/braced.csv\n```\n```csv\npath: assets/old.csv\npath: assets/new.csv\n```\n```csv title\npath: assets/titled.csv\n```\n",
        names.iter().map(|name| asset(name)).collect(),
    );
    let summary = export_notes(&[note], &HashMap::new(), folder.path()).unwrap();
    assert_eq!(summary.attachments, 4);
    let mut copied: Vec<String> = std::fs::read_dir(folder.path().join(ATTACHMENTS))
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    copied.sort();
    assert_eq!(copied, vec!["braced.csv", "data.csv", "mol.pdb", "new.csv"]);
    let text = std::fs::read_dir(folder.path())
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .find(|path| path.extension().is_some_and(|ext| ext == "md"))
        .map(|path| std::fs::read_to_string(path).unwrap())
        .unwrap();
    assert!(
        text.contains("```csv\nPath:  attachments/data.csv\nthousands: yes\n```"),
        "{text}"
    );
    assert!(
        text.contains("```pdb\nformat: pdb\npath: attachments/mol.pdb\n```"),
        "{text}"
    );
    assert!(
        text.contains("```csv\na,b\npath: assets/unused.csv\n```"),
        "{text}"
    );
    assert!(
        text.contains("```{=csv}\npath: attachments/braced.csv\n```"),
        "{text}"
    );
    assert!(
        text.contains("```csv\npath: assets/old.csv\npath: attachments/new.csv\n```"),
        "{text}"
    );
    assert!(
        text.contains("```csv title\npath: assets/titled.csv\n```"),
        "{text}"
    );
}

#[test]
fn finds_the_file_a_fenced_block_reads() {
    let value = |info: &str, lines: &[&str]| {
        fence_asset(info, lines).map(|asset| (asset.at, asset.prefix, asset.value))
    };
    assert_eq!(
        value("notebook", &["", "  assets/run.ipynb", "cells: 1"]),
        Some((1, "  ".into(), "assets/run.ipynb".into()))
    );
    assert_eq!(
        value("csv", &["sheet: 2", "path:assets/a.xlsx"]),
        Some((1, "path:".into(), "assets/a.xlsx".into()))
    );
    assert_eq!(
        value(" TSV ", &["  path : assets/a.tsv"]),
        Some((0, "  path : ".into(), "assets/a.tsv".into()))
    );
    assert_eq!(value("TSV title", &["  path : assets/a.tsv"]), None);
    assert_eq!(value("csv title", &["path: assets/data.csv"]), None);
    assert_eq!(
        value("{=csv}", &["path: assets/data.csv"]),
        Some((0, "path: ".into(), "assets/data.csv".into()))
    );
    assert_eq!(
        value(" {= Molecule } ", &["path: assets/m.pdb"]),
        Some((0, "path: ".into(), "assets/m.pdb".into()))
    );
    assert_eq!(
        value("csv", &["path: assets/old.csv", "path: assets/new.csv"]),
        Some((1, "path: ".into(), "assets/new.csv".into()))
    );
    assert_eq!(
        value("csv", &["path: assets/a.csv", "a,b", "path: assets/b.csv"]),
        Some((0, "path: ".into(), "assets/a.csv".into()))
    );
    assert_eq!(value("csv", &["path: assets/a.csv", "path:"]), None);
    assert_eq!(
        value("{=notebook}", &["assets/run.ipynb"]),
        Some((0, String::new(), "assets/run.ipynb".into()))
    );
    assert_eq!(value("notebook extra", &["assets/run.ipynb"]), None);
    assert!(is_notebook_info(" {=Notebook} ") && !is_notebook_info("notebook extra"));
    assert!(!is_notebook_info("{=}") && !is_notebook_info("{=csv}"));
    assert_eq!(
        value("mol2", &["colour: red", "path: assets/m.mol2"]),
        Some((1, "path: ".into(), "assets/m.mol2".into()))
    );
    assert_eq!(value("csv", &["a,b", "path: assets/a.csv"]), None);
    assert_eq!(value("csv", &["format: x", "path: assets/a.csv"]), None);
    assert_eq!(value("csv", &["path:   "]), None);
    assert_eq!(value("python", &["path: assets/a.csv"]), None);
}

#[test]
fn a_failed_export_removes_what_it_wrote_and_keeps_what_was_there() {
    let folder = tempfile::tempdir().unwrap();
    write(folder.path(), ATTACHMENTS, b"a file, not a folder");
    let assets_dir = tempfile::tempdir().unwrap();
    write(assets_dir.path(), "fig.png", b"png");
    let notes = [
        export_note("a", "Alpha", "First", Vec::new()),
        export_note(
            "b",
            "Beta",
            "![f](assets/fig.png)",
            vec![ExportAsset {
                rel: "assets/fig.png".into(),
                path: assets_dir.path().join("fig.png"),
                original: None,
            }],
        ),
    ];
    let error = export_notes(&notes, &HashMap::new(), folder.path()).unwrap_err();
    assert!(error.contains("export_attachments_failed"), "{error}");
    let left: Vec<String> = std::fs::read_dir(folder.path())
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(left, vec![ATTACHMENTS.to_string()]);
    assert_eq!(
        std::fs::read(folder.path().join(ATTACHMENTS)).unwrap(),
        b"a file, not a folder"
    );
}

#[test]
fn exports_more_than_a_thousand_notes_with_one_title() {
    let folder = tempfile::tempdir().unwrap();
    let notes: Vec<ExportNote> = (0..1_005)
        .map(|index| export_note(&format!("n{index}"), "Untitled", "x", Vec::new()))
        .collect();
    let summary = export_notes(&notes, &HashMap::new(), folder.path()).unwrap();
    assert_eq!(summary.notes, 1_005);
    assert!(folder.path().join("Untitled.md").is_file());
    assert!(folder.path().join("Untitled 1005.md").is_file());
}

#[test]
fn exports_never_overwrite_and_count_attachments_left_behind() {
    let folder = tempfile::tempdir().unwrap();
    write(folder.path(), "Alpha.md", b"keep");
    write(folder.path(), "attachments/Fig.png", b"other");
    let assets_dir = tempfile::tempdir().unwrap();
    write(assets_dir.path(), "fig.png", b"png");
    let asset = |rel: &str, file: &str, original: Option<&str>| ExportAsset {
        rel: rel.to_string(),
        path: assets_dir.path().join(file),
        original: original.map(str::to_string),
    };
    let notes = [
        export_note(
            "a",
            "Alpha",
            "![x](assets/fig.png) ![g](assets/gone.png)",
            vec![
                asset("assets/fig.png", "fig.png", Some("Fig.png")),
                asset("assets/gone.png", "gone.png", None),
            ],
        ),
        export_note("c", "Caf\u{e9}", "composed", Vec::new()),
        export_note("d", "Cafe\u{301}", "decomposed", Vec::new()),
        export_note("e", "CAF\u{c9}", "upper", Vec::new()),
    ];
    let summary = export_notes(&notes, &HashMap::new(), folder.path()).unwrap();
    assert_eq!(summary.notes, 4);
    assert_eq!(summary.attachments, 1);
    assert_eq!(summary.skipped, 1);
    let read = |name: &str| std::fs::read_to_string(folder.path().join(name)).unwrap();
    assert_eq!(read("Alpha.md"), "keep");
    assert_eq!(read("Alpha 2.md"), "![[Fig 2.png|x]] ![g](assets/gone.png)");
    assert_eq!(read("attachments/Fig.png"), "other");
    assert_eq!(read("attachments/Fig 2.png"), "png");
    assert_eq!(read("Caf\u{e9}.md"), "composed");
    assert_eq!(read("Caf\u{e9} 2.md"), "decomposed");
    assert_eq!(read("CAF\u{c9} 3.md"), "upper");
}

#[test]
fn finds_linked_notes_whose_id_sits_past_the_first_kilobytes() {
    let _env_guard = crate::paths::data_dir_env_lock();
    let data = tempfile::tempdir().unwrap();
    std::env::set_var("OLEAFLY_DATA_DIR", data.path());
    let padding = format!("summary: {}\n", "x".repeat(9 * 1024));
    crate::project::create_note_project_from(
        "Far".into(),
        format!("---\nkind: note\n{padding}id: far-id\n---\n# Far\n"),
        None,
    )
    .unwrap();
    let near = crate::project::create_note_project_from(
        "Near".into(),
        "---\nkind: note\nid: near-id\n---\n[Far](oleafly://note/far-id)\n".into(),
        None,
    )
    .unwrap();
    let (selected, outside) = collect_export(Some(&near)).unwrap();
    std::env::remove_var("OLEAFLY_DATA_DIR");
    assert_eq!(selected.len(), 1);
    assert_eq!(
        outside.get("far-id").map(|note| note.title.as_str()),
        Some("Far")
    );
}

#[test]
fn exports_one_note_with_links_to_notes_outside_it() {
    let folder = tempfile::tempdir().unwrap();
    let note = export_note(
        "a",
        "Alpha",
        "[B](oleafly://note/b#two) ![B](oleafly://note/b)",
        Vec::new(),
    );
    let outside = HashMap::from([(
        "b".to_string(),
        OutsideNote {
            title: "Beta/Gamma".to_string(),
            text: "# One\n# Two\n".to_string(),
        },
    )]);
    export_notes(&[note], &outside, folder.path()).unwrap();
    assert_eq!(
        std::fs::read_to_string(folder.path().join("Alpha.md")).unwrap(),
        "[[Beta Gamma#Two|B]] ![[Beta Gamma|B]]"
    );
}

#[test]
fn remembers_imported_folders() {
    let _env_guard = crate::paths::data_dir_env_lock();
    let data = tempfile::tempdir().unwrap();
    std::env::set_var("OLEAFLY_DATA_DIR", data.path());
    let vault = tempfile::tempdir().unwrap();
    assert!(previous_import(vault.path()).is_none());
    record_import(vault.path(), 3).unwrap();
    record_import(vault.path(), 4).unwrap();
    let seen = previous_import(vault.path()).unwrap();
    assert_eq!(seen.notes, 4);
    assert!(seen.imported_at > 0);
    assert!(previous_import(data.path()).is_none());
    for index in 0..HISTORY_LIMIT + 5 {
        record_import(&vault.path().join(index.to_string()), 1).unwrap();
    }
    assert_eq!(read_history().folders.len(), HISTORY_LIMIT);
    assert!(chosen_folder(data.path(), FolderUse::Import).is_err());
    assert!(chosen_folder(vault.path(), FolderUse::Import).is_ok());
    assert!(chosen_folder(&vault.path().join("missing"), FolderUse::Import).is_err());
    let created = create_export_folder(vault.path(), "Notes/one").unwrap();
    assert_eq!(created.file_name().unwrap(), "Notes one");
    let second = create_export_folder(vault.path(), "Notes/one").unwrap();
    assert_eq!(second.file_name().unwrap(), "Notes one 2");
    std::env::remove_var("OLEAFLY_DATA_DIR");
}

#[test]
fn tracks_runs_and_pending_folders() {
    assert!(valid_run_id("run-1"));
    assert!(!valid_run_id(""));
    assert!(!valid_run_id("a/b"));
    assert!(!valid_run_id(&"a".repeat(MAX_RUN_ID_CHARS + 1)));
    let cancel = start_run("t-run").unwrap();
    assert!(start_run("t-run").is_err());
    assert!(notes_import_cancel("t-run".into()));
    assert!(cancel.load(Ordering::SeqCst));
    finish_run("t-run");
    assert!(!notes_import_cancel("t-run".into()));
    hold_pending("t-held", PathBuf::from("/a"));
    hold_pending("t-held", PathBuf::from("/b"));
    assert!(notes_import_cancel("t-held".into()));
    assert!(take_pending("t-held").is_none());
    hold_pending("t-take", PathBuf::from("/c"));
    assert_eq!(take_pending("t-take"), Some(PathBuf::from("/c")));
    for index in 0..MAX_PENDING + 2 {
        hold_pending(&format!("t-many-{index}"), PathBuf::from("/d"));
    }
    assert!(take_pending("t-many-0").is_none());
    assert!(take_pending(&format!("t-many-{}", MAX_PENDING + 1)).is_some());
    assert_eq!(dialog_title(Some("  ".into())), None);
    assert_eq!(dialog_title(Some(" Pick ".into())).as_deref(), Some("Pick"));
    let outcome = serde_json::to_value(ImportOutcome::Seen {
        imported_at: 5,
        notes: 2,
    })
    .unwrap();
    assert_eq!(
        outcome,
        serde_json::json!({ "kind": "seen", "importedAt": 5, "notes": 2 })
    );
    let done = serde_json::to_value(ImportOutcome::Done(ImportSummary {
        notes: 1,
        ..ImportSummary::default()
    }))
    .unwrap();
    assert_eq!(done["kind"], "done");
    assert_eq!(done["notes"], 1);
    assert_eq!(
        serde_json::to_value(ImportOutcome::Dismissed).unwrap(),
        serde_json::json!({ "kind": "dismissed" })
    );
}

fn library_note(id: &str) -> (String, String) {
    let dir = crate::paths::project_dir(id).unwrap();
    let meta = crate::project::read_meta(id).unwrap();
    (
        meta.name,
        std::fs::read_to_string(dir.join(crate::project::NOTE_FILE)).unwrap(),
    )
}

fn links_by_title(ids: &[String]) -> Vec<(String, Vec<(&'static str, String)>)> {
    let notes: Vec<(String, String, Option<String>)> = ids
        .iter()
        .map(|id| {
            let (title, text) = library_note(id);
            let note_id = scan_note(id.clone(), title.clone(), &text).note_id;
            (title, text, note_id)
        })
        .collect();
    let title_of: HashMap<String, String> = notes
        .iter()
        .filter_map(|(title, _, id)| id.clone().map(|id| (id, title.clone())))
        .collect();
    let mut listed: Vec<(String, Vec<(&'static str, String)>)> = notes
        .iter()
        .map(|(title, text, _)| {
            let links = scan_note(String::new(), String::new(), text)
                .links
                .into_iter()
                .map(|link| {
                    let kind = if link.kind == LinkKind::Note {
                        "note"
                    } else {
                        "project"
                    };
                    (kind, title_of.get(&link.id).cloned().unwrap_or(link.id))
                })
                .collect();
            (title.clone(), links)
        })
        .collect();
    listed.sort();
    listed
}

#[test]
fn finds_the_shared_folder_of_picked_files() {
    let one = PathBuf::from("/notes/Inbox/One.md");
    let two = PathBuf::from("/notes/Lab/2024/Two.md");
    assert_eq!(
        common_folder(std::slice::from_ref(&one)),
        Some(PathBuf::from("/notes/Inbox"))
    );
    assert_eq!(
        common_folder(&[one, two.clone()]),
        Some(PathBuf::from("/notes"))
    );
    assert_eq!(common_folder(&[]), None);
    assert_eq!(relative_name(Path::new("/notes"), &two), "Lab/2024/Two.md");
}

#[test]
fn scans_picked_markdown_files_and_the_attachments_beside_them() {
    let root = tempfile::tempdir().unwrap();
    write(root.path(), "Inbox/One.md", b"# One\n");
    write(root.path(), "Inbox/Unpicked.md", b"# Unpicked\n");
    write(root.path(), "Inbox/data.csv", b"a,b\n");
    write(root.path(), "Inbox/pics/plot.png", b"png");
    write(root.path(), "Inbox/pics/deeper/far.png", b"png");
    write(root.path(), "Inbox/.hidden.png", b"png");
    write(root.path(), "Lab/Two.md", b"# Two\n");
    write(root.path(), "Lab/table.csv", b"a\n");
    write(root.path(), "Elsewhere/skip.png", b"png");
    write(root.path(), "Inbox/notes.txt", b"text");
    write(
        root.path(),
        "Lab/Big.md",
        &vec![b'a'; (MAX_NOTE_BYTES + 1) as usize],
    );
    let picked = [
        root.path().join("Inbox/One.md"),
        root.path().join("Lab/Two.md"),
        root.path().join("Inbox/One.md"),
        root.path().join("Inbox/notes.txt"),
        root.path().join("Lab/Big.md"),
        root.path().join("Missing.md"),
    ];
    let vault = scan_files(&picked, &AtomicBool::new(false))
        .unwrap()
        .unwrap();
    let notes: Vec<&str> = vault.notes.iter().map(|file| file.rel.as_str()).collect();
    let files: Vec<&str> = vault.files.iter().map(|file| file.rel.as_str()).collect();
    assert_eq!(notes, ["Inbox/One.md", "Lab/Two.md"]);
    assert_eq!(files, ["Inbox/pics/plot.png"]);
    assert_eq!(vault.skipped, 3);
    assert_eq!(vault.skipped_notes, ["notes.txt", "Big.md", "Missing.md"]);
    assert!(scan_files(&picked, &AtomicBool::new(true))
        .unwrap()
        .is_none());
    let empty = scan_files(
        &[root.path().join("Inbox/notes.txt")],
        &AtomicBool::new(false),
    )
    .unwrap()
    .unwrap();
    assert!(empty.notes.is_empty() && empty.files.is_empty());
    assert_eq!(empty.skipped, 1);
}

#[test]
fn refuses_files_inside_the_library() {
    let _env_guard = crate::paths::data_dir_env_lock();
    let data = tempfile::tempdir().unwrap();
    std::env::set_var("OLEAFLY_DATA_DIR", data.path());
    let inside = crate::paths::oleafly_root()
        .unwrap()
        .join("projects/x/note.md");
    write(inside.parent().unwrap(), "note.md", b"# Inside\n");
    let refused = scan_files(&[inside], &AtomicBool::new(false)).unwrap_err();
    std::env::remove_var("OLEAFLY_DATA_DIR");
    assert_eq!(
        crate::app_error::english(&refused).as_deref(),
        Some("Choose files outside the Oleafly library.")
    );
}

#[test]
fn imports_picked_markdown_files_with_their_links_and_attachments() {
    let _env_guard = crate::paths::data_dir_env_lock();
    let data = tempfile::tempdir().unwrap();
    std::env::set_var("OLEAFLY_DATA_DIR", data.path());
    let folder = tempfile::tempdir().unwrap();
    write(
        folder.path(),
        "Alpha.md",
        b"# Alpha\nSee [[Beta]] and [[Gamma]].\n![[plot.png]]\n",
    );
    write(folder.path(), "Beta.md", b"# Beta\nBack to [[Alpha]].\n");
    write(folder.path(), "Gamma.md", b"# Gamma\n");
    write(folder.path(), "plot.png", b"png-data");
    let picked = [
        folder.path().join("Alpha.md"),
        folder.path().join("Beta.md"),
    ];
    let mut events = Vec::new();
    let report = import_files_with(
        &picked,
        ImportOptions::default(),
        &AtomicBool::new(false),
        &mut |event| events.push(event),
        &|_| Ok(()),
        &CreatedNotes::default(),
    )
    .unwrap();
    assert_eq!(
        report.summary,
        ImportSummary {
            notes: 2,
            attachments: 1,
            unresolved: 1,
            skipped: 0,
            cancelled: false,
            not_copied: Vec::new(),
            skipped_notes: Vec::new(),
        }
    );
    assert_eq!(events.first().unwrap().total, 2);
    let (alpha_title, alpha) = library_note(&report.created[0]);
    let (_, beta) = library_note(&report.created[1]);
    assert_eq!(alpha_title, "Alpha");
    let beta_id = scan_note(String::new(), String::new(), &beta)
        .note_id
        .unwrap();
    assert!(
        alpha.contains(&format!("(oleafly://note/{beta_id})")),
        "{alpha}"
    );
    assert!(alpha.contains("Gamma"), "{alpha}");
    let cancelled = import_markdown_files(
        &picked,
        ImportOptions::default(),
        &AtomicBool::new(true),
        &mut |_| {},
    )
    .unwrap();
    std::env::remove_var("OLEAFLY_DATA_DIR");
    assert!(cancelled.summary.cancelled);
}

#[test]
fn picked_files_copy_only_images_and_notebooks_named_beside_them() {
    let _env_guard = crate::paths::data_dir_env_lock();
    let data = tempfile::tempdir().unwrap();
    std::env::set_var("OLEAFLY_DATA_DIR", data.path());
    let folder = tempfile::tempdir().unwrap();
    write(
        folder.path(),
        "Inbox/One.md",
        b"# One\n![](pics/plot.png) ![[plot.png]] [[passport.pdf]] ![](../Lab/secret.png) [doc](doc.pdf)\n![[run.ipynb]]\n",
    );
    write(folder.path(), "Inbox/pics/plot.png", b"png-data");
    write(folder.path(), "Inbox/passport.pdf", b"secret");
    write(folder.path(), "Inbox/doc.pdf", b"doc");
    write(folder.path(), "Inbox/run.ipynb", b"{}");
    write(folder.path(), "Lab/Two.md", b"# Two\n");
    write(folder.path(), "Lab/secret.png", b"lab");
    let picked = [
        folder.path().join("Inbox/One.md"),
        folder.path().join("Lab/Two.md"),
    ];
    let journal = CreatedNotes::default();
    let report = import_files_with(
        &picked,
        ImportOptions::default(),
        &AtomicBool::new(false),
        &mut |_| {},
        &|_| Ok(()),
        &journal,
    )
    .unwrap();
    assert_eq!(journal.take(), report.created);
    assert_eq!(report.summary.notes, 2);
    assert_eq!(report.summary.attachments, 2);
    assert_eq!(report.summary.unresolved, 4);
    assert_eq!(
        report.summary.not_copied,
        ["plot.png", "passport.pdf", "../Lab/secret.png", "doc.pdf"]
    );
    let (_, one) = library_note(&report.created[0]);
    assert!(one.contains("![](assets/plot-"), "{one}");
    assert!(one.contains("```notebook\nassets/run-"), "{one}");
    assert!(one.contains("[[passport.pdf]]"), "{one}");
    let assets = crate::paths::project_dir(&report.created[0])
        .unwrap()
        .join("assets");
    let mut names: Vec<String> = std::fs::read_dir(assets)
        .unwrap()
        .flatten()
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| name != "origins")
        .collect();
    names.sort();
    assert_eq!(names.len(), 2, "{names:?}");
    assert!(names
        .iter()
        .all(|name| !name.contains("pdf") && !name.starts_with("secret")));
    std::env::remove_var("OLEAFLY_DATA_DIR");
}

#[test]
fn imports_a_vault_and_round_trips_through_export() {
    let _env_guard = crate::paths::data_dir_env_lock();
    let data = tempfile::tempdir().unwrap();
    std::env::set_var("OLEAFLY_DATA_DIR", data.path());
    let vault = tempfile::tempdir().unwrap();
    write(vault.path(), "Alpha.md", b"---\ntags: [x]\n---\n# Alpha\nSee [[Beta#Methods|methods]] and ![[Beta]].\n![[pics/plot.png]]\n[[Nowhere]]\n");
    write(
        vault.path(),
        "Lab/Beta.md",
        b"# Beta\n## Methods\nBack to [[Alpha]].\n[data](../data.csv)\n",
    );
    write(vault.path(), "pics/plot.png", b"png-data");
    write(vault.path(), "data.csv", b"a,b\n");
    write(vault.path(), "bad.md", &[0xff, 0xfe, 0x00]);
    write(vault.path(), ".obsidian/app.json", b"{}");
    let mut events = Vec::new();
    let report = import_vault(
        vault.path(),
        ImportOptions {
            folder_tags: true,
            confirm_above: None,
        },
        &AtomicBool::new(false),
        &mut |event| events.push(event),
    )
    .unwrap();
    assert_eq!(
        report.summary,
        ImportSummary {
            notes: 2,
            attachments: 2,
            unresolved: 1,
            skipped: 1,
            cancelled: false,
            not_copied: Vec::new(),
            skipped_notes: vec!["bad.md".to_string()],
        }
    );
    assert_eq!(events.len(), 5);
    assert_eq!(events[0].phase, ImportPhase::Read);
    assert_eq!(events[0].total, 3);
    assert_eq!(events.last().unwrap().phase, ImportPhase::Write);
    assert_eq!(events.last().unwrap().done, 2);
    let (alpha_title, alpha) = library_note(&report.created[0]);
    let (beta_title, beta) = library_note(&report.created[1]);
    assert_eq!(alpha_title, "Alpha");
    assert_eq!(beta_title, "Beta");
    assert!(
        alpha.starts_with("---\ntags: [x]\ntitle: Alpha\nkind: note\nid: "),
        "{alpha}"
    );
    assert!(beta.contains("tags:\n  - Lab\n"), "{beta}");
    let beta_id = scan_note(String::new(), String::new(), &beta)
        .note_id
        .unwrap();
    assert!(
        alpha.contains(&format!("[methods](oleafly://note/{beta_id}#methods)")),
        "{alpha}"
    );
    assert!(
        alpha.contains(&format!("![Beta](oleafly://note/{beta_id})")),
        "{alpha}"
    );
    assert!(alpha.contains("![plot.png](assets/plot-"), "{alpha}");
    assert!(alpha.contains("[[Nowhere]]"), "{alpha}");
    let alpha_dir = crate::paths::project_dir(&report.created[0]).unwrap();
    let assets: Vec<String> = std::fs::read_dir(alpha_dir.join("assets"))
        .unwrap()
        .flatten()
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(assets.len(), 2, "{assets:?}");
    let origin_name = assets
        .iter()
        .find(|name| name.as_str() != "origins")
        .unwrap();
    let origin =
        std::fs::read_to_string(alpha_dir.join(format!("assets/origins/{origin_name}.json")))
            .unwrap();
    assert!(origin.contains("\"fileName\": \"plot.png\""), "{origin}");
    assert!(
        !origin.contains(&vault.path().to_string_lossy().into_owned()),
        "{origin}"
    );

    let (selected, outside) = collect_export(None).unwrap();
    assert!(outside.is_empty());
    let out = tempfile::tempdir().unwrap();
    let exported = export_notes(&selected, &outside, out.path()).unwrap();
    assert_eq!(exported.notes, 2);
    assert_eq!(exported.attachments, 2);
    let alpha_md = std::fs::read_to_string(out.path().join("Alpha.md")).unwrap();
    assert!(
        alpha_md.contains("See [[Beta#Methods|methods]] and ![[Beta]]."),
        "{alpha_md}"
    );
    assert!(alpha_md.contains("![[plot.png]]"), "{alpha_md}");
    assert!(!alpha_md.contains("id: "), "{alpha_md}");
    let beta_md = std::fs::read_to_string(out.path().join("Beta.md")).unwrap();
    assert!(beta_md.contains("Back to [[Alpha]]."), "{beta_md}");
    assert!(beta_md.contains("[[data.csv|data]]"), "{beta_md}");
    assert!(out.path().join("attachments/plot.png").is_file());

    let before = links_by_title(&report.created);
    let again = import_vault(
        out.path(),
        ImportOptions::default(),
        &AtomicBool::new(false),
        &mut |_| {},
    )
    .unwrap();
    assert_eq!(again.summary.notes, 2);
    assert_eq!(again.summary.unresolved, 1);
    assert_eq!(links_by_title(&again.created), before);
    let (_, alpha_again) = library_note(&again.created[0]);
    let asset_line = |text: &str| {
        text.lines()
            .find(|line| line.contains("assets/plot-"))
            .map(str::to_string)
    };
    assert_eq!(asset_line(&alpha_again), asset_line(&alpha));

    let single = tempfile::tempdir().unwrap();
    let (one, outside) = collect_export(Some(&report.created[1])).unwrap();
    assert_eq!(one.len(), 1);
    assert_eq!(outside.len(), 1);
    export_notes(&one, &outside, single.path()).unwrap();
    assert!(std::fs::read_to_string(single.path().join("Beta.md"))
        .unwrap()
        .contains("[[Alpha]]"));
    assert!(collect_export(Some("missing-note")).is_err());
    std::env::remove_var("OLEAFLY_DATA_DIR");
}

#[test]
fn stops_when_cancelled() {
    let _env_guard = crate::paths::data_dir_env_lock();
    let data = tempfile::tempdir().unwrap();
    std::env::set_var("OLEAFLY_DATA_DIR", data.path());
    let vault = tempfile::tempdir().unwrap();
    write(vault.path(), "One.md", b"1");
    write(vault.path(), "Two.md", b"2");
    write(vault.path(), "Three.md", b"3");
    let cancel = AtomicBool::new(true);
    let report =
        import_vault(vault.path(), ImportOptions::default(), &cancel, &mut |_| {}).unwrap();
    assert!(report.summary.cancelled);
    assert!(report.created.is_empty());
    let cancel = AtomicBool::new(false);
    let report = import_vault(
        vault.path(),
        ImportOptions::default(),
        &cancel,
        &mut |event| {
            if event.phase == ImportPhase::Read && event.done == 2 {
                cancel.store(true, Ordering::SeqCst);
            }
        },
    )
    .unwrap();
    assert!(report.summary.cancelled);
    assert!(report.created.is_empty());
    let cancel = AtomicBool::new(false);
    let report = import_vault(
        vault.path(),
        ImportOptions::default(),
        &cancel,
        &mut |event| {
            if event.phase == ImportPhase::Write {
                cancel.store(true, Ordering::SeqCst);
            }
        },
    )
    .unwrap();
    assert!(report.summary.cancelled);
    assert_eq!(report.created.len(), 1);
    assert_eq!(report.summary.notes, 0);
    std::env::remove_var("OLEAFLY_DATA_DIR");
}

#[test]
fn a_stopped_import_removes_its_notes_without_recycling_them() {
    let _library = crate::collab::testing::TempLibrary::new();
    let vault = tempfile::tempdir().unwrap();
    write(vault.path(), "One.md", b"1");
    write(vault.path(), "Two.md", b"2");
    let cancel = AtomicBool::new(false);
    let report = import_vault(
        vault.path(),
        ImportOptions::default(),
        &cancel,
        &mut |event| {
            if event.phase == ImportPhase::Write {
                cancel.store(true, Ordering::SeqCst);
            }
        },
    )
    .unwrap();
    assert_eq!(report.created.len(), 1);
    let dir = crate::paths::project_dir(&report.created[0]).unwrap();
    assert!(dir.is_dir());
    let outcome = settle(report, Some(vault.path())).unwrap();
    assert_eq!(
        outcome,
        ImportOutcome::Done(ImportSummary {
            cancelled: true,
            ..ImportSummary::default()
        })
    );
    assert!(!dir.exists());
    let recycled = std::fs::read_dir(crate::paths::recycle_bin_root().unwrap())
        .unwrap()
        .count();
    assert_eq!(recycled, 0);
    assert!(previous_import(vault.path()).is_none());
}

#[test]
fn an_interrupted_import_is_remembered_on_the_next_import() {
    let _library = crate::collab::testing::TempLibrary::new();
    let vault = tempfile::tempdir().unwrap();
    for name in ["One.md", "Two.md", "Three.md"] {
        write(vault.path(), name, b"x");
    }
    let journal = CreatedNotes::recorded("crashed-run", vault.path()).unwrap();
    let cancel = AtomicBool::new(false);
    let report = import_vault_with(
        vault.path(),
        ImportOptions::default(),
        &cancel,
        &mut |event| {
            if event.phase == ImportPhase::Write && event.done == 2 {
                cancel.store(true, Ordering::SeqCst);
            }
        },
        &|_| Ok(()),
        &journal,
    )
    .unwrap();
    assert_eq!(report.created.len(), 2);
    let other = tempfile::tempdir().unwrap();
    let live = CreatedNotes::recorded("live-run", other.path()).unwrap();
    live.push(&report.created[0]);
    let _cancel = start_run("live-run").unwrap();
    assert_eq!(previous_import(vault.path()).unwrap().notes, 2);
    assert!(previous_import(other.path()).is_none());
    finish_run("live-run");
    assert_eq!(previous_import(other.path()).unwrap().notes, 1);
    assert!(std::fs::read_dir(journal_dir().unwrap())
        .unwrap()
        .next()
        .is_none());
    assert_eq!(previous_import(vault.path()).unwrap().notes, 2);
}

#[cfg(unix)]
#[test]
fn refuses_a_linked_projects_folder_and_folders_that_hold_the_library() {
    let _library = crate::collab::testing::TempLibrary::new();
    let data = crate::paths::oleafly_root().unwrap();
    let elsewhere = tempfile::tempdir().unwrap();
    std::os::unix::fs::symlink(elsewhere.path(), data.join("projects")).unwrap();
    write(&elsewhere.path().join("p1"), "note.md", b"# Inside\n");
    let inside = elsewhere.path().join("p1");
    assert!(chosen_folder(elsewhere.path(), FolderUse::Import).is_err());
    assert!(chosen_folder(&inside, FolderUse::ExportParent).is_err());
    assert!(scan_files(&[inside.join("note.md")], &AtomicBool::new(false)).is_err());
    let holder = data.parent().unwrap();
    assert!(chosen_folder(holder, FolderUse::Import).is_err());
    assert!(chosen_folder(holder, FolderUse::ExportParent).is_ok());
}

#[test]
fn imports_utf16_notes_and_names_the_notes_it_skips() {
    let _library = crate::collab::testing::TempLibrary::new();
    let vault = tempfile::tempdir().unwrap();
    let wide: Vec<u8> = [0xff, 0xfe]
        .into_iter()
        .chain("# Über\nText\n".encode_utf16().flat_map(u16::to_le_bytes))
        .collect();
    write(vault.path(), "Wide.md", &wide);
    write(vault.path(), "Broken.md", &[0xc3]);
    write(
        vault.path(),
        "Huge.md",
        &vec![b'a'; (MAX_NOTE_BYTES + 1) as usize],
    );
    let report = import_vault(
        vault.path(),
        ImportOptions::default(),
        &AtomicBool::new(false),
        &mut |_| {},
    )
    .unwrap();
    assert_eq!(report.summary.notes, 1);
    assert_eq!(report.summary.skipped, 2);
    assert_eq!(report.summary.skipped_notes, ["Huge.md", "Broken.md"]);
    let (title, text) = library_note(&report.created[0]);
    assert_eq!(title, "Über");
    assert!(text.ends_with("# Über\nText\n"), "{text}");
}

#[test]
fn throttles_progress_but_keeps_phase_changes_and_last_events() {
    let start = Instant::now();
    let event = |phase, done, total, ms| {
        (
            ImportProgress {
                phase,
                done,
                total,
                file: String::new(),
            },
            start + std::time::Duration::from_millis(ms),
        )
    };
    let mut throttle = Throttle::default();
    let sent: Vec<bool> = [
        event(ImportPhase::Read, 1, 5, 0),
        event(ImportPhase::Read, 2, 5, 10),
        event(ImportPhase::Read, 3, 5, 120),
        event(ImportPhase::Read, 4, 5, 130),
        event(ImportPhase::Read, 5, 5, 131),
        event(ImportPhase::Write, 1, 3, 132),
        event(ImportPhase::Write, 2, 3, 133),
        event(ImportPhase::Write, 3, 3, 134),
    ]
    .iter()
    .map(|(progress, now)| throttle.admits(progress, *now))
    .collect();
    assert_eq!(sent, [true, false, true, false, true, true, false, true]);
}

#[test]
fn asks_before_importing_more_notes_than_the_limit() {
    let _library = crate::collab::testing::TempLibrary::new();
    let vault = tempfile::tempdir().unwrap();
    for name in ["a.md", "b.md", "c.md"] {
        write(vault.path(), name, b"x");
    }
    let import = |limit| {
        import_vault_with(
            vault.path(),
            ImportOptions {
                folder_tags: false,
                confirm_above: Some(limit),
            },
            &AtomicBool::new(false),
            &mut |_| {},
            &|_| Ok(()),
            &CreatedNotes::default(),
        )
        .unwrap()
    };
    let asked = import(2);
    assert_eq!(asked.confirm, Some(3));
    assert!(asked.created.is_empty());
    assert_eq!(
        settle(asked, Some(vault.path())).unwrap(),
        ImportOutcome::Large { notes: 3 }
    );
    assert!(crate::project::list_projects_blocking()
        .unwrap_or_default()
        .is_empty());
    assert_eq!(import(3).summary.notes, 3);
    assert_eq!(
        serde_json::to_value(ImportOutcome::Large { notes: 3 }).unwrap(),
        serde_json::json!({ "kind": "large", "notes": 3 })
    );
}
