//! `server status`, `projects`, `share` and `members`.
use std::collections::BTreeMap;
use std::path::Path;

use oleafly_collab::{load_binding, test_connection, ServerUrl};
use oleafly_collab_protocol::ids::{AccountId, SharedProjectId};
use oleafly_collab_protocol::projects::{
    project_role_allows, PersonSummary, ProjectAction, ProjectMember, ProjectPatch, ProjectSummary,
};
use serde_json::{json, Value};

use super::account::{status_lines, status_rows, CliCollab, ServerLink};
use super::target::{resolve_target, SharedTarget};
use super::{role_name, MembersAction, ProjectArgs, ShareArgs, StatusArgs};
use crate::auth::shared::{one_line, Env, Report};
use crate::contract::{CliError, ErrorKind};

/// The address people open to join a shared project.
pub(crate) fn share_link(server_url: &str, shared: SharedProjectId) -> String {
    format!("{}/p/{shared}", server_url.trim_end_matches('/'))
}

fn not_owner() -> CliError {
    CliError::new(
        ErrorKind::Auth,
        "server.not_owner",
        "Only the project's owner can do that.",
    )
}

/// `server status`: servers and sign-ins, `--check` results, and this
/// folder's sharing.
pub(crate) async fn status(
    collab: &CliCollab,
    env: &Env,
    folder: &Path,
    args: &StatusArgs,
) -> Result<Report, CliError> {
    let mut rows = status_rows(env)?;
    if let Some(which) = &args.which {
        let wanted = which.trim();
        let url = ServerUrl::parse(wanted)
            .ok()
            .map(|url| url.as_str().to_string());
        rows.retain(|row| {
            row["serverId"] == wanted
                || url.as_deref().is_some_and(|url| row["url"] == url)
                || row["name"]
                    .as_str()
                    .is_some_and(|name| name.eq_ignore_ascii_case(wanted))
        });
        if rows.is_empty() {
            return Err(CliError::new(
                ErrorKind::Usage,
                "server.unknown",
                format!("No collaboration server matches \"{wanted}\"."),
            )
            .hint("Run oleafly server status to see your servers."));
        }
    }
    let mut lines = Vec::new();
    if rows.is_empty() {
        lines.push(
            "No collaboration servers yet. Sign in with oleafly server sign-in <address>."
                .to_string(),
        );
    }
    for row in &mut rows {
        lines.extend(status_lines(row));
        if args.check {
            let Some(url) = row["url"]
                .as_str()
                .and_then(|url| ServerUrl::parse(url).ok())
            else {
                continue;
            };
            let checks = test_connection(&url).await;
            for check in &checks {
                let id = serde_json::to_value(check.id)
                    .ok()
                    .and_then(|value| value.as_str().map(str::to_string))
                    .unwrap_or_default();
                let status = serde_json::to_value(check.status)
                    .ok()
                    .and_then(|value| value.as_str().map(str::to_string))
                    .unwrap_or_default();
                let detail = check
                    .detail
                    .as_deref()
                    .map(|detail| format!(": {detail}"))
                    .unwrap_or_default();
                lines.push(format!("    {id}: {status}{detail}"));
            }
            row["checks"] = json!(checks);
        }
    }
    let mut data = json!({"servers": rows});
    if let Ok(target) = resolve_target(collab, env, folder, &ProjectArgs::default()) {
        let link = share_link(&target.entry.url, target.shared);
        let role = target.saved_role.map(role_name);
        lines.push(String::new());
        lines.push(match role {
            Some(role) => format!("This folder is shared as {link} (you're the {role})."),
            None => format!("This folder is shared as {link}."),
        });
        data["project"] = json!({"server": target.entry.url, "sharedProjectId": target.shared.to_string(), "role": role, "link": link});
    }
    Ok(Report::new(data).lines(lines))
}

/// Shared ID → the app project that keeps it.
fn local_projects(collab: &CliCollab) -> BTreeMap<SharedProjectId, String> {
    let Ok(entries) = std::fs::read_dir(collab.app_paths.root()) else {
        return BTreeMap::new();
    };
    entries
        .flatten()
        .filter_map(|entry| {
            let id = entry.file_name().to_str()?.to_string();
            let binding = load_binding(&collab.app_paths, &id).ok()??;
            Some((binding.shared_project_id, id))
        })
        .collect()
}

