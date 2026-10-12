use std::fmt::Display;

use chrono::{DateTime, Local, TimeZone};
use oleafly_collab_protocol::ids::SharedProjectId;
use oleafly_collab_protocol::roles::{ProjectRole, ServerRole};
use url::Url;

use crate::routes::landing::{open_link, DOWNLOAD_URL};

const MAX_SUBJECT_PART: usize = 80;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Content {
    pub subject: String,
    pub text: String,
    pub html: String,
}

pub fn server_address(public_url: &Url) -> String {
    public_url.as_str().trim_end_matches('/').to_string()
}

pub fn add_server_link(public_url: &Url) -> String {
    let mut link = Url::parse("oleafly://server/add").expect("a fixed URL parses");
    link.query_pairs_mut()
        .append_pair("url", &server_address(public_url));
    link.to_string()
}

pub fn landing_page(public_url: &Url, project: SharedProjectId) -> String {
    crate::config::join_url(public_url, &format!("/p/{project}")).to_string()
}

pub fn one_line(text: &str, limit: usize) -> String {
    let cleaned: String = text
        .chars()
        .map(|character| {
            if character.is_control() {
                ' '
            } else {
                character
            }
        })
        .collect();
    let words: Vec<&str> = cleaned.split_whitespace().collect();
    let joined = words.join(" ");
    if joined.chars().count() <= limit {
        return joined;
    }
    let mut cut: String = joined.chars().take(limit.saturating_sub(1)).collect();
    cut.push('…');
    cut
}

pub fn escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

pub fn platform_label(platform: &str) -> String {
    match platform.trim().to_ascii_lowercase().as_str() {
        "macos" | "darwin" => "macOS".to_string(),
        "windows" => "Windows".to_string(),
        "linux" => "Linux".to_string(),
        _ => one_line(platform, 40),
    }
}

pub fn format_time<Tz: TimeZone>(at: &DateTime<Tz>) -> String
where
    Tz::Offset: Display,
{
    let offset = at.format("%:z").to_string();
    let zone = if offset == "+00:00" {
        "UTC".to_string()
    } else {
        format!("UTC{offset}")
    };
    format!("{} ({zone})", at.format("%A %-d %B %Y at %H:%M"))
}

pub fn local_time(at_ms: i64) -> String {
    match Local.timestamp_millis_opt(at_ms).single() {
        Some(at) => format_time(&at),
        None => format!("{at_ms} ms after 1970 (UTC)"),
    }
}

fn server_role_words(role: ServerRole) -> &'static str {
    match role {
        ServerRole::Admin => "an admin",
        ServerRole::Maintainer => "a maintainer",
        ServerRole::Member => "a member",
        ServerRole::Guest => "a guest",
    }
}

fn project_role_words(role: ProjectRole) -> &'static str {
    match role {
        ProjectRole::Owner => "You're its owner.",
        ProjectRole::Editor => "You're an editor, so you can change it.",
        ProjectRole::Viewer => "You're a viewer, so you can read it but not change it.",
    }
}

