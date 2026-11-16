use std::future::Future;
use std::pin::pin;
use std::sync::Arc;
use std::time::{Duration, Instant};

use futures_util::FutureExt;
use serde_json::{json, Value};

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
    Lost(Duration),
    Over,
}

fn join_args(doc: &DocId, kind: JoinKind) -> Vec<Value> {
    let options = json!({ "encodeRanges": true, "supportsHistoryOT": true });
    match kind {
        JoinKind::Fresh => vec![json!(doc), options],
        JoinKind::From(version) => vec![json!(doc), json!(version), options],
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

fn signed_out_error(error: &RealtimeError) -> bool {
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
    reconnect_after: Option<Duration>,
}

impl Driver {
    pub(super) fn new(
        shared: Arc<Shared>,
        connection: Connection,
        page: ProjectPage,
        config: SessionConfig,
    ) -> Driver {
        Driver {
            shared,
            page,
            config,
            connection: Some(connection),
            connected_at: Instant::now(),
            legacy_checked: false,
            refresh_members: false,
            reconnect_after: None,
        }
    }

    fn stopping(&self) -> bool {
        self.shared.is_stopping()
    }

    fn over(&self) -> bool {
        self.stopping() || self.shared.lock().ended.is_some()
    }

    pub(super) async fn run(mut self) {
        self.catch_up().await;
        while let Some(mut connection) = self.connection.take() {
            let pumped = self.pump(&mut connection).await;
            self.write_journal(true);
            match pumped {
                Pumped::Over => connection.close().await,
                Pumped::Lost(wait) => {
                    self.drain(&mut connection);
                    drop(connection);
                    self.connection = self.reconnect(wait).await;
                    if self.connection.is_some() {
                        self.catch_up().await;
                    }
                }
            }
        }
        self.finish();
    }

    async fn pump(&mut self, connection: &mut Connection) -> Pumped {
        loop {
            if self.over() {
                return Pumped::Over;
            }
            match self.step(connection).await {
                Step::Go => {}
                Step::Lost => return Pumped::Lost(Duration::ZERO),
                Step::Stopping => return Pumped::Over,
            }
            if let Some(wait) = self.reconnect_after.take() {
                return Pumped::Lost(wait);
            }
            if connection.dropped().is_some() {
                return Pumped::Lost(Duration::ZERO);
            }
            match self.wait(connection).await {
                Woke::Event(event) => self.event(event),
                Woke::Closed => return Pumped::Lost(Duration::ZERO),
                Woke::Idle => {}
            }
        }
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
        for (index, (doc, kind)) in joins.iter().enumerate() {
            let reply = match self.ask(connection, "joinDoc", join_args(doc, *kind)).await {
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
            ServerEvent::ReconnectGracefully => self.reconnect_after = Some(Duration::ZERO),
            ServerEvent::ForceDisconnect { delay, .. } => self.reconnect_after = Some(delay),
            ServerEvent::Rejected(rejection) => self.rejected(rejection),
            ServerEvent::PeersRefresh | ServerEvent::Unknown { .. } => {}
        }
    }

    fn rejected(&mut self, rejection: Rejection) {
        let end = match rejection {
            Rejection::NotAuthorized => LiveEnd::AccessEnded,
            Rejection::ProjectGone => LiveEnd::ProjectGone,
            Rejection::SignedOut
            | Rejection::Retry
            | Rejection::RateLimited
            | Rejection::Other(_) => {
                self.reconnect_after = Some(Duration::ZERO);
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

    async fn reconnect(&mut self, first: Duration) -> Option<Connection> {
        let mut wait = first;
        let mut attempt = 0;
        loop {
            self.shared.with(|state| state.offline(wait));
            self.guard(tokio::time::sleep(wait)).await?;
            if self.over() {
                return None;
            }
            match self.connect().await? {
                Ok((connection, join)) => return self.rejoined(connection, join),
                Err(error) if signed_out_error(&error) => {
                    if !self.wait_for_sign_in().await {
                        return None;
                    }
                    wait = Duration::ZERO;
                    attempt = 0;
                }
                Err(error) => {
                    let Some(next) = error.retry_after(attempt) else {
                        self.shared.with(|state| state.end(end_of(&error)));
                        return None;
                    };
                    wait = next;
                    attempt += 1;
                }
            }
        }
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
        self.legacy_checked = false;
        let public_id = connection.public_id().clone();
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
