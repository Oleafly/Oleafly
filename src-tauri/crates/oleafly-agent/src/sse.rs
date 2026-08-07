#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct SseEvent {
    pub event: Option<String>,
    pub data: String,
}

#[derive(Default)]
pub struct SseDecoder {
    buffer: String,
}

impl SseDecoder {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&mut self, chunk: &str) -> Vec<SseEvent> {
        self.buffer
            .push_str(&chunk.replace("\r\n", "\n").replace('\r', "\n"));
        let mut events = Vec::new();

        while let Some(end) = self.buffer.find("\n\n") {
            let block: String = self.buffer.drain(..end + 2).collect();
            if let Some(event) = parse_block(block.trim_end_matches('\n')) {
                events.push(event);
            }
        }
        events
    }

    pub fn finish(&mut self) -> Option<SseEvent> {
        let rest: String = self.buffer.drain(..).collect();
        parse_block(rest.trim_end_matches('\n'))
    }
}

fn parse_block(block: &str) -> Option<SseEvent> {
    let mut event = SseEvent::default();
    let mut data_lines: Vec<&str> = Vec::new();

    for line in block.split('\n') {
        if line.is_empty() || line.starts_with(':') {
            continue;
        }
        let (field, value) = match line.split_once(':') {
            None => (line, ""),
            Some((field, value)) => (field, value.strip_prefix(' ').unwrap_or(value)),
        };
        match field {
            "event" => event.event = Some(value.to_string()),
            "data" => data_lines.push(value),
            _ => {}
        }
    }

    if data_lines.is_empty() && event.event.is_none() {
        return None;
    }
    event.data = data_lines.join("\n");
    Some(event)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_whole_event_in_one_chunk_decodes() {
        let mut d = SseDecoder::new();
        let events = d.push("data: {\"a\":1}\n\n");
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].data, "{\"a\":1}");
        assert_eq!(events[0].event, None);
    }

    #[test]
    fn a_payload_split_across_chunks_is_reassembled() {
        let mut d = SseDecoder::new();
        assert!(d.push("data: {\"te").is_empty());
        assert!(d.push("xt\":\"hel").is_empty());
        let events = d.push("lo\"}\n\n");
        assert_eq!(events[0].data, "{\"text\":\"hello\"}");
    }

    #[test]
    fn several_events_in_one_chunk_all_come_out_in_order() {
        let mut d = SseDecoder::new();
        let events = d.push("data: one\n\ndata: two\n\ndata: three\n\n");
        let payloads: Vec<&str> = events.iter().map(|e| e.data.as_str()).collect();
        assert_eq!(payloads, ["one", "two", "three"]);
    }

    #[test]
    fn the_event_field_is_kept_for_providers_that_use_it() {
        let mut d = SseDecoder::new();
        let events = d.push("event: content_block_delta\ndata: {\"x\":1}\n\n");
        assert_eq!(events[0].event.as_deref(), Some("content_block_delta"));
        assert_eq!(events[0].data, "{\"x\":1}");
    }

    #[test]
    fn multiple_data_lines_join_with_newlines() {
        let mut d = SseDecoder::new();
        let events = d.push("data: line one\ndata: line two\n\n");
        assert_eq!(events[0].data, "line one\nline two");
    }

    #[test]
    fn comments_and_keepalives_are_ignored() {
        let mut d = SseDecoder::new();
        assert!(d.push(": keepalive\n\n").is_empty());
        let events = d.push(": ping\ndata: real\n\n");
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].data, "real");
    }

    #[test]
    fn crlf_line_endings_decode_the_same() {
        let mut d = SseDecoder::new();
        let events = d.push("event: ping\r\ndata: {\"a\":1}\r\n\r\n");
        assert_eq!(events[0].event.as_deref(), Some("ping"));
        assert_eq!(events[0].data, "{\"a\":1}");
    }

    #[test]
    fn a_carriage_return_landing_on_a_chunk_boundary_does_not_split_a_field() {
        let mut d = SseDecoder::new();
        assert!(d.push("data: {\"a\":1}\r").is_empty());
        let events = d.push("\n\r\n");
        assert_eq!(events[0].data, "{\"a\":1}");
    }

    #[test]
    fn a_final_event_without_its_blank_line_is_still_delivered() {
        let mut d = SseDecoder::new();
        assert!(d.push("data: [DONE]").is_empty());
        assert_eq!(d.finish().unwrap().data, "[DONE]");
    }

    #[test]
    fn finish_on_an_empty_buffer_yields_nothing() {
        let mut d = SseDecoder::new();
        d.push("data: x\n\n");
        assert!(d.finish().is_none());
    }

    #[test]
    fn a_data_field_with_no_space_after_the_colon_decodes() {
        let mut d = SseDecoder::new();
        let events = d.push("data:{\"a\":1}\n\n");
        assert_eq!(events[0].data, "{\"a\":1}");
    }

    #[test]
    fn only_the_first_colon_separates_the_field_from_its_value() {
        let mut d = SseDecoder::new();
        let events = d.push("data: {\"a\":\"b:c\"}\n\n");
        assert_eq!(events[0].data, "{\"a\":\"b:c\"}");
    }
}