enum Block {
    Heading(String),
    Paragraph(String),
    Button { label: &'static str, href: String },
    Address(String),
    Details(Vec<(&'static str, String)>),
    Footer(String),
}

fn render(blocks: &[Block]) -> (String, String) {
    let mut text = Vec::new();
    let mut html = String::from(
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"></head>\
<body style=\"margin:0;padding:1.5rem 1rem;background:#f4f5f7;color:#1f2933;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif\">\
<div style=\"max-width:32rem;margin:0 auto;padding:1.5rem;background:#ffffff;border:1px solid #dde1e6;border-radius:0.5rem\">",
    );
    for block in blocks {
        match block {
            Block::Heading(heading) => {
                text.push(heading.clone());
                html.push_str(&format!(
                    "<h1 style=\"margin:0 0 1rem;font-size:1.15rem;line-height:1.4\">{}</h1>",
                    escape(heading)
                ));
            }
            Block::Paragraph(paragraph) => {
                text.push(paragraph.clone());
                html.push_str(&format!(
                    "<p style=\"margin:0 0 0.75rem;font-size:0.95rem;line-height:1.5\">{}</p>",
                    escape(paragraph)
                ));
            }
            Block::Button { label, href } => {
                text.push(format!("{label}:\n{href}"));
                html.push_str(&format!(
                    "<p style=\"margin:1rem 0\"><a href=\"{}\" style=\"display:inline-block;padding:0.6rem 1rem;border-radius:0.4rem;background:#1f2933;color:#ffffff;text-decoration:none;font-size:0.95rem\">{label}</a></p>",
                    escape(href)
                ));
            }
            Block::Address(address) => {
                text.push(address.clone());
                html.push_str(&format!(
                    "<p style=\"margin:0 0 0.75rem;padding:0.5rem 0.75rem;background:#f4f5f7;border-radius:0.4rem;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:0.9rem;word-break:break-all\">{}</p>",
                    escape(address)
                ));
            }
            Block::Details(rows) => {
                text.push(
                    rows.iter()
                        .map(|(label, value)| format!("{label}: {value}"))
                        .collect::<Vec<_>>()
                        .join("\n"),
                );
                html.push_str("<table role=\"presentation\" style=\"margin:0 0 0.75rem;border-collapse:collapse;font-size:0.95rem;line-height:1.5\">");
                for (label, value) in rows {
                    html.push_str(&format!(
                        "<tr><td style=\"padding:0 1rem 0 0;color:#5f6b76\">{label}</td><td>{}</td></tr>",
                        escape(value)
                    ));
                }
                html.push_str("</table>");
            }
            Block::Footer(footer) => {
                text.push(footer.clone());
                html.push_str(&format!(
                    "<p style=\"margin:1.25rem 0 0;font-size:0.8rem;line-height:1.5;color:#5f6b76\">{}</p>",
                    escape(footer)
                ));
            }
        }
    }
    html.push_str("</div></body></html>");
    let mut joined = text.join("\n\n");
    joined.push('\n');
    (joined, html)
}

fn content(subject: String, blocks: &[Block]) -> Content {
    let (text, html) = render(blocks);
    Content {
        subject,
        text,
        html,
    }
}

pub fn added_to_server(
    server_name: &str,
    public_url: &Url,
    role: ServerRole,
    address: &str,
) -> Content {
    let server = one_line(server_name, MAX_SUBJECT_PART);
    let heading = format!("You've been added to {server}");
    content(
        heading.clone(),
        &[
            Block::Heading(heading),
            Block::Paragraph(format!(
                "An admin added you to {server}, an Oleafly collaboration server, as {}. You can now sign in there and work on projects people share with you.",
                server_role_words(role)
            )),
            Block::Button {
                label: "Add to Oleafly",
                href: add_server_link(public_url),
            },
            Block::Paragraph(
                "If the button doesn't open Oleafly, open Oleafly yourself, go to Settings > Collaboration, choose Add server and enter this address:"
                    .to_string(),
            ),
            Block::Address(server_address(public_url)),
            Block::Paragraph(format!("Don't have Oleafly yet? Get it at {DOWNLOAD_URL}.")),
            Block::Footer(format!(
                "You got this email because {} was added to {server}.",
                one_line(address, 254)
            )),
        ],
    )
}

pub fn shared_with_you(
    server_name: &str,
    public_url: &Url,
    project: SharedProjectId,
    title: &str,
    sharer: &str,
    role: ProjectRole,
) -> Content {
    let server = one_line(server_name, MAX_SUBJECT_PART);
    let title = one_line(title, MAX_SUBJECT_PART);
    let sharer = one_line(sharer, MAX_SUBJECT_PART);
    let heading = format!("{sharer} shared \"{title}\" with you");
    content(
        heading.clone(),
        &[
            Block::Heading(heading),
            Block::Paragraph(format!(
                "{sharer} shared the project \"{title}\" with you on {server}. {}",
                project_role_words(role)
            )),
            Block::Button {
                label: "Open in Oleafly",
                href: open_link(public_url, project),
            },
            Block::Paragraph(
                "If the button doesn't open Oleafly, open this page in your browser:".to_string(),
            ),
            Block::Address(landing_page(public_url, project)),
            Block::Footer(format!(
                "Don't want these emails? In Oleafly, go to Settings > Collaboration, open {server} and turn off emails about shared projects."
            )),
        ],
    )
}

pub fn new_sign_in(server_name: &str, device: &str, platform: &str, when: &str) -> Content {
    let server = one_line(server_name, MAX_SUBJECT_PART);
    let heading = format!("New sign-in to your account on {server}");
    content(
        heading.clone(),
        &[
            Block::Heading(heading),
            Block::Paragraph(format!(
                "Someone just signed in to your account on {server} from this device:"
            )),
            Block::Details(vec![
                ("Device", one_line(device, 100)),
                ("System", platform_label(platform)),
                ("Time", when.to_string()),
            ]),
            Block::Paragraph("If this was you, there's nothing to do.".to_string()),
            Block::Paragraph(format!(
                "If it wasn't you, open Oleafly on a device you trust, go to Settings > Collaboration, open {server} and sign that device out under Devices. Then tell the server's admin."
            )),
        ],
    )
}

pub fn guest_invitation(
    server_name: &str,
    public_url: &Url,
    title: &str,
    inviter: &str,
    role: ProjectRole,
    address: &str,
) -> Content {
    let server = one_line(server_name, MAX_SUBJECT_PART);
    let title = one_line(title, MAX_SUBJECT_PART);
    let inviter = one_line(inviter, MAX_SUBJECT_PART);
    let address = one_line(address, 254);
    let heading = format!("{inviter} invited you to \"{title}\" on {server}");
    content(
        heading.clone(),
        &[
            Block::Heading(heading),
            Block::Paragraph(format!(
                "{inviter} invited you as a guest to work on the project \"{title}\" on {server}, an Oleafly collaboration server. {}",
                project_role_words(role)
            )),
            Block::Paragraph(format!(
                "Add the server to Oleafly, then sign in with an account that uses {address}. The invitation works once and ends in 14 days."
            )),
            Block::Button {
                label: "Add to Oleafly",
                href: add_server_link(public_url),
            },
            Block::Paragraph(
                "If the button doesn't open Oleafly, open Oleafly yourself, go to Settings > Collaboration, choose Add server and enter this address:"
                    .to_string(),
            ),
            Block::Address(server_address(public_url)),
            Block::Paragraph(format!("Don't have Oleafly yet? Get it at {DOWNLOAD_URL}.")),
            Block::Footer(format!(
                "You got this email because {inviter} invited {address}. If you don't know them, you can ignore it."
            )),
        ],
    )
}

pub fn sign_in_link(server_name: &str, link: &str, same_device: bool) -> Content {
    let server = one_line(server_name, MAX_SUBJECT_PART);
    let heading = format!("Sign in to {server}");
    let mut blocks = vec![
        Block::Heading(heading.clone()),
        Block::Paragraph(format!(
            "Someone asked to sign in to {server} with this email address."
        )),
        Block::Button {
            label: "Sign in",
            href: link.to_string(),
        },
    ];
    if same_device {
        blocks.push(Block::Paragraph(
            "Open the link on the computer where you started signing in. It works once, for 15 minutes."
                .to_string(),
        ));
    } else {
        blocks.push(Block::Paragraph(
            "You can open the link on any device. To finish, type the code Oleafly shows on the computer you're signing in on. The link works once, for 15 minutes."
                .to_string(),
        ));
        blocks.push(Block::Paragraph(
            "If someone gave you a code to type, don't use this link. They're trying to get into your account."
                .to_string(),
        ));
    }
    blocks.push(Block::Paragraph(
        "If the button doesn't work, copy this address into your browser:".to_string(),
    ));
    blocks.push(Block::Address(link.to_string()));
    blocks.push(Block::Footer(
        "If you didn't try to sign in, you can ignore this email. Nobody can sign in without this link."
            .to_string(),
    ));
    content(heading, &blocks)
}

pub fn test_message(server_name: &str) -> Content {
    let server = one_line(server_name, MAX_SUBJECT_PART);
    let heading = format!("Test email from {server}");
    content(
        heading.clone(),
        &[
            Block::Heading(heading),
            Block::Paragraph(format!(
                "This is a test email from {server}. If you can read it, the server can send email."
            )),
            Block::Footer(
                "An admin sent it from Oleafly, under Manage server > Email.".to_string(),
            ),
        ],
    )
}

#[cfg(test)]
mod tests {
    use chrono::FixedOffset;

    use super::*;

    const PROJECT: &str = "01920000-0000-7000-8000-0000000000aa";

    fn url() -> Url {
        Url::parse("https://www.cs.uni.edu/oleafly/").unwrap()
    }

    #[test]
    fn the_add_link_carries_the_plain_server_address() {
        assert_eq!(
            add_server_link(&url()),
            "oleafly://server/add?url=https%3A%2F%2Fwww.cs.uni.edu%2Foleafly"
        );
        assert_eq!(server_address(&url()), "https://www.cs.uni.edu/oleafly");
        assert_eq!(
            landing_page(&url(), PROJECT.parse().unwrap()),
            format!("https://www.cs.uni.edu/oleafly/p/{PROJECT}")
        );
    }

    #[test]
    fn added_to_server_names_the_server_link_and_address() {
        let message = added_to_server("Smith Lab", &url(), ServerRole::Member, "ada@uni.edu");
        assert_eq!(message.subject, "You've been added to Smith Lab");
        for body in [&message.text, &message.html] {
            assert!(body.contains("as a member"), "{body}");
            assert!(body.contains("https://www.cs.uni.edu/oleafly"), "{body}");
            assert!(body.contains("oleafly://server/add?url="), "{body}");
            assert!(body.contains("ada@uni.edu"), "{body}");
        }
        assert!(message.html.contains(">Add to Oleafly</a>"));
    }

    #[test]
    fn shared_with_you_names_the_project_sharer_role_and_both_links() {
        let message = shared_with_you(
            "Smith Lab",
            &url(),
            PROJECT.parse().unwrap(),
            "Reef survey",
            "Ada Lovelace",
            ProjectRole::Viewer,
        );
        assert_eq!(
            message.subject,
            "Ada Lovelace shared \"Reef survey\" with you"
        );
        assert!(message.text.contains("You're a viewer"));
        assert!(message.text.contains(&format!(
            "oleafly://open?server=https%3A%2F%2Fwww.cs.uni.edu%2Foleafly&project={PROJECT}"
        )));
        assert!(message
            .text
            .contains(&format!("https://www.cs.uni.edu/oleafly/p/{PROJECT}")));
        assert!(message
            .text
            .contains("turn off emails about shared projects"));
        let editor = shared_with_you(
            "Smith Lab",
            &url(),
            PROJECT.parse().unwrap(),
            "Reef survey",
            "Ada",
            ProjectRole::Editor,
        );
        assert!(editor.text.contains("You're an editor"));
    }

    #[test]
    fn text_from_people_is_escaped_in_html_and_kept_to_one_line() {
        let message = shared_with_you(
            "Lab\r\nBcc: evil@x.test",
            &url(),
            PROJECT.parse().unwrap(),
            "<script>alert(1)</script> & \"more\"",
            "Eve\n<b>",
            ProjectRole::Editor,
        );
        assert!(!message.subject.contains(['\r', '\n']));
        assert!(message.subject.starts_with("Eve <b> shared"));
        assert!(!message.html.contains("<script>"));
        assert!(message
            .html
            .contains("&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;more&quot;"));
        assert!(!message.html.contains("<b>"));
        assert!(message.text.contains("on Lab Bcc: evil@x.test."));
        let long = shared_with_you(
            "Lab",
            &url(),
            PROJECT.parse().unwrap(),
            &"x".repeat(500),
            "Ada",
            ProjectRole::Editor,
        );
        assert!(long.subject.chars().count() < 120, "{}", long.subject);
    }

    #[test]
    fn new_sign_in_lists_device_system_and_time_and_how_to_sign_it_out() {
        let message = new_sign_in(
            "Smith Lab",
            "Ada's MacBook",
            "macos",
            "Monday 12 October 2026 at 09:30 (UTC-07:00)",
        );
        assert_eq!(message.subject, "New sign-in to your account on Smith Lab");
        assert!(message.text.contains("Device: Ada's MacBook"));
        assert!(message.text.contains("System: macOS"));
        assert!(message
            .text
            .contains("Time: Monday 12 October 2026 at 09:30 (UTC-07:00)"));
        assert!(message.text.contains("sign that device out under Devices"));
        assert!(message.html.contains("Ada&#39;s MacBook"));
    }

    #[test]
    fn times_name_their_offset_and_utc_is_written_as_utc() {
        let pacific = FixedOffset::west_opt(7 * 3600).unwrap();
        let at = pacific.timestamp_millis_opt(1_760_286_600_000).unwrap();
        assert_eq!(
            format_time(&at),
            "Sunday 12 October 2025 at 09:30 (UTC-07:00)"
        );
        let utc = FixedOffset::east_opt(0).unwrap();
        let at = utc.timestamp_millis_opt(1_760_286_600_000).unwrap();
        assert_eq!(format_time(&at), "Sunday 12 October 2025 at 16:30 (UTC)");
        assert!(local_time(1_760_286_600_000).contains("2025"));
    }

    #[test]
    fn platforms_read_as_people_name_them() {
        assert_eq!(platform_label("macos"), "macOS");
        assert_eq!(platform_label("windows"), "Windows");
        assert_eq!(platform_label("linux"), "Linux");
        assert_eq!(platform_label("Plan\n9"), "Plan 9");
    }

    #[test]
    fn a_guest_invitation_names_the_inviter_project_server_address_and_add_link() {
        let message = guest_invitation(
            "Smith Lab",
            &url(),
            "Reef survey",
            "Ada Lovelace",
            ProjectRole::Editor,
            "dana@field.org",
        );
        assert_eq!(
            message.subject,
            "Ada Lovelace invited you to \"Reef survey\" on Smith Lab"
        );
        for body in [&message.text, &message.html] {
            assert!(body.contains("Ada Lovelace"), "{body}");
            assert!(body.contains("Reef survey"), "{body}");
            assert!(body.contains("https://www.cs.uni.edu/oleafly"), "{body}");
            assert!(body.contains("oleafly://server/add?url="), "{body}");
            assert!(body.contains("dana@field.org"), "{body}");
            assert!(body.contains("14 days"), "{body}");
        }
        assert!(message.text.contains("You're an editor"));
        assert!(message.html.contains(">Add to Oleafly</a>"));
        let hostile = guest_invitation(
            "Lab",
            &url(),
            "<b>x</b>",
            "Eve\r\nBcc: x@y.z",
            ProjectRole::Viewer,
            "dana@field.org",
        );
        assert!(!hostile.subject.contains(['\r', '\n']));
        assert!(!hostile.html.contains("<b>x</b>"));
    }

    #[test]
    fn the_sign_in_link_says_how_long_it_works_and_never_names_the_device() {
        let link = "https://collab.uni.edu/auth/email-link/verify?token=abc.def";
        let message = sign_in_link("Smith Lab", link, true);
        assert_eq!(message.subject, "Sign in to Smith Lab");
        assert!(message.text.contains(link), "{}", message.text);
        assert!(message.text.contains("15 minutes"));
        assert!(message.html.contains(">Sign in</a>"));
        assert!(message.html.contains(&escape(link)));
        assert!(message
            .text
            .contains("Open the link on the computer where you started signing in."));
        assert!(!message.text.contains("Device:"), "{}", message.text);
        assert!(!message.text.contains("System:"), "{}", message.text);
        assert!(!message.html.contains("<table"), "{}", message.html);
        let anywhere = sign_in_link("Smith Lab", link, false);
        assert!(anywhere.text.contains(
            "To finish, type the code Oleafly shows on the computer you're signing in on."
        ));
        assert!(anywhere
            .text
            .contains("If someone gave you a code to type, don't use this link."));
        assert!(anywhere.text.contains("15 minutes"));
        assert!(!anywhere.text.contains("where you started signing in"));
        assert!(!anywhere.text.contains("Device:"), "{}", anywhere.text);
        assert!(!anywhere.html.contains("<table"), "{}", anywhere.html);
    }

    #[test]
    fn the_test_message_says_email_works() {
        let message = test_message("Smith Lab");
        assert_eq!(message.subject, "Test email from Smith Lab");
        assert!(message.text.contains("the server can send email"));
    }
}
