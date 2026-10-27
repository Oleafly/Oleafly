//! Tool calls a model wrote into its reply text instead of the structured
//! `tool_calls` field. Some local models do this through llama.cpp: the
//! whole reply is `{"name": "ping", "arguments": {}} </tool_call>`, or the
//! Hermes form `<tool_call>{…}</tool_call>`. Text that may be such a call is
//! held back while it streams, and is only read as calls when every one
//! names a tool the request offered and carries object arguments. Anything
//! else is shown as the text it was.

use std::collections::BTreeSet;

use serde_json::{Map, Value};

const OPEN: &str = "<tool_call>";
const CLOSE: &str = "</tool_call>";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Watch {
    /// Nothing but whitespace yet.
    Undecided,
    /// Prose, shown as it comes, until a `<tool_call>` tag appears.
    Prose,
    /// Held from the start of what may be a call.
    Holding,
}

#[derive(Debug)]
pub(crate) struct TextCallWatch {
    tools: BTreeSet<String>,
    state: Watch,
    pending: String,
}

impl TextCallWatch {
    pub(crate) fn new(tools: BTreeSet<String>) -> Self {
        Self {
            tools,
            state: Watch::Undecided,
            pending: String::new(),
        }
    }

    pub(crate) fn holds_text(&self) -> bool {
        !self.pending.is_empty()
    }

    /// Takes a text delta and returns the part that can be shown now.
    pub(crate) fn push(&mut self, text: &str) -> Option<String> {
        self.pending.push_str(text);
        if self.state == Watch::Undecided {
            let start = self.pending.trim_start();
            if start.starts_with('{') || start.starts_with(OPEN) {
                self.state = Watch::Holding;
            } else if start.is_empty() || OPEN.starts_with(start) {
                return None;
            } else {
                self.state = Watch::Prose;
            }
        }
        if self.state == Watch::Holding {
            return None;
        }
        let shown = match self.pending.find(OPEN) {
            Some(tag) => {
                self.state = Watch::Holding;
                self.pending.drain(..tag).collect::<String>()
            }
            None => {
                let keep = partial_tag_len(&self.pending);
                let end = self.pending.len() - keep;
                self.pending.drain(..end).collect::<String>()
            }
        };
        (!shown.is_empty()).then_some(shown)
    }

    /// Ends the watch and returns the text still held. Used when the reply
    /// turns out to carry structured calls, so its text is only text.
    pub(crate) fn release(&mut self) -> Option<String> {
        self.state = Watch::Prose;
        let held = std::mem::take(&mut self.pending);
        (!held.is_empty()).then_some(held)
    }

