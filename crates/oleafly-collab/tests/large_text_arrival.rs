use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicUsize, Ordering};

use oleafly_collab::doc::{NodeKind, ProjectDoc};
use oleafly_collab::live::LiveProject;
use oleafly_collab_protocol::projects::ProjectRole;

struct Counting;

static LIVE: AtomicUsize = AtomicUsize::new(0);
static PEAK: AtomicUsize = AtomicUsize::new(0);

unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let pointer = unsafe { System.alloc(layout) };
        if !pointer.is_null() {
            let now = LIVE.fetch_add(layout.size(), Ordering::Relaxed) + layout.size();
            PEAK.fetch_max(now, Ordering::Relaxed);
        }
        pointer
    }

    unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
        unsafe { System.dealloc(pointer, layout) };
        LIVE.fetch_sub(layout.size(), Ordering::Relaxed);
    }
}

#[global_allocator]
static COUNTING: Counting = Counting;

fn bibliography(bytes: usize) -> String {
    let mut text = String::with_capacity(bytes + 256);
    let mut entry = 0;
    while text.len() < bytes {
        text.push_str(&format!(
            "@article{{key{entry},\n  author = {{Smith, John and Müller, Jörg}},\n  title = {{Results from cohort {entry}}},\n  journal = {{Journal of Things}},\n  year = {{2019}},\n}}\n\n"
        ));
        entry += 1;
    }
    text
}

#[test]
fn a_large_file_someone_else_adds_arrives_without_a_memory_spike() {
    let text = bibliography(400 * 1024);
    let mut alice = ProjectDoc::create().unwrap();
    alice.set_author("acct-alice", "Alice Chen");
    let main = alice
        .add_node(None, "main.tex", NodeKind::Text, None, "\\cite{key1}\n")
        .unwrap();
    let mut bob = ProjectDoc::load(&alice.snapshot().unwrap()).unwrap();
    bob.set_author("acct-bob", "Bob Smith");
    bob.add_node(None, "notes.tex", NodeKind::Text, None, "Bob's notes")
        .unwrap();
    let since = alice.version();
    let refs = alice
        .add_node(None, "refs.bib", NodeKind::Text, None, &text)
        .unwrap();
    let payload = alice.export_since(&since).unwrap();
    let mut receiver = LiveProject::new(bob, 0, ProjectRole::Editor);

    let before = LIVE.load(Ordering::Relaxed);
    PEAK.store(before, Ordering::Relaxed);
    assert!(receiver.import_update(1, &payload).unwrap());
    let spike = PEAK.load(Ordering::Relaxed).saturating_sub(before);

    assert_eq!(receiver.doc().text(&refs).unwrap(), text);
    assert_eq!(receiver.doc().text(&main).unwrap(), "\\cite{key1}\n");
    assert!(
        spike < 40 * text.len(),
        "receiving a {} byte file held {} bytes at its peak",
        text.len(),
        spike
    );
}
