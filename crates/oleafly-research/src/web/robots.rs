//! robots.txt matching per RFC 9309: the most specific user-agent group
//! (merged when several match), the longest matching rule, `Allow` winning
//! ties, `*` wildcards and the `$` end anchor.

#[derive(Debug, Clone, PartialEq, Eq)]
struct Rule {
    allow: bool,
    pattern: String,
}

#[derive(Debug, Clone, Default)]
struct Group {
    agents: Vec<String>,
    rules: Vec<Rule>,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct Robots {
    groups: Vec<Group>,
}

fn pattern_matches(pattern: &str, path: &str) -> bool {
    let (pattern, anchored) = match pattern.strip_suffix('$') {
        Some(rest) => (rest, true),
        None => (pattern, false),
    };
    let pieces: Vec<&str> = pattern.split('*').collect();
    let mut position = 0usize;
    for (index, piece) in pieces.iter().enumerate() {
        if index == 0 {
            if !path.starts_with(piece) {
                return false;
            }
            position = piece.len();
            continue;
        }
        let last = index == pieces.len() - 1;
        if last && anchored {
            return path.len() >= position + piece.len() && path.ends_with(piece);
        }
        match path[position..].find(piece) {
            Some(found) => position += found + piece.len(),
            None => return false,
        }
    }
    !anchored || position == path.len()
}

impl Robots {
    pub(crate) fn allow_all() -> Robots {
        Robots::default()
    }

    pub(crate) fn disallow_all() -> Robots {
        Robots {
            groups: vec![Group {
                agents: vec!["*".into()],
                rules: vec![Rule {
                    allow: false,
                    pattern: "/".into(),
                }],
            }],
        }
    }

    pub(crate) fn parse(text: &str) -> Robots {
        // RFC 9309 allows a byte order mark in front of the file; left in, it
        // sticks to the first key and the first group is never opened.
        let text = text.strip_prefix('\u{feff}').unwrap_or(text);
        let mut groups: Vec<Group> = Vec::new();
        let mut current: Option<Group> = None;
        let mut last_was_agent = false;
        for line in text.lines() {
            let line = line.split('#').next().unwrap_or_default().trim();
            let Some((key, value)) = line.split_once(':') else {
                continue;
            };
            let key = key.trim().to_ascii_lowercase();
            let value = value.trim();
            match key.as_str() {
                "user-agent" => {
                    if !last_was_agent {
                        if let Some(group) = current.take() {
                            groups.push(group);
                        }
                        current = Some(Group::default());
                    }
                    if let Some(group) = current.as_mut() {
                        group.agents.push(value.to_ascii_lowercase());
                    }
                    last_was_agent = true;
                }
                "allow" | "disallow" => {
                    last_was_agent = false;
                    let Some(group) = current.as_mut() else {
                        continue;
                    };
                    if value.is_empty() {
                        continue;
                    }
                    group.rules.push(Rule {
                        allow: key == "allow",
                        pattern: value.to_string(),
                    });
                }
                _ => {
                    last_was_agent = false;
                }
            }
        }
        if let Some(group) = current {
            groups.push(group);
        }
        Robots { groups }
    }

    pub(crate) fn allows(&self, product_token: &str, path_and_query: &str) -> bool {
        if path_and_query == "/robots.txt" {
            return true;
        }
        let token = product_token
            .split('/')
            .next()
            .unwrap_or(product_token)
            .to_ascii_lowercase();
        let named: Vec<&Group> = self
            .groups
            .iter()
            .filter(|group| group.agents.contains(&token))
            .collect();
        let groups: Vec<&Group> = if named.is_empty() {
            self.groups
                .iter()
                .filter(|group| group.agents.iter().any(|agent| agent == "*"))
                .collect()
        } else {
            named
        };
        let mut best: Option<&Rule> = None;
        for rule in groups.iter().flat_map(|group| &group.rules) {
            if !pattern_matches(&rule.pattern, path_and_query) {
                continue;
            }
            best = match best {
                None => Some(rule),
                Some(current) if rule.pattern.len() > current.pattern.len() => Some(rule),
                Some(current) if rule.pattern.len() == current.pattern.len() && rule.allow => {
                    Some(rule)
                }
                keep => keep,
            };
        }
        best.is_none_or(|rule| rule.allow)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_most_specific_group_applies_and_longest_rule_wins() {
        let robots = Robots::parse(
            "User-agent: *\nDisallow: /private\nAllow: /private/public\n\nUser-agent: Oleafly\nDisallow: /no-oleafly\n",
        );
        assert!(robots.allows("Oleafly", "/private/x"));
        assert!(!robots.allows("Oleafly", "/no-oleafly/a"));
        assert!(!robots.allows("OtherBot", "/private/x"));
        assert!(robots.allows("OtherBot", "/private/public/y"));
    }

    #[test]
    fn wildcards_anchors_and_ties_follow_rfc_9309() {
        let robots = Robots::parse("User-agent: *\nDisallow: /*.pdf$\nDisallow: /a\nAllow: /a\n");
        assert!(!robots.allows("Oleafly", "/x/y.pdf"));
        assert!(robots.allows("Oleafly", "/x/y.pdf?v=1"));
        assert!(robots.allows("Oleafly", "/a"));
        assert!(Robots::parse("User-agent: *\nDisallow:\n").allows("Oleafly", "/anything"));
        assert!(
            Robots::parse("user-agent: OLEAFLY\ndisallow: /\n").allows("Oleafly", "/robots.txt")
        );
        assert!(!Robots::parse("user-agent: OLEAFLY\ndisallow: /\n").allows("Oleafly/0.4.8", "/x"));
    }

    #[test]
    fn a_byte_order_mark_does_not_hide_the_first_group() {
        let robots = Robots::parse("\u{feff}User-agent: *\nDisallow: /secret\n");
        assert!(!robots.allows("Oleafly", "/secret/page"));
        assert!(robots.allows("Oleafly", "/open"));
    }

    #[test]
    fn several_agents_share_one_group_and_comments_are_ignored() {
        let robots = Robots::parse(
            "User-agent: a\nUser-agent: oleafly # us\nDisallow: /secret\n\nUser-agent: *\nDisallow: /\n",
        );
        assert!(!robots.allows("Oleafly", "/secret/1"));
        assert!(robots.allows("Oleafly", "/open"));
        assert!(!robots.allows("Someone", "/open"));
        assert!(!Robots::disallow_all().allows("Oleafly", "/x"));
        assert!(Robots::allow_all().allows("Oleafly", "/x"));
    }
}
