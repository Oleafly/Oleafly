use collab_bakeoff::heap::{self, CountingAlloc};

#[global_allocator]
static GLOBAL: CountingAlloc = CountingAlloc;

#[test]
fn tracks_the_peak_of_live_heap_bytes() {
    let baseline = heap::reset_peak();
    let block = vec![7_u8; 4 * 1024 * 1024];
    let during = heap::current();
    drop(block);
    assert!(during >= baseline + 4 * 1024 * 1024);
    assert!(heap::peak() >= baseline + 4 * 1024 * 1024);
    assert!(heap::current() < during);
}
