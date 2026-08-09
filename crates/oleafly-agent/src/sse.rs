use crate::error::{AgentError, Result};

pub(crate) const MAX_SSE_EVENT_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct SseEvent {
    pub event: Option<String>,
    pub data: String,
}

pub struct SseDecoder {
    buffer: String,
    pending_cr: bool,
    max_buffer_bytes: usize,
}

impl Default for SseDecoder {
    fn default() -> Self {
        Self {
            buffer: String::new(),
            pending_cr: false,
            max_buffer_bytes: MAX_SSE_EVENT_BYTES,
        }
    }
}

impl SseDecoder {
    pub fn new() -> Self {
        Self::default()
    }

    #[cfg(test)]
    fn with_max_buffer_bytes(max_buffer_bytes: usize) -> Self {
        Self {
            max_buffer_bytes,
            ..Self::default()
        }
    }

    pub fn push(&mut self, chunk: &str) -> Result<Vec<SseEvent>> {
        let mut events = Vec::new();
        for ch in chunk.chars() {
            if self.pending_cr {
                self.pending_cr = false;
                self.push_normalized('\n', &mut events)?;
                if ch == '\n' {
                    continue;
                }
            }
            if ch == '\r' {
                self.pending_cr = true;
            } else {
                self.push_normalized(ch, &mut events)?;
            }
        }
        Ok(events)
    }

    fn push_normalized(&mut self, ch: char, events: &mut Vec<SseEvent>) -> Result<()> {
        self.buffer.push(ch);
        if self.buffer.len() > self.max_buffer_bytes {
            return Err(AgentError::Decode(format!(
                "SSE event exceeded the {}-byte safety limit",
                self.max_buffer_bytes
            )));
        }
        if self.buffer.ends_with("\n\n") {
            let block = std::mem::take(&mut self.buffer);
            if let Some(event) = parse_block(block.trim_end_matches('\n')) {
                events.push(event);
            }
        }
        Ok(())
    }

