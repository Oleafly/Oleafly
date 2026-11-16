use std::future::Future;
use std::pin::pin;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant};

use futures_util::FutureExt;
use oleafly_net::reconnect::{backoff_step, backoff_wait, Reached};
use serde_json::{json, Value};

use super::pacing::{JoinPacer, Wait};
use super::state::{now_ms, JoinKind, State};
use super::{catch_up, LiveEnd, SessionConfig, Shared};
use crate::error::OnlineErrorKind;
use crate::live::join::parse_join;
use crate::live::DocId;
use crate::realtime::connection::{connect_tuned, Connection, JoinProject, RealtimeError};
use crate::realtime::events::{Rejection, ServerEvent};
use crate::realtime::ProjectPage;

enum Asked {
    Reply(Vec<Value>),
    Lost,
    Stopping,
}

enum Step {
    Go,
    Lost,
    Stopping,
}

enum Woke {
    Event(ServerEvent),
    Closed,
    Idle,
}

enum Pumped {
    Lost(Wait),
    Idle,
    Over,
}

fn join_args(doc: &DocId, kind: JoinKind, age: Option<u64>) -> Vec<Value> {
    let mut options = json!({ "encodeRanges": true, "supportsHistoryOT": true });
    match kind {
        JoinKind::Fresh => vec![json!(doc), options],
        JoinKind::From(version) => {
            if let Some(age) = age {
                options["age"] = json!(age);
            }
            vec![json!(doc), json!(version), options]
        }
    }
}

fn refusal(reply: &[Value]) -> Option<String> {
    let error = reply.first().filter(|error| !error.is_null())?;
    let message = error
        .get("message")
        .and_then(Value::as_str)
        .or_else(|| error.as_str())
        .unwrap_or("the server refused the change");
    Some(message.to_string())
}

pub(super) fn signed_out_error(error: &RealtimeError) -> bool {
    match error {
        RealtimeError::Rejected(rejection) => *rejection == Rejection::SignedOut,
        RealtimeError::Page(error) => matches!(
            error.kind,
            OnlineErrorKind::SessionExpired | OnlineErrorKind::SignedOut
        ),
        _ => false,
    }
}

fn end_of(error: &RealtimeError) -> LiveEnd {
    match error {
        RealtimeError::Rejected(Rejection::NotAuthorized) => LiveEnd::AccessEnded,
        RealtimeError::Rejected(Rejection::ProjectGone) => LiveEnd::ProjectGone,
        RealtimeError::Page(error) if matches!(error.kind, OnlineErrorKind::ProjectUnavailable) => {
            LiveEnd::AccessEnded
        }
        other => LiveEnd::Failed(other.to_string()),
    }
}

pub(super) struct Driver {
    shared: Arc<Shared>,
    page: ProjectPage,
    config: SessionConfig,
    connection: Option<Connection>,
    connected_at: Instant,
    legacy_checked: bool,
    refresh_members: bool,
    reconnect_after: Option<Wait>,
    pacer: JoinPacer,
    attempt: usize,
    online_since: tokio::time::Instant,
    lost_at: Option<tokio::time::Instant>,
    drain_by: Option<tokio::time::Instant>,
    acks_seen: u64,
    waiting_since: Option<tokio::time::Instant>,
    slow_shown: bool,
    joined_once: bool,
}

impl Driver {
    pub(super) fn new(
        shared: Arc<Shared>,
        connection: Option<Connection>,
        page: ProjectPage,
        config: SessionConfig,
    ) -> Driver {
        let now = tokio::time::Instant::now();
        let mut pacer = JoinPacer::new(config.tuning.join_limit, config.tuning.join_window);
        let joined_once = connection.is_some();
        if joined_once {
            pacer.record(now);
        }
        Driver {
            shared,
            page,
            config,
            connection,
            connected_at: Instant::now(),
            legacy_checked: false,
            refresh_members: false,
            reconnect_after: None,
            pacer,
            attempt: 0,
            online_since: now,
            lost_at: None,
            drain_by: None,
            acks_seen: 0,
            waiting_since: None,
            slow_shown: false,
            joined_once,
        }
    }