fn project_row(server: &str, project: &ProjectSummary, local: Option<&String>) -> Value {
    let mut row = json!({
        "server": server,
        "sharedProjectId": project.project_id.to_string(),
        "title": project.title,
        "owner": project.owner.display_name,
        "role": role_name(project.role),
        "status": project.status,
        "linkSharing": project.link_sharing,
        "linkRole": role_name(project.link_role),
        "commentsEnabled": project.comments_enabled,
    });
    if let Some(local) = local {
        row["local"] = json!(local);
    }
    row
}

/// `server projects`: shared projects on every server this command line
/// is signed in to (or one, with `--server`).
pub(crate) async fn projects(collab: &CliCollab, server: Option<&str>) -> Result<Report, CliError> {
    let entries = match server {
        Some(which) => vec![collab.find_server(which)?],
        None => {
            let registry = collab.registry()?;
            let mut signed_in = Vec::new();
            for entry in registry.list() {
                if collab.cli_signed_in(entry.server_id)? {
                    signed_in.push(entry.clone());
                }
            }
            signed_in
        }
    };
    if entries.is_empty() {
        return Ok(Report::new(json!({"projects": []})).line("This command line isn't signed in to any server. Run oleafly server sign-in <address>."));
    }
    let local = local_projects(collab);
    let mut listings = Vec::new();
    for entry in entries {
        let link = collab.link_to(entry)?;
        let result = link
            .call(|client, access| async move { client.projects(&access).await })
            .await;
        listings.push(ServerListing {
            name: link.entry.name.clone(),
            url: link.entry.url.clone(),
            result,
        });
    }
    listing_report(listings, &local)
}

/// One server's answer to the list of shared projects.
struct ServerListing {
    name: String,
    url: String,
    result: Result<Vec<ProjectSummary>, CliError>,
}

/// The projects of every server that answered. A server that didn't is a
/// warning, so the others still show; when none answered, it is an error.
fn listing_report(
    listings: Vec<ServerListing>,
    local: &BTreeMap<SharedProjectId, String>,
) -> Result<Report, CliError> {
    let total = listings.len();
    let mut rows = Vec::new();
    let mut lines = Vec::new();
    let mut failures: Vec<(String, String, CliError)> = Vec::new();
    for listing in listings {
        let listed = match listing.result {
            Ok(listed) => listed,
            Err(error) => {
                failures.push((listing.name, listing.url, error));
                continue;
            }
        };
        for project in &listed {
            let here = local.get(&project.project_id);
            // Titles and names come from other people's accounts: each stays
            // on its line.
            let mut line = format!(
                "{}  {} — {} on {}",
                project.project_id,
                one_line(&project.title),
                role_name(project.role),
                one_line(&listing.name)
            );
            if let Some(here) = here {
                line.push_str(&format!(" (in the Oleafly app as {here})"));
            }
            lines.push(line);
            rows.push(project_row(&listing.url, project, here));
        }
    }
    if failures.len() == total {
        return Err(failures.swap_remove(0).2);
    }
    if rows.is_empty() && failures.is_empty() {
        lines.push("No shared projects yet.".to_string());
    }
    let mut data = json!({"projects": rows});
    if !failures.is_empty() {
        data["failed"] = failures
            .iter()
            .map(|(_, url, error)| {
                json!({"server": url, "error": {"code": error.code, "message": error.message}})
            })
            .collect();
    }
    let mut report = Report::new(data).lines(lines);
    for (name, _, error) in &failures {
        report = report.warning(
            "server.projects_unavailable",
            format!(
                "Couldn't list the projects on {}: {}",
                one_line(name),
                one_line(&error.message)
            ),
        );
    }
    Ok(report)
}

async fn summary_of(
    link: &ServerLink,
    shared: SharedProjectId,
) -> Result<ProjectSummary, CliError> {
    link.call(|client, access| async move { client.project(&access, shared).await })
        .await
}

