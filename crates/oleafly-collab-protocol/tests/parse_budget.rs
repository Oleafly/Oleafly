use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

use oleafly_collab_protocol::frames::{ClientFrame, ServerFrame};
use oleafly_collab_protocol::poll::PollFrames;

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

const FRAME_BYTES: usize = 12 * 1024 * 1024;
const BUDGET: usize = 64 * 1024;

fn padded(head: &str) -> String {
    let mut text = String::with_capacity(FRAME_BYTES + 64);
    text.push_str(head);
    text.push_str(",\"x\":[");
    while text.len() < FRAME_BYTES {
        text.push_str("[0],");
    }
    text.push_str("[0]]}");
    text
}

fn peak_while<T>(work: impl FnOnce() -> T) -> (T, usize) {
    let before = HELD.load(Ordering::SeqCst);
    PEAK.store(before, Ordering::SeqCst);
    let done = work();
    (done, PEAK.load(Ordering::SeqCst).saturating_sub(before))
}

#[test]
fn padded_frames_parse_within_a_small_fixed_budget() {
    let _alone = ONE_AT_A_TIME
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let hello = padded(r#"{"type":"hello""#);
    assert!(hello.len() >= FRAME_BYTES);
    let (read, extra) = peak_while(|| ClientFrame::from_json(&hello));
    assert!(read.is_err(), "a hello without its fields is refused");
    assert!(extra < BUDGET, "a padded hello took {extra} bytes");

    let ping = padded(r#"{"type":"ping","id":7"#);
    let (read, extra) = peak_while(|| ClientFrame::from_json(&ping));
    assert_eq!(read.unwrap(), ClientFrame::Ping { id: 7 });
    assert!(extra < BUDGET, "a padded ping took {extra} bytes");

    let later = padded(r#"{"type":"from_a_later_client""#);
    let (read, extra) = peak_while(|| ClientFrame::from_json(&later));
    assert_eq!(read.unwrap(), ClientFrame::Unknown);
    assert!(extra < BUDGET, "a padded unknown frame took {extra} bytes");

    let pong = padded(r#"{"type":"pong","id":7"#);
    let (read, extra) = peak_while(|| ServerFrame::from_json(&pong));
    assert_eq!(read.unwrap(), ServerFrame::Pong { id: 7 });
    assert!(extra < BUDGET, "a padded pong took {extra} bytes");

    let posted = format!(r#"{{"frames":[{ping}]}}"#);
    drop((hello, ping, later, pong));
    let (read, extra) = peak_while(|| PollFrames::from_json(posted.as_bytes()));
    assert_eq!(read.unwrap().frames, vec![ClientFrame::Ping { id: 7 }]);
    assert!(extra < BUDGET, "a posted padded ping took {extra} bytes");
}

#[test]
fn a_post_of_many_small_frames_stops_at_the_limit_without_piling_up() {
    let _alone = ONE_AT_A_TIME
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut posted = String::with_capacity(FRAME_BYTES + 64);
    posted.push_str(r#"{"frames":["#);
    while posted.len() < FRAME_BYTES {
        posted.push_str(r#"{"type":"x"},"#);
    }
    posted.push_str(r#"{"type":"x"}]}"#);
    let (read, extra) = peak_while(|| PollFrames::from_json(posted.as_bytes()));
    assert!(
        read.is_err(),
        "more frames than one post may carry are refused"
    );
    assert!(extra < BUDGET, "a post of small frames took {extra} bytes");
}
