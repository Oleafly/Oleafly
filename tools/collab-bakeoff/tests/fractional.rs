use collab_bakeoff::fractional::{after, between};

#[test]
fn the_first_key_is_the_middle_digit() {
    assert_eq!(after(""), "i");
}

#[test]
fn keys_after_always_sort_after() {
    let mut key = after("");
    for _ in 0..200 {
        let next = after(&key);
        assert!(next > key, "{next} <= {key}");
        key = next;
    }
}

#[test]
fn keys_between_sort_between() {
    let middle = between("a", Some("b"));
    assert_eq!(middle, "ai");
    assert!("a" < middle.as_str() && middle.as_str() < "b");
    let inner = between("a", Some(&middle));
    assert_eq!(inner, "a9");
    assert!("a" < inner.as_str() && inner < middle);
}
