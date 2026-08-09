use std::future::Future;

use futures_util::future::{AbortHandle, AbortRegistration, Abortable};

use super::*;

pub(super) fn begin_request(
    state: &AgentState,
    request_id: &str,
) -> Option<(u64, AbortRegistration)> {
    let (handle, registration) = AbortHandle::new_pair();
    let (generation, previous) = {
        let mut registry = lock_or_recover(&state.requests);
        match (
            registry.session_id.as_deref(),
            request_session_id(request_id),
        ) {
            (Some(current), Some(request)) if current == request => {}
            (Some(_), _) => return None,
            (None, Some(request)) => registry.session_id = Some(request.to_string()),
            (None, None) => {}
        }
        if let Some(index) = registry
            .early_cancellations
            .iter()
            .position(|pending| pending == request_id)
        {
            registry.early_cancellations.remove(index);
            return None;
        }

        registry.next_generation = registry.next_generation.wrapping_add(1);
        let generation = registry.next_generation;
        let previous = registry
            .active
            .insert(request_id.to_string(), ActiveRequest { generation, handle });
        (generation, previous)
    };

    if let Some(previous) = previous {
        previous.handle.abort();
    }
    Some((generation, registration))
}

pub(super) fn finish_request(state: &AgentState, request_id: &str, generation: u64) {
    let mut registry = lock_or_recover(&state.requests);
    let owns_registration = registry
        .active
        .get(request_id)
        .is_some_and(|active| active.generation == generation);
    if owns_registration {
        registry.active.remove(request_id);
    }
}

pub(super) fn cancel_request(state: &AgentState, request_id: &str) -> Option<u64> {
    let active = {
        let mut registry = lock_or_recover(&state.requests);
        let active = registry.active.remove(request_id);
        if active.is_none()
            && !registry
                .early_cancellations
                .iter()
                .any(|pending| pending == request_id)
        {
            if registry.early_cancellations.len() == MAX_EARLY_CANCELLATIONS {
                registry.early_cancellations.pop_front();
            }
            registry
                .early_cancellations
                .push_back(request_id.to_string());
        }
        active
    };
    let generation = active.as_ref().map(|active| active.generation);
    if let Some(active) = active {
        active.handle.abort();
    }
    generation
}

pub(super) fn cancel_all_requests(state: &AgentState, session_id: &str) {
    let handles: Vec<AbortHandle> = {
        let mut registry = lock_or_recover(&state.requests);
        registry.session_id = Some(session_id.to_string());
        registry.early_cancellations.clear();
        registry
            .active
            .drain()
            .map(|(_, active)| active.handle)
            .collect()
    };
    for handle in handles {
        handle.abort();
    }
}

fn request_session_id(request_id: &str) -> Option<&str> {
    let rest = request_id.strip_prefix("agent:")?;
    let (session, _) = rest.split_once(':')?;
    (!session.is_empty()).then_some(session)
}

struct RequestGuard<'a> {
    state: &'a AgentState,
    request_id: &'a str,
    generation: u64,
}

impl Drop for RequestGuard<'_> {
    fn drop(&mut self) {
        finish_request(self.state, self.request_id, self.generation);
    }
}

pub(super) async fn run_registered<T, Factory, Work>(
    state: &AgentState,
    request_id: &str,
    work: Factory,
) -> Result<T, String>
where
    Factory: FnOnce(u64) -> Work,
    Work: Future<Output = Result<T, String>>,
{
    let _request_slot = acquire_request_slot(state)?;
    let Some((generation, registration)) = begin_request(state, request_id) else {
        return Err(tagged(oleafly_agent::AgentError::Cancelled));
    };
    let _guard = RequestGuard {
        state,
        request_id,
        generation,
    };

    let result = Abortable::new(work(generation), registration)
        .await
        .map_err(|_| tagged(oleafly_agent::AgentError::Cancelled));
    drop_pending_tools(state, request_id, Some(generation));
    result?
}

pub(super) fn acquire_request_slot(
    state: &AgentState,
) -> Result<tokio::sync::OwnedSemaphorePermit, String> {
    state
        .request_slots
        .clone()
        .try_acquire_owned()
        .map_err(|_| {
            tagged(oleafly_agent::AgentError::Decode(format!(
                "too many concurrent agent requests (limit {MAX_CONCURRENT_AGENT_REQUESTS})"
            )))
        })
}