    fn stopping(&self) -> bool {
        self.shared.is_stopping()
    }

    fn over(&self) -> bool {
        self.stopping() || self.shared.lock().ended.is_some()
    }

    pub(super) async fn run(mut self) {
        if self.connection.is_some() {
            self.catch_up().await;
        } else {
            self.come_back(Wait::NOW).await;
        }
        while let Some(mut connection) = self.connection.take() {
            let pumped = self.pump(&mut connection).await;
            self.write_journal(true);
            match pumped {
                Pumped::Over => connection.close().await,
                Pumped::Lost(wait) => {
                    self.drain(&mut connection);
                    drop(connection);
                    self.lost_at = Some(tokio::time::Instant::now());
                    let wait = self.after_drop(wait);
                    self.come_back(wait).await;
                }
                Pumped::Idle => {
                    connection.close().await;
                    self.lost_at = Some(tokio::time::Instant::now());
                    self.shared.with(State::idle);
                    if self.wait_for_activity().await {
                        self.come_back(Wait::NOW).await;
                    }
                }
            }
        }
        self.finish();
    }

    async fn come_back(&mut self, wait: Wait) {
        self.connection = self.reconnect(wait).await;
        if self.connection.is_some() {
            self.catch_up().await;
        }
    }

    fn after_drop(&mut self, wait: Wait) -> Wait {
        let online = self.online_since.elapsed();
        self.attempt = backoff_step(self.attempt + 1, Reached::after(online));
        if self.attempt == 0 {
            return wait;
        }
        wait.at_least(Duration::from_millis(backoff_wait(self.attempt)))
    }

    async fn wait_for_activity(&self) -> bool {
        let since = tokio::time::Instant::now();
        while !self.shared.active_since(since) {
            let tick = self.config.tuning.tick;
            if self.over() || self.guard(tokio::time::sleep(tick)).await.is_none() {
                return false;
            }
        }
        true
    }

    async fn pump(&mut self, connection: &mut Connection) -> Pumped {
        loop {
            if self.over() {
                return Pumped::Over;
            }
            match self.step(connection).await {
                Step::Go => {}
                Step::Lost => return Pumped::Lost(Wait::NOW),
                Step::Stopping => return Pumped::Over,
            }
            if let Some(pumped) = self.due(connection) {
                return pumped;
            }
            match self.wait(connection).await {
                Woke::Event(event) => self.event(event),
                Woke::Closed => return Pumped::Lost(Wait::NOW),
                Woke::Idle => {}
            }
        }
    }

    fn due(&mut self, connection: &Connection) -> Option<Pumped> {
        if let Some(wait) = self.reconnect_after.take() {
            return Some(Pumped::Lost(wait));
        }
        if connection.dropped().is_some() {
            return Some(Pumped::Lost(Wait::NOW));
        }
        self.watch_acks();
        if self.drain_due() {
            return Some(Pumped::Lost(Wait::NOW));
        }
        self.idle_due().then_some(Pumped::Idle)
    }

    fn watch_acks(&mut self) {
        let now = tokio::time::Instant::now();
        let (acks, waiting) = {
            let state = self.shared.lock();
            (state.acks(), state.needs_server())
        };
        if !waiting {
            self.waiting_since = None;
        } else if acks != self.acks_seen || self.waiting_since.is_none() {
            self.waiting_since = Some(now);
        }
        self.acks_seen = acks;
        let after = self.config.tuning.slow_ack_after;
        let slow = self
            .waiting_since
            .is_some_and(|since| now.duration_since(since) >= after);
        if slow != self.slow_shown {
            self.slow_shown = slow;
            self.shared.with(|state| state.slow_ack(slow));
        }
    }

    fn drain_due(&mut self) -> bool {
        let Some(by) = self.drain_by else {
            return false;
        };
        let paused = self.shared.typing_paused(self.config.tuning.typing_pause);
        if !paused && tokio::time::Instant::now() < by {
            return false;
        }
        self.drain_by = None;
        true
    }

    fn idle_due(&self) -> bool {
        self.shared.quiet_for(self.config.tuning.idle_after) && self.shared.lock().can_rest()
    }

