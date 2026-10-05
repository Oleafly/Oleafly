use gtk::gdk::ModifierType;

pub(super) fn shortcut_key(key: Option<char>, state: ModifierType) -> Option<char> {
    let others = ModifierType::SHIFT_MASK | ModifierType::MOD1_MASK | ModifierType::SUPER_MASK;
    if !state.contains(ModifierType::CONTROL_MASK) || state.intersects(others) {
        return None;
    }
    key.filter(|key| matches!(key, 'l' | 't' | 'w' | 'r'))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn routes_only_the_four_plain_ctrl_shortcuts() {
        let ctrl = ModifierType::CONTROL_MASK;
        for key in ['l', 't', 'w', 'r'] {
            assert_eq!(shortcut_key(Some(key), ctrl), Some(key));
        }
        assert_eq!(shortcut_key(Some('a'), ctrl), None);
        assert_eq!(shortcut_key(None, ctrl), None);
        assert_eq!(shortcut_key(Some('t'), ModifierType::empty()), None);
        assert_eq!(
            shortcut_key(Some('t'), ctrl | ModifierType::SHIFT_MASK),
            None
        );
        assert_eq!(
            shortcut_key(Some('t'), ctrl | ModifierType::MOD1_MASK),
            None
        );
        assert_eq!(
            shortcut_key(Some('t'), ctrl | ModifierType::SUPER_MASK),
            None
        );
        assert_eq!(
            shortcut_key(Some('t'), ctrl | ModifierType::MOD2_MASK),
            Some('t')
        );
    }
}
