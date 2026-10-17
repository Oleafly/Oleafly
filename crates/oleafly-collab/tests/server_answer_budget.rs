use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

use oleafly_collab_protocol::frames::ServerFrame;
use oleafly_collab_protocol::poll::{PollBatch, PollReplies, MAX_POLLED_FRAMES};

struct Counting;

static HELD: AtomicUsize = AtomicUsize::new(0);
static PEAK: AtomicUsize = AtomicUsize::new(0);
static ONE_AT_A_TIME: Mutex<()> = Mutex::new(());

fn grew(by: usize) {
    let held = HELD.fetch_add(by, Ordering::SeqCst) + by;
    PEAK.fetch_max(held, Ordering::SeqCst);
}

unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let pointer = unsafe { System.alloc(layout) };
        if !pointer.is_null() {
            grew(layout.size());
        }
        pointer
    }

    unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
        unsafe { System.dealloc(pointer, layout) };
        HELD.fetch_sub(layout.size(), Ordering::SeqCst);
    }

    unsafe fn realloc(&self, pointer: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        let moved = unsafe { System.realloc(pointer, layout, new_size) };
        if !moved.is_null() {
            if new_size >= layout.size() {
                grew(new_size - layout.size());
            } else {
                HELD.fetch_sub(layout.size() - new_size, Ordering::SeqCst);
            }
        }
        moved
    }
}

#[global_allocator]
static COUNTING: Counting = Counting;

const ANSWER_BYTES: usize = 12 * 1024 * 1024;
const BUDGET: usize = 64 * 1024;

fn peak_while<T>(work: impl FnOnce() -> T) -> (T, usize) {
    let before = HELD.load(Ordering::SeqCst);
    PEAK.store(before, Ordering::SeqCst);
    let done = work();
    (done, PEAK.load(Ordering::SeqCst).saturating_sub(before))
}

fn nested_padding(into: &mut String) {
    into.push('[');
    while into.len() < ANSWER_BYTES {
        into.push_str("[0],");
    }
    into.push_str("[0]]");
}

#[test]
fn a_padded_poll_answer_is_read_within_a_small_fixed_budget() {
    let _alone = ONE_AT_A_TIME
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut answer = String::with_capacity(ANSWER_BYTES + 256);
    answer.push_str(r#"{"cursor":"c.1","frames":[{"type":"pong","id":7,"x":"#);
    nested_padding(&mut answer);
    answer.push_str(r#"},{"type":"from_a_later_server","x":"#);
    nested_padding(&mut answer);
    answer.push_str(r#"}],"later":"#);
    nested_padding(&mut answer);
    answer.push('}');
    let (read, extra) = peak_while(|| PollBatch::from_json(answer.as_bytes()));
    let read = read.expect("a padded answer still reads");
    assert_eq!(
        read.frames,
        vec![ServerFrame::Pong { id: 7 }, ServerFrame::Unknown]
    );
    assert!(extra < BUDGET, "a padded poll answer took {extra} bytes");
    let (read, extra) = peak_while(|| PollReplies::from_json(answer.as_bytes()));
    assert_eq!(read.expect("replies").frames.len(), 2);
    assert!(extra < BUDGET, "padded replies took {extra} bytes");
}

#[test]
fn an_answer_of_many_tiny_frames_stops_at_the_frame_limit() {
    let _alone = ONE_AT_A_TIME
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut answer = String::with_capacity(ANSWER_BYTES + 64);
    answer.push_str(r#"{"frames":["#);
    while answer.len() < ANSWER_BYTES {
        answer.push_str(r#"{"type":"pong","id":1},"#);
    }
    answer.push_str(r#"{"type":"pong","id":1}]}"#);
    let (read, extra) = peak_while(|| PollBatch::from_json(answer.as_bytes()));
    assert!(read.is_err(), "more frames than one answer may carry");
    let most = MAX_POLLED_FRAMES * std::mem::size_of::<ServerFrame>();
    assert!(
        extra <= most + BUDGET,
        "many tiny frames took {extra} bytes, more than {most}"
    );
}
