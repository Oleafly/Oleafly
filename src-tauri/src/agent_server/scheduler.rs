use std::collections::HashMap;

use super::protocol;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Priority {
    Critical = 16,
    Interactive = 64,
    Background = 128,
}

pub const MAX_IN_FLIGHT: usize = 6;
pub const MAX_PER_CONVERSATION: usize = 20;

pub fn priority_for(method: &str) -> Priority {
    if protocol::HIGH_PRIORITY_METHODS.contains(&method) {
        Priority::Critical
    } else if protocol::COALESCED_METHODS.contains(&method) {
        Priority::Background
    } else {
        Priority::Interactive
    }
}

fn coalesce_key(method: &str, conversation: Option<&str>) -> Option<String> {
    if protocol::COALESCED_METHODS.contains(&method) {
        Some(format!(
            "{method}\u{1f}{}",
            conversation.unwrap_or("global")
        ))
    } else {
        None
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct QueuedRequest {
    pub ticket: u64,
    pub method: String,
    pub conversation: Option<String>,
    pub priority: Priority,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SubmitOutcome {
    Admitted,
    Queued { ticket: u64 },
    Coalesced { ticket: u64 },
    QueueFull,
}

#[derive(Default)]
pub struct SchedulerState {
    queued: Vec<QueuedRequest>,
    in_flight: usize,
    coalesce_tickets: HashMap<String, u64>,
    next_ticket: u64,
}

impl SchedulerState {
    fn conversation_key(conversation: Option<&str>) -> String {
        conversation.unwrap_or("global").to_string()
    }

    pub fn submit(&mut self, method: &str, conversation: Option<&str>) -> SubmitOutcome {
        let priority = priority_for(method);
        let key = Self::conversation_key(conversation);

        if let Some(coalesce) = coalesce_key(method, conversation) {
            if let Some(ticket) = self.coalesce_tickets.get(&coalesce) {
                return SubmitOutcome::Coalesced { ticket: *ticket };
            }
        }

        let queued_for_conversation = self
            .queued
            .iter()
            .filter(|request| Self::conversation_key(request.conversation.as_deref()) == key)
            .count();
        if queued_for_conversation >= MAX_PER_CONVERSATION {
            return SubmitOutcome::QueueFull;
        }

        self.next_ticket += 1;
        let ticket = self.next_ticket;

        if self.in_flight < MAX_IN_FLIGHT {
            self.in_flight += 1;
            return SubmitOutcome::Admitted;
        }

        let request = QueuedRequest {
            ticket,
            method: method.to_string(),
            conversation: conversation.map(str::to_string),
            priority,
        };
        self.queued.push(request);
        if let Some(coalesce) = coalesce_key(method, conversation) {
            self.coalesce_tickets.insert(coalesce, ticket);
        }
        SubmitOutcome::Queued { ticket }
    }

    pub fn next_admission(&mut self) -> Option<QueuedRequest> {
        if self.in_flight >= MAX_IN_FLIGHT {
            return None;
        }
        let index = self
            .queued
            .iter()
            .enumerate()
            .min_by_key(|(index, request)| (request.priority, *index))
            .map(|(index, _)| index)?;
        let request = self.queued.remove(index);
        self.in_flight += 1;
        if let Some(coalesce) = coalesce_key(&request.method, request.conversation.as_deref()) {
            self.coalesce_tickets.remove(&coalesce);
        }
        Some(request)
    }

    pub fn complete(&mut self, _conversation: Option<&str>) {
        self.in_flight = self.in_flight.saturating_sub(1);
    }

    pub fn in_flight(&self) -> usize {
        self.in_flight
    }

    pub fn queued_count(&self) -> usize {
        self.queued.len()
    }

    pub fn coalesce_partner_of(&self, method: &str, conversation: Option<&str>) -> Option<u64> {
        coalesce_key(method, conversation).and_then(|key| self.coalesce_tickets.get(&key).copied())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn method_priority_mapping() {
        assert_eq!(priority_for("turn/interrupt"), Priority::Critical);
        assert_eq!(priority_for("turn/start"), Priority::Critical);
        assert_eq!(
            priority_for("thread/approveGuardianDeniedAction"),
            Priority::Critical
        );
        assert_eq!(priority_for("model/list"), Priority::Background);
        assert_eq!(priority_for("config/read"), Priority::Background);
        assert_eq!(priority_for("fs/readFile"), Priority::Interactive);
    }

    #[test]
    fn admits_while_slots_free_then_queues() {
        let mut scheduler = SchedulerState::default();
        for _ in 0..MAX_IN_FLIGHT {
            assert!(matches!(
                scheduler.submit("fs/readFile", Some("t1")),
                SubmitOutcome::Admitted
            ));
        }
        assert_eq!(scheduler.in_flight(), MAX_IN_FLIGHT);
        assert!(matches!(
            scheduler.submit("fs/readFile", Some("t1")),
            SubmitOutcome::Queued { .. }
        ));
        assert_eq!(scheduler.queued_count(), 1);
    }

    #[test]
    fn critical_work_jumps_the_queue() {
        let mut scheduler = SchedulerState::default();
        for _ in 0..MAX_IN_FLIGHT {
            scheduler.submit("fs/readFile", Some("t1"));
        }
        let queued = match scheduler.submit("fs/readFile", Some("t1")) {
            SubmitOutcome::Queued { ticket } => ticket,
            other => panic!("expected queue, got {other:?}"),
        };
        let critical = match scheduler.submit("turn/interrupt", Some("t1")) {
            SubmitOutcome::Queued { ticket } => ticket,
            other => panic!("expected queue, got {other:?}"),
        };
        scheduler.complete(Some("t1"));
        let admitted = scheduler.next_admission().unwrap();
        assert_eq!(admitted.ticket, critical);
        scheduler.complete(Some("t1"));
        let admitted = scheduler.next_admission().unwrap();
        assert_eq!(admitted.ticket, queued);
    }

    #[test]
    fn per_conversation_queue_cap_rejects_with_queue_full() {
        let mut scheduler = SchedulerState::default();
        for _ in 0..MAX_IN_FLIGHT {
            scheduler.submit("fs/readFile", Some("t1"));
        }
        for _ in 0..MAX_PER_CONVERSATION {
            assert!(matches!(
                scheduler.submit("fs/readFile", Some("t1")),
                SubmitOutcome::Queued { .. }
            ));
        }
        assert_eq!(
            scheduler.submit("fs/readFile", Some("t1")),
            SubmitOutcome::QueueFull
        );
        assert!(matches!(
            scheduler.submit("fs/readFile", Some("t2")),
            SubmitOutcome::Queued { .. }
        ));
    }

    #[test]
    fn coalescable_reads_share_one_ticket() {
        let mut scheduler = SchedulerState::default();
        for _ in 0..MAX_IN_FLIGHT {
            scheduler.submit("model/list", None);
        }
        let first = match scheduler.submit("model/list", None) {
            SubmitOutcome::Queued { ticket } => ticket,
            other => panic!("expected queue, got {other:?}"),
        };
        assert_eq!(
            scheduler.submit("model/list", None),
            SubmitOutcome::Coalesced { ticket: first }
        );
        assert!(matches!(
            scheduler.submit("model/list", Some("t1")),
            SubmitOutcome::Queued { .. }
        ));
        scheduler.complete(None);
        let admitted = scheduler.next_admission().unwrap();
        assert_eq!(admitted.ticket, first);
        assert_eq!(scheduler.coalesce_partner_of("model/list", None), None);
    }

    #[test]
    fn admitted_requests_do_not_register_coalesce_tickets() {
        let mut scheduler = SchedulerState::default();
        assert!(matches!(
            scheduler.submit("model/list", None),
            SubmitOutcome::Admitted
        ));
        assert!(matches!(
            scheduler.submit("model/list", None),
            SubmitOutcome::Admitted
        ));
    }

    #[test]
    fn complete_releases_the_slot() {
        let mut scheduler = SchedulerState::default();
        for _ in 0..MAX_IN_FLIGHT {
            scheduler.submit("fs/readFile", None);
        }
        assert!(matches!(
            scheduler.submit("fs/readFile", None),
            SubmitOutcome::Queued { .. }
        ));
        scheduler.complete(None);
        assert!(scheduler.next_admission().is_some());
        assert_eq!(scheduler.in_flight(), MAX_IN_FLIGHT);
    }
}
