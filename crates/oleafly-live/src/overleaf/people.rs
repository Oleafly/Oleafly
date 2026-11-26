use oleafly_collab_protocol::projects::ProjectRole;
use oleafly_online::live::session::{Person, Standing};

use super::{port, OverleafLive};
use crate::live::payloads::{MemberStanding, OverleafMember, OverleafPerson};

pub fn person_name(first: &str, last: &str, email: &str) -> Option<String> {
    let name = format!("{} {}", first.trim(), last.trim());
    let name = name.trim();
    if !name.is_empty() {
        return Some(name.to_owned());
    }
    let email = email.trim();
    (!email.is_empty()).then(|| email.to_owned())
}

fn standing_of(standing: Standing, link_shared: bool) -> MemberStanding {
    match standing {
        Standing::Member => MemberStanding::Member,
        Standing::Invited => MemberStanding::Invited,
        Standing::Former if link_shared => MemberStanding::Unlisted,
        Standing::Former => MemberStanding::Former,
    }
}

fn member_of(person: Person, link_shared: bool) -> OverleafMember {
    OverleafMember {
        person: OverleafPerson {
            display_name: person_name(&person.first_name, &person.last_name, &person.email)
                .unwrap_or_default(),
            account_id: person.id,
            avatar_url: None,
            email: Some(person.email).filter(|email| !email.is_empty()),
            login: None,
        },
        role: person.role.map_or(ProjectRole::Unknown, port::project_role),
        granted_at: 0,
        standing: standing_of(person.standing, link_shared),
    }
}

impl OverleafLive {
    pub fn members(&self) -> Vec<OverleafMember> {
        let people = self.session.people();
        people
            .people
            .into_iter()
            .map(|person| member_of(person, people.link_shared))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use oleafly_online::realtime::project::Role;

    use super::*;

    fn person(standing: Standing, first: &str, email: &str) -> Person {
        Person {
            id: "6b04e5f6c0ffee0030000001".into(),
            first_name: first.into(),
            last_name: String::new(),
            email: email.into(),
            role: matches!(standing, Standing::Member | Standing::Invited).then_some(Role::Editor),
            standing,
        }
    }

    #[test]
    fn names_are_first_and_last_else_the_email() {
        assert_eq!(
            person_name(" Ada ", " Lovelace ", "ada@oleafly.edu").as_deref(),
            Some("Ada Lovelace")
        );
        assert_eq!(
            person_name("", "Lovelace", "ada@oleafly.edu").as_deref(),
            Some("Lovelace")
        );
        assert_eq!(
            person_name(" ", "", " ada@oleafly.edu ").as_deref(),
            Some("ada@oleafly.edu")
        );
        assert_eq!(person_name("", "", ""), None);
    }

    #[test]
    fn standing_goes_out_lowercase_and_names_off_the_roster_are_unlisted_on_link_shared_projects() {
        let rows = [
            (
                person(Standing::Member, "Bob", "bob@oleafly.edu"),
                false,
                "member",
                "editor",
            ),
            (
                person(Standing::Invited, "", "ivy@oleafly.edu"),
                false,
                "invited",
                "editor",
            ),
            (
                person(Standing::Former, "Hana", ""),
                false,
                "former",
                "unknown",
            ),
            (
                person(Standing::Former, "Hana", ""),
                true,
                "unlisted",
                "unknown",
            ),
        ];
        for (person, link_shared, standing, role) in rows {
            let wire = serde_json::to_value(member_of(person, link_shared)).unwrap();
            assert_eq!(wire["standing"], standing, "{wire}");
            assert_eq!(wire["role"], role, "{wire}");
            assert!(wire["person"]["display_name"]
                .as_str()
                .is_some_and(|name| !name.is_empty()));
        }
        let invited = serde_json::to_value(member_of(
            person(Standing::Invited, "", "ivy@oleafly.edu"),
            false,
        ))
        .unwrap();
        assert_eq!(invited["person"]["display_name"], "ivy@oleafly.edu");
    }
}