    async fn step(&mut self, connection: &mut Connection) -> Step {
        if let Some(session) = self.shared.take_sign_in() {
            self.config.session = session;
            return Step::Lost;
        }
        let joined = self.joins(connection).await;
        if !matches!(joined, Step::Go) {
            return joined;
        }
        let sent = self.sends(connection).await;
        if !matches!(sent, Step::Go) {
            return sent;
        }
        self.presence(connection);
        self.write_journal(false);
        self.shared.with(|state| {
            let changes = state.project.tree.due(Instant::now());
            state.tree_changed(changes);
        });
        self.legacy_check().await;
        self.refresh().await;
        Step::Go
    }

    async fn wait(&self, connection: &mut Connection) -> Woke {
        tokio::select! {
            event = connection.next_event() => event.map_or(Woke::Closed, Woke::Event),
            () = self.shared.wake.notified() => Woke::Idle,
            () = tokio::time::sleep(self.config.tuning.tick) => Woke::Idle,
        }
    }

    async fn guard<F: Future>(&self, future: F) -> Option<F::Output> {
        let mut future = pin!(future);
        loop {
            tokio::select! {
                output = future.as_mut() => return Some(output),
                () = self.shared.wake.notified() => {}
                () = tokio::time::sleep(self.config.tuning.tick) => {}
            }
            if self.stopping() {
                return None;
            }
            self.write_journal(false);
        }
    }

    async fn ask(&self, connection: &Connection, name: &'static str, args: Vec<Value>) -> Asked {
        let timeout = self.config.tuning.call_timeout;
        let call = tokio::time::timeout(timeout, connection.call(name, args));
        match self.guard(call).await {
            None => Asked::Stopping,
            Some(Ok(Ok(reply))) => Asked::Reply(reply),
            Some(_) => Asked::Lost,
        }
    }

    async fn joins(&mut self, connection: &mut Connection) -> Step {
        let urgent = self.config.tuning.urgent_batch;
        let joins = self
            .shared
            .with(|state| state.next_joins(Instant::now(), urgent));
        if joins.is_empty() {
            self.lost_at = None;
        }
        let age = self
            .lost_at
            .map(|lost| u64::try_from(lost.elapsed().as_millis()).unwrap_or(u64::MAX));
        for (index, (doc, kind)) in joins.iter().enumerate() {
            let reply = match self
                .ask(connection, "joinDoc", join_args(doc, *kind, age))
                .await
            {
                Asked::Reply(reply) => reply,
                Asked::Lost => {
                    self.shared.with(|state| state.requeue(&joins[index..]));
                    return Step::Lost;
                }
                Asked::Stopping => {
                    self.shared.with(|state| state.requeue(&joins[index..]));
                    return Step::Stopping;
                }
            };
            self.drain(connection);
            let parsed = parse_join(doc, &reply);
            self.shared.with(|state| state.joined(doc, *kind, parsed));
        }
        Step::Go
    }

    fn drain(&mut self, connection: &mut Connection) {
        while let Some(Some(event)) =
            tokio::task::unconstrained(connection.next_event()).now_or_never()
        {
            self.event(event);
        }
    }

    async fn sends(&mut self, connection: &Connection) -> Step {
        let updates = self.shared.with(|state| state.next_sends(Instant::now()));
        if updates.is_empty() {
            return Step::Go;
        }
        self.write_journal(true);
        for update in updates {
            let args = vec![json!(update.doc), update.payload()];
            match self.ask(connection, "applyOtUpdate", args).await {
                Asked::Reply(reply) => {
                    if let Some(message) = refusal(&reply) {
                        self.shared
                            .with(|state| state.send_refused(&update.doc, &message));
                    }
                }
                Asked::Lost => return Step::Lost,
                Asked::Stopping => return Step::Stopping,
            }
        }
        Step::Go
    }

    fn presence(&self, connection: &Connection) {
        let Some((doc, row, column)) = self.shared.with(State::take_presence) else {
            return;
        };
        connection.emit(
            "clientTracking.updatePosition",
            vec![json!({ "row": row, "column": column, "doc_id": doc })],
        );
    }