/// `server share`: shows the link and switches; with flags, changes them
/// (owner only).
pub(crate) async fn share(
    collab: &CliCollab,
    target: &SharedTarget,
    args: &ShareArgs,
) -> Result<Report, CliError> {
    let link = collab.link_to(target.entry.clone())?;
    let shared = target.shared;
    let current = summary_of(&link, shared).await?;
    let patch = ProjectPatch {
        link_sharing: args
            .link
            .map(|switch| switch.on())
            .filter(|wanted| *wanted != current.link_sharing),
        link_role: args
            .link_role
            .map(|role| role.role())
            .filter(|wanted| *wanted != current.link_role),
        comments_enabled: args
            .comments
            .map(|switch| switch.on())
            .filter(|wanted| *wanted != current.comments_enabled),
        ..ProjectPatch::default()
    };
    let mut changed = Vec::new();
    if patch.link_sharing.is_some() {
        changed.push("linkSharing");
    }
    if patch.link_role.is_some() {
        changed.push("linkRole");
    }
    if patch.comments_enabled.is_some() {
        changed.push("commentsEnabled");
    }
    let asked = args.link.is_some() || args.link_role.is_some() || args.comments.is_some();
    if asked && !project_role_allows(current.role, ProjectAction::ChangeLinkSharing) {
        return Err(not_owner());
    }
    let after = if changed.is_empty() || args.dry_run {
        current
    } else {
        link.call(|client, access| {
            let patch = patch.clone();
            async move { client.patch_project(&access, shared, &patch).await }
        })
        .await?
    };
    let address = share_link(&link.entry.url, shared);
    let mut lines = vec![format!("{} — {}", one_line(&after.title), address)];
    lines.push(if after.link_sharing {
        format!("Link sharing is on for {}s.", role_name(after.link_role))
    } else {
        "Link sharing is off.".to_string()
    });
    lines.push(
        if after.comments_enabled {
            "Comments are on."
        } else {
            "Comments are off."
        }
        .to_string(),
    );
    if args.dry_run && !changed.is_empty() {
        lines.push(format!(
            "Dry run: would change {}. Nothing was changed.",
            changed.join(", ")
        ));
    }
    Ok(Report::new(json!({
        "server": link.entry.url,
        "sharedProjectId": shared.to_string(),
        "title": after.title,
        "link": address,
        "role": role_name(after.role),
        "linkSharing": after.link_sharing,
        "linkRole": role_name(after.link_role),
        "commentsEnabled": after.comments_enabled,
        "changed": changed,
        "dryRun": args.dry_run,
    }))
    .lines(lines))
}

fn member_row(member: &ProjectMember) -> Value {
    json!({
        "accountId": member.person.account_id.to_string(),
        "name": member.person.display_name,
        "email": member.person.email,
        "login": member.person.login,
        "role": role_name(member.role),
        "guest": member.person.guest,
        "grantedAt": member.granted_at,
    })
}

fn matches_person(person: &PersonSummary, who: &str) -> bool {
    let who = who.trim();
    person
        .email
        .as_deref()
        .is_some_and(|email| email.eq_ignore_ascii_case(who))
        || person.login.as_deref().is_some_and(|login| {
            login.eq_ignore_ascii_case(who) || format!("@{login}").eq_ignore_ascii_case(who)
        })
        || person.account_id.to_string() == who
}

/// The one person on the server `who` names.
pub(crate) fn one_person(
    people: &[PersonSummary],
    who: &str,
    server: &str,
) -> Result<PersonSummary, CliError> {
    let found: Vec<&PersonSummary> = people
        .iter()
        .filter(|person| matches_person(person, who))
        .collect();
    match found.as_slice() {
        [person] => Ok((*person).clone()),
        [] => Err(CliError::new(
            ErrorKind::InvalidInput,
            "server.no_such_person",
            format!("No one on {server} matches {who}."),
        )
        .hint("Ask them to sign in to the server once, then try again.")),
        many => {
            let names: Vec<&str> = many
                .iter()
                .map(|person| person.display_name.as_str())
                .collect();
            Err(CliError::new(
                ErrorKind::Usage,
                "server.ambiguous_person",
                format!("{} people match {who}: {}.", many.len(), names.join(", ")),
            )
            .hint("Use their email address."))
        }
    }
}

