use collab_bakeoff::rng::Rng;

#[test]
fn matches_the_splitmix64_reference_sequence() {
    let mut rng = Rng::new(0);
    assert_eq!(rng.next_u64(), 0xe220_a839_7b1d_cdaf);
    assert_eq!(rng.next_u64(), 0x6e78_9e6a_a1b9_65f4);
    assert_eq!(rng.next_u64(), 0x06c4_5d18_8009_454f);
}

#[test]
fn bounded_draws_stay_in_range() {
    let mut rng = Rng::new(5);
    for _ in 0..1_000 {
        assert!(rng.below(7) < 7);
    }
    assert_eq!(rng.below(0), 0);
    assert_eq!(rng.pick::<u8>(&[]), None);
}

#[test]
fn the_same_seed_gives_the_same_stream() {
    let mut left = Rng::new(42);
    let mut right = Rng::new(42);
    let a: Vec<u64> = (0..16).map(|_| left.next_u64()).collect();
    let b: Vec<u64> = (0..16).map(|_| right.next_u64()).collect();
    assert_eq!(a, b);
}