    pub fn finish(&mut self) -> Result<Option<SseEvent>> {
        let mut events = Vec::new();
        if self.pending_cr {
            self.pending_cr = false;
            self.push_normalized('\n', &mut events)?;
        }
        if !self.buffer.is_empty() {
            let rest = std::mem::take(&mut self.buffer);
            if let Some(event) = parse_block(rest.trim_end_matches('\n')) {
                events.push(event);
            }
        }
        debug_assert!(events.len() <= 1);
        Ok(events.pop())
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
        let events = d.push("data: {\"a\":1}\n\n").unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].data, "{\"a\":1}");
        assert_eq!(events[0].event, None);
    }

    #[test]
    fn a_payload_split_across_chunks_is_reassembled() {
        let mut d = SseDecoder::new();
        assert!(d.push("data: {\"te").unwrap().is_empty());
        assert!(d.push("xt\":\"hel").unwrap().is_empty());
        let events = d.push("lo\"}\n\n").unwrap();
        assert_eq!(events[0].data, "{\"text\":\"hello\"}");
    }

    #[test]
    fn several_events_in_one_chunk_all_come_out_in_order() {
        let mut d = SseDecoder::new();
        let events = d.push("data: one\n\ndata: two\n\ndata: three\n\n").unwrap();
        let payloads: Vec<&str> = events.iter().map(|e| e.data.as_str()).collect();
        assert_eq!(payloads, ["one", "two", "three"]);
    }

    #[test]
    fn the_event_field_is_kept_for_providers_that_use_it() {
        let mut d = SseDecoder::new();
        let events = d
            .push("event: content_block_delta\ndata: {\"x\":1}\n\n")
            .unwrap();
        assert_eq!(events[0].event.as_deref(), Some("content_block_delta"));
        assert_eq!(events[0].data, "{\"x\":1}");
    }

    #[test]
    fn multiple_data_lines_join_with_newlines() {
        let mut d = SseDecoder::new();
        let events = d.push("data: line one\ndata: line two\n\n").unwrap();
        assert_eq!(events[0].data, "line one\nline two");
    }

    #[test]
    fn comments_and_keepalives_are_ignored() {
        let mut d = SseDecoder::new();
        assert!(d.push(": keepalive\n\n").unwrap().is_empty());
        let events = d.push(": ping\ndata: real\n\n").unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].data, "real");
    }

    #[test]
    fn crlf_line_endings_decode_the_same() {
        let mut d = SseDecoder::new();
        let events = d.push("event: ping\r\ndata: {\"a\":1}\r\n\r\n").unwrap();
        assert_eq!(events[0].event.as_deref(), Some("ping"));
        assert_eq!(events[0].data, "{\"a\":1}");
    }

    #[test]
    fn a_carriage_return_landing_on_a_chunk_boundary_does_not_split_a_field() {
        let mut d = SseDecoder::new();
        assert!(d.push("data: {\"a\":1}\r").unwrap().is_empty());
        let events = d.push("\n\r\n").unwrap();
        assert_eq!(events[0].data, "{\"a\":1}");
    }

    #[test]
    fn a_crlf_split_across_chunks_does_not_invent_an_event_boundary() {
        let mut d = SseDecoder::new();
        assert!(d.push("event: content_block_delta\r").unwrap().is_empty());
        let events = d.push("\ndata: {\"a\":1}\r\n\r\n").unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event.as_deref(), Some("content_block_delta"));
        assert_eq!(events[0].data, "{\"a\":1}");
    }

    #[test]
    fn a_lone_carriage_return_still_ends_the_line() {
        let mut d = SseDecoder::new();
        let events = d.push("data: one\rdata: two\r\rdata: three\n\n").unwrap();
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].data, "one\ntwo");
        assert_eq!(events[1].data, "three");
    }

    #[test]
    fn a_trailing_carriage_return_is_flushed_by_finish() {
        let mut d = SseDecoder::new();
        assert!(d.push("data: tail\r").unwrap().is_empty());
        assert_eq!(d.finish().unwrap().unwrap().data, "tail");
    }

    #[test]
    fn a_final_event_without_its_blank_line_is_still_delivered() {
        let mut d = SseDecoder::new();
        assert!(d.push("data: [DONE]").unwrap().is_empty());
        assert_eq!(d.finish().unwrap().unwrap().data, "[DONE]");
    }

    #[test]
    fn finish_on_an_empty_buffer_yields_nothing() {
        let mut d = SseDecoder::new();
        d.push("data: x\n\n").unwrap();
        assert!(d.finish().unwrap().is_none());
    }

    #[test]
    fn a_data_field_with_no_space_after_the_colon_decodes() {
        let mut d = SseDecoder::new();
        let events = d.push("data:{\"a\":1}\n\n").unwrap();
        assert_eq!(events[0].data, "{\"a\":1}");
    }

    #[test]
    fn only_the_first_colon_separates_the_field_from_its_value() {
        let mut d = SseDecoder::new();
        let events = d.push("data: {\"a\":\"b:c\"}\n\n").unwrap();
        assert_eq!(events[0].data, "{\"a\":\"b:c\"}");
    }

    #[test]
    fn an_undelimited_event_cannot_exceed_the_buffer_limit() {
        let mut d = SseDecoder::with_max_buffer_bytes(12);
        assert!(d.push("data: 123456").unwrap().is_empty());

        let error = d.push("7").unwrap_err();
        assert!(matches!(error, AgentError::Decode(_)));
        assert!(!error.retryable());
    }

    #[test]
    fn the_event_limit_is_per_event_not_per_network_chunk() {
        let mut d = SseDecoder::with_max_buffer_bytes(10);
        let events = d.push("data: a\n\ndata: b\n\n").unwrap();

        assert_eq!(events.len(), 2);
        assert_eq!(events[0].data, "a");
        assert_eq!(events[1].data, "b");
    }
}