/// A member of the project by email, login, ID or (unique) name.
fn one_member<'a>(
    members: &'a [ProjectMember],
    who: &str,
    server: &str,
) -> Result<&'a ProjectMember, CliError> {
    let by_identity: Vec<&ProjectMember> = members
        .iter()
        .filter(|member| matches_person(&member.person, who))
        .collect();
    let found = if by_identity.is_empty() {
        members
            .iter()
            .filter(|member| member.person.display_name.eq_ignore_ascii_case(who.trim()))
            .collect()
    } else {
        by_identity
    };
    match found.as_slice() {
        [member] => Ok(member),
        [] => Err(CliError::new(
            ErrorKind::InvalidInput,
            "server.no_such_person",
            format!("No one on this project at {server} matches {who}."),
        )
        .hint("Run oleafly server members to see who is on it.")),
        many => Err(CliError::new(
            ErrorKind::Usage,
            "server.ambiguous_person",
            format!("{} people match {who}.", many.len()),
        )
        .hint("Use their email address.")),
    }
}

/// `server members` and its `add`, `remove` and `role`.
pub(crate) async fn members(
    collab: &CliCollab,
    target: &SharedTarget,
    action: MembersAction,
) -> Result<Report, CliError> {
    let link = collab.link_to(target.entry.clone())?;
    let shared = target.shared;
    let server = link.entry.url.clone();
    let listed = link
        .call(|client, access| async move { client.members(&access, shared).await })
        .await?;
    if matches!(action, MembersAction::List) {
        let lines = listed
            .iter()
            .map(|member| {
                let contact = member
                    .person
                    .email
                    .as_deref()
                    .or(member.person.login.as_deref())
                    .map(|contact| format!(" <{}>", one_line(contact)))
                    .unwrap_or_default();
                format!(
                    "{}{contact} — {}",
                    one_line(&member.person.display_name),
                    role_name(member.role)
                )
            })
            .collect::<Vec<_>>();
        return Ok(Report::new(
            json!({"members": listed.iter().map(member_row).collect::<Vec<_>>()}),
        )
        .lines(lines));
    }
    let current = summary_of(&link, shared).await?;
    if !project_role_allows(current.role, ProjectAction::ManageMembers) {
        return Err(not_owner());
    }
    let (person, change, role, dry_run): (
        PersonSummary,
        &str,
        Option<oleafly_collab_protocol::roles::ProjectRole>,
        bool,
    ) = match &action {
        MembersAction::Add { who, role, dry_run } => {
            let query = who.clone();
            let people = link
                .call(|client, access| {
                    let query = query.clone();
                    async move { client.directory(&access, &query).await }
                })
                .await?;
            (
                one_person(&people, who, &server)?,
                "added",
                Some(role.role()),
                *dry_run,
            )
        }
        MembersAction::Remove { who, dry_run } => (
            one_member(&listed, who, &server)?.person.clone(),
            "removed",
            None,
            *dry_run,
        ),
        MembersAction::Role { who, role, dry_run } => (
            one_member(&listed, who, &server)?.person.clone(),
            "role",
            Some(role.role()),
            *dry_run,
        ),
        MembersAction::List => unreachable!("handled above"),
    };
    let account: AccountId = person.account_id;
    if !dry_run {
        match role {
            Some(role) => {
                link.call(|client, access| async move {
                    client.grant_member(&access, shared, account, role).await
                })
                .await?;
            }
            None => {
                link.call(|client, access| async move {
                    client.remove_member(&access, shared, account).await
                })
                .await?;
            }
        }
    }
    let who = one_line(
        &person
            .email
            .clone()
            .or(person.login.clone())
            .unwrap_or_else(|| person.display_name.clone()),
    );
    let line = match (change, role, dry_run) {
        (_, _, true) => format!("Dry run: nothing changed for {who}."),
        ("added", Some(role), false) => format!("Added {who} as {}.", role_name(role)),
        ("removed", _, false) => format!("Removed {who}."),
        (_, Some(role), false) => format!("{who} is now {}.", role_name(role)),
        _ => String::new(),
    };
    Ok(Report::new(json!({
        "member": {"accountId": account.to_string(), "name": person.display_name, "email": person.email, "role": role.map(role_name)},
        "change": change,
        "dryRun": dry_run,
    }))
    .line(line))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn person(name: &str, email: &str, login: &str) -> PersonSummary {
        PersonSummary {
            account_id: AccountId::new_v7(),
            display_name: name.into(),
            avatar_url: None,
            email: Some(email.into()),
            login: Some(login.into()),
            guest: false,
            active: true,
        }
    }

    #[test]
    fn people_are_found_by_email_or_login_only_when_unique() {
        let people = [
            person("Alice Chen", "alice@uni.edu", "alice"),
            person("Alice Wu", "awu@uni.edu", "awu"),
        ];
        assert_eq!(
            one_person(&people, "ALICE@uni.edu", "lab")
                .unwrap()
                .display_name,
            "Alice Chen"
        );
        assert_eq!(
            one_person(&people, "@awu", "lab").unwrap().display_name,
            "Alice Wu"
        );
        let missing = one_person(&people, "nobody@x.edu", "lab").unwrap_err();
        assert_eq!(
            (missing.code.as_ref(), missing.exit() as u8),
            ("server.no_such_person", 3)
        );
        let twins = [
            person("A", "same@uni.edu", "a1"),
            person("B", "same@uni.edu", "b1"),
        ];
        assert_eq!(
            one_person(&twins, "same@uni.edu", "lab").unwrap_err().code,
            "server.ambiguous_person"
        );
    }

    fn listed_project(title: &str) -> ProjectSummary {
        ProjectSummary {
            project_id: SharedProjectId::new_v7(),
            title: title.into(),
            owner: person("Owner", "o@uni.edu", "owner"),
            role: oleafly_collab_protocol::projects::ProjectRole::Editor,
            status: oleafly_collab_protocol::projects::ProjectStatus::Active,
            created_at: 0,
            link_sharing: false,
            link_role: oleafly_collab_protocol::projects::ProjectRole::Viewer,
            head_seq: 0,
            comments_enabled: true,
            access_log: false,
        }
    }

    fn down(name: &str) -> ServerListing {
        ServerListing {
            name: name.into(),
            url: format!("https://{name}.example.edu"),
            result: Err(CliError::new(
                ErrorKind::Network,
                "server.unreachable",
                format!("https://{name}.example.edu couldn't be reached."),
            )),
        }
    }

    fn up(name: &str, titles: &[&str]) -> ServerListing {
        ServerListing {
            name: name.into(),
            url: format!("https://{name}.example.edu"),
            result: Ok(titles.iter().map(|title| listed_project(title)).collect()),
        }
    }

    #[test]
    fn one_server_being_down_does_not_hide_the_others() {
        let report = listing_report(
            vec![down("lab"), up("dept", &["Thesis", "Paper"])],
            &BTreeMap::new(),
        )
        .unwrap();
        assert_eq!(report.data["projects"].as_array().unwrap().len(), 2);
        assert_eq!(
            report.data["failed"][0]["server"],
            "https://lab.example.edu"
        );
        assert_eq!(
            report.data["failed"][0]["error"]["code"],
            "server.unreachable"
        );
        assert_eq!(report.lines.len(), 2);
        assert_eq!(report.warnings.len(), 1);
        assert_eq!(report.warnings[0].code, "server.projects_unavailable");
        assert!(report.warnings[0].message.contains("lab"));
        // When every server answers, nothing is marked as failed.
        let clean = listing_report(vec![up("dept", &["Thesis"])], &BTreeMap::new()).unwrap();
        assert!(clean.data.get("failed").is_none());
        assert!(clean.warnings.is_empty());
        let empty = listing_report(vec![up("dept", &[])], &BTreeMap::new()).unwrap();
        assert_eq!(empty.lines, vec!["No shared projects yet.".to_string()]);
    }

    #[test]
    fn when_no_server_answers_it_is_an_error() {
        let error = listing_report(vec![down("lab"), down("dept")], &BTreeMap::new()).unwrap_err();
        assert_eq!(error.code, "server.unreachable");
    }

    #[test]
    fn a_project_title_stays_on_its_own_line() {
        let report = listing_report(
            vec![up(
                "dept",
                &["Real\n01920000-0000-7000-8000-0000000000ff  Fake\u{1b}[2J"],
            )],
            &BTreeMap::new(),
        )
        .unwrap();
        assert_eq!(report.lines.len(), 1);
        assert!(!report.lines[0].contains(['\n', '\u{1b}']));
    }

    #[test]
    fn share_links_follow_the_app() {
        let shared: SharedProjectId = "01920000-0000-7000-8000-0000000000aa".parse().unwrap();
        assert_eq!(
            share_link("https://uni.edu/oleafly/", shared),
            "https://uni.edu/oleafly/p/01920000-0000-7000-8000-0000000000aa"
        );
    }
}