    fn event(&mut self, event: ServerEvent) {
        match event {
            ServerEvent::Applied(update) => self.shared.with(|state| state.on_applied(update)),
            ServerEvent::UpdateError { doc, message } => {
                self.shared.with(|state| state.update_error(&doc, &message))
            }
            ServerEvent::PeerMoved(peer) => self.shared.with(|state| state.peer(peer)),
            ServerEvent::PeerLeft(id) => self.shared.with(|state| state.peer_left(id)),
            ServerEvent::Tree(event) => self.shared.with(|state| {
                let changes = state.project.tree.apply(&event, Instant::now());
                state.tree_changed(changes);
            }),
            ServerEvent::Project(event) => self.shared.with(|state| state.project_event(event)),
            ServerEvent::Access(event) => {
                self.refresh_members |= self.shared.with(|state| state.access(&event));
            }
            ServerEvent::ReconnectGracefully => self.graceful(),
            ServerEvent::ForceDisconnect { message, delay } => {
                self.shared.with(|state| state.maintenance(message, delay));
                self.reconnect_after = Some(Wait::held(delay));
            }
            ServerEvent::Rejected(rejection) => self.rejected(rejection),
            ServerEvent::PeersRefresh | ServerEvent::Unknown { .. } => {}
        }
    }

    fn graceful(&mut self) {
        if self.drain_by.is_none() {
            let within = self
                .page
                .max_reconnect_gracefully()
                .unwrap_or(self.config.tuning.drain_within);
            self.drain_by = Some(tokio::time::Instant::now() + within);
        }
    }

    fn rejected(&mut self, rejection: Rejection) {
        self.shared.rejected(format!("{rejection:?}"));
        let end = match rejection {
            Rejection::NotAuthorized => LiveEnd::AccessEnded,
            Rejection::ProjectGone => LiveEnd::ProjectGone,
            Rejection::RateLimited => {
                let wait = RealtimeError::Rejected(Rejection::RateLimited)
                    .retry_after(self.attempt)
                    .unwrap_or_default();
                self.reconnect_after = Some(Wait::held(wait));
                return;
            }
            Rejection::SignedOut | Rejection::Retry | Rejection::Other(_) => {
                self.reconnect_after = Some(Wait::NOW);
                return;
            }
        };
        self.shared.with(|state| state.end(end));
    }

    fn write_journal(&self, forced: bool) {
        let now = Instant::now();
        let Some(batch) = self
            .shared
            .with(|state| state.take_journal_batch(now, forced))
        else {
            return;
        };
        let result = self.shared.write_journal(&batch);
        self.shared
            .with(|state| state.journal_result(batch, result, now));
    }

    async fn catch_up(&mut self) {
        let version = self.shared.with(|state| state.history_version());
        let SessionConfig {
            http,
            session,
            project_id,
            tuning,
            ..
        } = &self.config;
        let Some(history) = self
            .guard(catch_up::since(http, session, project_id, version))
            .await
        else {
            return;
        };
        let trickle = tuning.trickle_every;
        self.shared
            .with(|state| state.start_history(history, trickle));
    }

    async fn legacy_check(&mut self) {
        let tuning = &self.config.tuning;
        if self.legacy_checked || self.connected_at.elapsed() < tuning.legacy_check {
            return;
        }
        self.legacy_checked = true;
        let after = self.shared.with(|state| state.connected_wall_ms());
        let before = now_ms().saturating_sub(tuning.legacy_grace.as_millis() as u64);
        let (batch, every) = (tuning.legacy_batch, tuning.legacy_every);
        let SessionConfig {
            http,
            session,
            project_id,
            ..
        } = &self.config;
        let changed = catch_up::changed_between(http, session, project_id, after, before);
        let Some(Some(paths)) = self.guard(changed).await else {
            return;
        };
        self.shared
            .with(|state| state.legacy_from(&paths, batch, every));
    }

    async fn refresh(&mut self) {
        if !std::mem::take(&mut self.refresh_members) {
            return;
        }
        let (mut members, restricted) = self
            .shared
            .with(|state| (state.project.members.clone(), state.project.restricted));
        if restricted {
            return;
        }
        let SessionConfig {
            http,
            session,
            project_id,
            ..
        } = &self.config;
        let refreshed = self.guard(members.refresh(http, session, project_id)).await;
        if matches!(refreshed, Some(Ok(()))) {
            self.shared.with(|state| state.members_refreshed(members));
        }
    }

