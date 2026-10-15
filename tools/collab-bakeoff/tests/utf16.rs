use collab_bakeoff::utf16::{is_boundary, snap_back, utf16_len};

#[test]
fn counts_surrogate_pairs_as_two_units() {
    assert_eq!(utf16_len("Hello 🌿"), 8);
    assert_eq!(utf16_len("café"), 4);
    assert_eq!(utf16_len(""), 0);
}

#[test]
fn snaps_offsets_inside_a_pair_back_to_its_start() {
    assert_eq!(snap_back("Hello 🌿!", 7), 6);
    assert_eq!(snap_back("Hello 🌿!", 8), 8);
    assert_eq!(snap_back("Hello 🌿!", 99), 9);
}

#[test]
fn knows_which_offsets_are_boundaries() {
    assert!(is_boundary("Hello 🌿", 6));
    assert!(!is_boundary("Hello 🌿", 7));
    assert!(is_boundary("Hello 🌿", 8));
    assert!(!is_boundary("Hello 🌿", 9));
}