    /// Settles the reply at its end: the held text as calls, or as text when
    /// it is not a call this request can run.
    pub(crate) fn finish(&mut self) -> Settled {
        if self.state == Watch::Holding {
            if let Some(calls) = parse_calls(&self.pending, &self.tools) {
                self.pending.clear();
                return Settled::Calls(calls);
            }
        }
        match self.release() {
            Some(text) => Settled::Text(text),
            None => Settled::Nothing,
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Settled {
    Nothing,
    Text(String),
    /// Each call's tool name and its arguments as a JSON object.
    Calls(Vec<(String, String)>),
}

/// The length of the longest end of `text` that could be the start of a
/// `<tool_call>` tag split across deltas.
fn partial_tag_len(text: &str) -> usize {
    (1..OPEN.len())
        .rev()
        .find(|len| text.ends_with(&OPEN[..*len]))
        .unwrap_or(0)
}

/// Reads `text` as one or more calls separated by whitespace, each a JSON
/// object, optionally wrapped in `<tool_call>` tags. `None` unless all of
/// the text is calls the request offered.
fn parse_calls(text: &str, tools: &BTreeSet<String>) -> Option<Vec<(String, String)>> {
    let mut calls = Vec::new();
    let mut rest = text.trim();
    while !rest.is_empty() {
        rest = rest.strip_prefix(OPEN).unwrap_or(rest).trim_start();
        let mut values = serde_json::Deserializer::from_str(rest).into_iter::<Value>();
        let Some(Ok(Value::Object(call))) = values.next() else {
            return None;
        };
        rest = rest[values.byte_offset()..].trim_start();
        rest = rest.strip_prefix(CLOSE).unwrap_or(rest).trim_start();
        calls.push(read_call(call, tools)?);
    }
    (!calls.is_empty()).then_some(calls)
}

/// A call is `{"name": …, "arguments": {…}}`, with `parameters` accepted in
/// place of `arguments` and arguments sent as a JSON string read as one.
/// Any other key means the object is something else.
fn read_call(mut call: Map<String, Value>, tools: &BTreeSet<String>) -> Option<(String, String)> {
    let Some(Value::String(name)) = call.remove("name") else {
        return None;
    };
    if !tools.contains(&name) {
        return None;
    }
    let arguments = match (call.remove("arguments"), call.remove("parameters")) {
        (Some(_), Some(_)) => return None,
        (Some(found), None) | (None, Some(found)) => found,
        (None, None) => Value::Object(Map::new()),
    };
    if !call.is_empty() {
        return None;
    }
    let arguments = match arguments {
        Value::String(encoded) => serde_json::from_str::<Value>(&encoded).ok()?,
        other => other,
    };
    arguments.is_object().then(|| (name, arguments.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tools() -> BTreeSet<String> {
        ["ping", "search_project", "read_file"]
            .into_iter()
            .map(str::to_string)
            .collect()
    }

    /// Streams `deltas` through a watch; returns what was shown along the
    /// way and how the reply settled.
    fn watch(deltas: &[&str]) -> (String, Settled) {
        let mut watch = TextCallWatch::new(tools());
        let shown: String = deltas
            .iter()
            .filter_map(|delta| watch.push(delta))
            .collect();
        (shown, watch.finish())
    }

    fn calls(pairs: &[(&str, &str)]) -> Settled {
        Settled::Calls(
            pairs
                .iter()
                .map(|(name, args)| (name.to_string(), args.to_string()))
                .collect(),
        )
    }

    #[test]
    fn the_bonsai_reply_with_only_a_closing_tag_is_a_call() {
        // Bonsai-4B through Lemonade's llama.cpp, verbatim.
        let (shown, settled) = watch(&[r#"{"name": "ping", "arguments": {}} </tool_call>"#]);
        assert_eq!(shown, "");
        assert_eq!(settled, calls(&[("ping", "{}")]));

        let (shown, settled) = watch(&[
            r#"{"name": "search_project", "#,
            r#""arguments": {"query": "\\includegraphics", "glob": "*.tex"}}"#,
            " </tool_call>",
        ]);
        assert_eq!(shown, "");
        let Settled::Calls(found) = settled else {
            panic!("expected a call, got {settled:?}");
        };
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].0, "search_project");
        assert_eq!(
            serde_json::from_str::<Value>(&found[0].1).unwrap(),
            serde_json::json!({ "query": "\\includegraphics", "glob": "*.tex" })
        );
    }

    #[test]
    fn hermes_tags_around_one_or_more_calls_are_read() {
        let (shown, settled) = watch(&[
            "<tool_call>\n{\"name\": \"read_file\", \"arguments\": {\"path\": \"main.tex\"}}\n</tool_call>\n",
            "<tool_call>\n{\"name\": \"ping\", \"arguments\": {}}\n</tool_call>",
        ]);
        assert_eq!(shown, "");
        assert_eq!(
            settled,
            calls(&[("read_file", r#"{"path":"main.tex"}"#), ("ping", "{}")])
        );
    }

    #[test]
    fn prose_before_a_tag_is_shown_and_the_call_after_it_is_read() {
        let (shown, settled) = watch(&[
            "I'll read the file first.\n<tool",
            "_call>{\"name\": \"read_file\", \"arguments\": {\"path\": \"a.tex\"}}</tool_call>",
        ]);
        assert_eq!(shown, "I'll read the file first.\n");
        assert_eq!(settled, calls(&[("read_file", r#"{"path":"a.tex"}"#)]));
    }

    #[test]
    fn parameters_and_string_arguments_are_accepted() {
        let (_, settled) = watch(&[r#"{"name": "read_file", "parameters": {"path": "a"}}"#]);
        assert_eq!(settled, calls(&[("read_file", r#"{"path":"a"}"#)]));
        let (_, settled) = watch(&[r#"{"name": "read_file", "arguments": "{\"path\": \"a\"}"}"#]);
        assert_eq!(settled, calls(&[("read_file", r#"{"path":"a"}"#)]));
        let (_, settled) = watch(&[r#"<tool_call>{"name": "ping"}</tool_call>"#]);
        assert_eq!(settled, calls(&[("ping", "{}")]));
    }

    #[test]
    fn prose_that_mentions_json_stays_text_and_streams_at_once() {
        let reply = r#"Use {"name": "ping", "arguments": {}} to check the tool."#;
        let (shown, settled) = watch(&[reply]);
        assert_eq!(shown, reply);
        assert_eq!(settled, Settled::Nothing);
    }

    #[test]
    fn a_json_answer_that_is_not_a_call_comes_back_as_text() {
        for reply in [
            r#"{"name": "Ada Lovelace", "born": 1815}"#,
            r#"{"name": "ping", "arguments": {}, "note": "extra"}"#,
            r#"{"result": "ok"}"#,
            r#"{"name": "ping", "arguments": {}} and then some words"#,
            r#"{"name": "ping", "arguments": {"#,
        ] {
            let (shown, settled) = watch(&[reply]);
            assert_eq!(shown, "", "{reply}");
            assert_eq!(settled, Settled::Text(reply.into()), "{reply}");
        }
    }

    #[test]
    fn a_tool_the_request_did_not_offer_is_not_a_call() {
        let reply = r#"{"name": "delete_everything", "arguments": {}} </tool_call>"#;
        let (_, settled) = watch(&[reply]);
        assert_eq!(settled, Settled::Text(reply.into()));
    }

    #[test]
    fn arguments_that_are_not_an_object_are_not_a_call() {
        for reply in [
            r#"{"name": "read_file", "arguments": ["a"]}"#,
            r#"{"name": "read_file", "arguments": "not json"}"#,
            r#"{"name": "read_file", "arguments": "[1]"}"#,
            r#"{"name": "read_file", "arguments": {}, "parameters": {}}"#,
            r#"{"name": 7, "arguments": {}}"#,
        ] {
            let (_, settled) = watch(&[reply]);
            assert_eq!(settled, Settled::Text(reply.into()), "{reply}");
        }
    }

    #[test]
    fn a_tag_mentioned_in_prose_is_shown_once_the_reply_ends() {
        let (shown, settled) = watch(&["The model writes <tool_call> tags ", "around calls."]);
        assert_eq!(shown, "The model writes ");
        assert_eq!(
            settled,
            Settled::Text("<tool_call> tags around calls.".into())
        );
    }

    #[test]
    fn a_partial_tag_at_a_delta_boundary_is_held_until_it_resolves() {
        let mut watch = TextCallWatch::new(tools());
        assert_eq!(watch.push("a <to").as_deref(), Some("a "));
        assert_eq!(watch.push("p").as_deref(), Some("<top"));
        assert_eq!(watch.finish(), Settled::Nothing);
    }

    #[test]
    fn leading_whitespace_is_held_until_the_reply_shows_what_it_is() {
        let mut watch = TextCallWatch::new(tools());
        assert_eq!(watch.push("\n "), None);
        assert_eq!(watch.push("Hi").as_deref(), Some("\n Hi"));

        let mut blank = TextCallWatch::new(tools());
        assert_eq!(blank.push("\n"), None);
        assert_eq!(blank.finish(), Settled::Text("\n".into()));
    }

    #[test]
    fn released_text_is_returned_whole_and_the_watch_stops_holding() {
        let mut watch = TextCallWatch::new(tools());
        assert_eq!(watch.push(r#"{"name": "ping""#), None);
        assert_eq!(watch.release().as_deref(), Some(r#"{"name": "ping""#));
        assert!(!watch.holds_text());
        assert_eq!(watch.push("{more}").as_deref(), Some("{more}"));
    }

    #[test]
    fn no_offered_tools_means_no_calls() {
        let mut watch = TextCallWatch::new(BTreeSet::new());
        assert_eq!(watch.push(r#"{"name": "ping", "arguments": {}}"#), None);
        assert_eq!(
            watch.finish(),
            Settled::Text(r#"{"name": "ping", "arguments": {}}"#.into())
        );
    }
}