    async fn reconnect(&mut self, first: Wait) -> Option<Connection> {
        let mut wait = first;
        loop {
            let paced = wait.held_at_least(self.pacer.delay(tokio::time::Instant::now()));
            if self.joined_once || !paced.after.is_zero() {
                self.shared.with(|state| state.offline(paced.after));
            }
            self.hold(paced).await?;
            if self.over() {
                return None;
            }
            self.pacer.record(tokio::time::Instant::now());
            match self.connect().await? {
                Ok((connection, join)) => return self.rejoined(connection, join),
                Err(error) => wait = self.retry(&error).await?,
            }
        }
    }

    async fn hold(&self, wait: Wait) -> Option<()> {
        let started = tokio::time::Instant::now();
        self.guard(tokio::time::sleep_until(started + wait.held))
            .await?;
        let nudged = self.shared.nudge.notified();
        if self.shared.nudged.swap(false, Ordering::SeqCst) {
            return Some(());
        }
        let rest = tokio::time::sleep_until(started + wait.after);
        self.guard(async {
            tokio::select! {
                () = rest => {}
                () = nudged => {}
            }
        })
        .await?;
        self.shared.nudged.store(false, Ordering::SeqCst);
        Some(())
    }

    async fn retry(&mut self, error: &RealtimeError) -> Option<Wait> {
        self.shared.rejected(error.to_string());
        if signed_out_error(error) {
            if !self.wait_for_sign_in().await {
                return None;
            }
            self.attempt = 0;
            return Some(Wait::NOW);
        }
        let Some(next) = error.retry_after(self.attempt) else {
            self.shared.with(|state| state.end(end_of(error)));
            return None;
        };
        self.attempt += 1;
        if matches!(error, RealtimeError::Rejected(Rejection::RateLimited)) {
            return Some(Wait::held(next));
        }
        Some(Wait::after(next))
    }

    async fn wait_for_sign_in(&mut self) -> bool {
        self.shared.with(State::park_signed_out);
        loop {
            if let Some(session) = self.shared.take_sign_in() {
                self.config.session = session;
                return true;
            }
            let tick = self.config.tuning.tick;
            if self.over() || self.guard(tokio::time::sleep(tick)).await.is_none() {
                return false;
            }
        }
    }

    async fn connect(&self) -> Option<Result<(Connection, JoinProject), RealtimeError>> {
        let config = &self.config;
        if self.page.user_id().is_none() {
            let loaded = self
                .guard(self.page.reload(&config.http, &config.session, false))
                .await?;
            if let Err(error) = loaded {
                return Some(Err(RealtimeError::Page(error)));
            }
            let limit = self.page.max_doc_length().map(|limit| limit as usize);
            self.shared.with(|state| state.page_limit = limit);
        }
        self.guard(connect_tuned(
            &config.http,
            &config.session,
            &self.page,
            &config.carriers,
            &config.tuning.connection,
        ))
        .await
    }

    fn rejoined(&mut self, connection: Connection, join: JoinProject) -> Option<Connection> {
        self.connected_at = Instant::now();
        self.online_since = tokio::time::Instant::now();
        self.legacy_checked = false;
        self.joined_once = true;
        self.shared.nudged.store(false, Ordering::SeqCst);
        {
            let mut journal = self.shared.journal();
            journal.remember_join(join.response.clone());
            let _ = journal.flush();
        }
        let public_id = connection.public_id().clone();
        self.shared
            .linked(connection.carrier().wire_name(), public_id.clone());
        self.shared
            .with(|state| state.rejoined(public_id, join.response))
            .then_some(connection)
    }

    fn finish(&self) {
        self.shared.with(|state| {
            let changes = state.project.tree.flush();
            state.tree_changed(changes);
            let end = if state.is_signed_out() {
                LiveEnd::SignedOut
            } else {
                LiveEnd::Stopped
            };
            state.end(end);
        });
        self.write_journal(true);
    }
}
