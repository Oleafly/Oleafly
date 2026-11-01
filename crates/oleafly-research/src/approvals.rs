use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use oleafly_agent::CancellationToken;
use tokio::sync::Notify;

use crate::budget::{BudgetClocks, ClockPause};
use crate::model::{
    now_ms, ApprovalKind, ApprovalRecord, ApprovalStatus, CommandPolicy, TaskPhase,
    TaskRuntimeEvent,
};
use crate::scheduler::{TaskEventSink, TaskServices};
use crate::store::TaskStore;

pub const APPROVAL_EXPIRY: Duration = Duration::from_secs(24 * 60 * 60);
const MAX_SUMMARY_CHARS: usize = 300;
const MAX_DETAIL_BYTES: usize = 16 * 1024;
const POLL: Duration = Duration::from_secs(1);

pub const COMMANDS_OFF: &str = "Commands are turned off for this task.";
pub const DENIED: &str = "The user didn't approve this command.";
pub const EXPIRED: &str = "Nobody answered the approval request in 24 hours.";
pub const TOO_LONG_TO_SHOW: &str =
    "This request is too long to show for approval (over 16 KiB). Ask again with a shorter command or smaller arguments.";
const CANCELLED: &str = "The task was cancelled.";
pub const APPROVAL_WITHDRAWN: &str =
    "The task paused before anyone answered this request. Ask again.";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Decision {
    Approved,
    Denied(String),
}

pub struct ApprovalQueue {
    store_root: PathBuf,
    clocks: Arc<BudgetClocks>,
    decided: Notify,
}

fn bounded(text: &str, max_bytes: usize) -> String {
    if text.len() <= max_bytes {
        return text.to_owned();
    }
    let mut end = max_bytes;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    text[..end].to_owned()
}

impl ApprovalQueue {
    pub fn new(store_root: PathBuf, clocks: Arc<BudgetClocks>) -> Arc<Self> {
        Arc::new(Self {
            store_root,
            clocks,
            decided: Notify::new(),
        })
    }

    fn store(&self) -> Result<TaskStore, String> {
        TaskStore::new(self.store_root.clone())
    }

    pub fn request(
        &self,
        task_id: &str,
        generation: u64,
        kind: ApprovalKind,
        summary: &str,
        detail: &str,
    ) -> Result<String, String> {
        let summary: String = summary.trim().chars().take(MAX_SUMMARY_CHARS).collect();
        let expires = now_ms() + APPROVAL_EXPIRY.as_millis() as i64;
        self.store()?
            .insert_approval(
                task_id,
                generation,
                kind,
                &summary,
                &bounded(detail, MAX_DETAIL_BYTES),
                expires,
            )
            .map(|record| record.id)
    }

    pub async fn wait(
        &self,
        approval_id: &str,
        task_id: &str,
        cancel: &CancellationToken,
    ) -> Decision {
        let _pause = ClockPause::new(self.clocks.get(task_id));
        self.wait_inner(approval_id, cancel).await
    }

    pub async fn wait_or_withdraw(
        &self,
        approval_id: &str,
        task_id: &str,
        cancel: &CancellationToken,
        withdraw: &CancellationToken,
    ) -> Option<Decision> {
        let _pause = ClockPause::new(self.clocks.get(task_id));
        tokio::select! {
            biased;
            decision = self.wait_inner(approval_id, cancel) => Some(decision),
            _ = withdraw.cancelled() => None,
        }
    }

    async fn wait_inner(&self, approval_id: &str, cancel: &CancellationToken) -> Decision {
        loop {
            let decided = self.decided.notified();
            let (root, id) = (self.store_root.clone(), approval_id.to_owned());
            let read = tokio::task::spawn_blocking(move || {
                TaskStore::new(root).and_then(|store| store.approval(&id))
            })
            .await
            .map_err(|error| error.to_string())
            .and_then(|record| record);
            let record = match read {
                Ok(record) => record,
                Err(error) => return Decision::Denied(error),
            };
            match record.status {
                ApprovalStatus::Approved => return Decision::Approved,
                ApprovalStatus::Denied => return Decision::Denied(DENIED.into()),
                ApprovalStatus::Expired => return Decision::Denied(EXPIRED.into()),
                ApprovalStatus::Withdrawn => return Decision::Denied(CANCELLED.into()),
                ApprovalStatus::Pending if record.expires_at <= now_ms() => {
                    let _ = self
                        .store()
                        .and_then(|store| store.expire_approval(approval_id));
                    return Decision::Denied(EXPIRED.into());
                }
                ApprovalStatus::Pending => {}
            }
            tokio::select! {
                _ = decided => {}
                _ = tokio::time::sleep(POLL) => {}
                _ = cancel.cancelled() => return Decision::Denied(CANCELLED.into()),
            }
        }
    }

    pub fn decide(&self, approval_id: &str, approve: bool) -> Result<ApprovalRecord, String> {
        let record = self.store()?.decide_approval(approval_id, approve)?;
        self.decided.notify_waiters();
        Ok(record)
    }

    pub fn pending(&self, project_id: &str) -> Result<Vec<ApprovalRecord>, String> {
        self.store()?.pending_approvals(project_id)
    }
}

#[derive(Clone)]
pub struct GateContext {
    pub task_id: String,
    pub project_id: String,
    pub task_title: String,
    pub generation: u64,
    pub policy: CommandPolicy,
    pub events: Option<TaskEventSink>,
}

fn emit(ctx: &GateContext, event: TaskRuntimeEvent) {
    if let Some(events) = &ctx.events {
        events(event);
    }
}

struct OpenRequest {
    tasks_root: PathBuf,
    ctx: GateContext,
    id: String,
    kind: ApprovalKind,
    summary: String,
    waiting: bool,
}

impl Drop for OpenRequest {
    fn drop(&mut self) {
        if !self.waiting {
            return;
        }
        if let Ok(store) = TaskStore::new(self.tasks_root.clone()) {
            let _ = store.withdraw_approval(&self.id);
        }
        emit(
            &self.ctx,
            TaskRuntimeEvent::Approval {
                approval_id: self.id.clone(),
                approval_kind: self.kind,
                status: ApprovalStatus::Withdrawn,
                summary: self.summary.clone(),
            },
        );
        emit(
            &self.ctx,
            TaskRuntimeEvent::Phase {
                phase: TaskPhase::Working,
            },
        );
    }
}

pub async fn gate(
    services: &TaskServices,
    ctx: &GateContext,
    kind: ApprovalKind,
    summary: &str,
    detail: &str,
    cancel: &CancellationToken,
) -> Result<(), String> {
    match ctx.policy {
        CommandPolicy::Allow => return Ok(()),
        CommandPolicy::Off => return Err(COMMANDS_OFF.into()),
        CommandPolicy::Ask => {}
    }
    if detail.len() > MAX_DETAIL_BYTES {
        return Err(TOO_LONG_TO_SHOW.into());
    }
    let withdraw = services.suspends.approvals(&ctx.task_id);
    if withdraw.is_cancelled() {
        return Err(APPROVAL_WITHDRAWN.into());
    }
    let queue = &services.approvals;
    let id = queue.request(&ctx.task_id, ctx.generation, kind, summary, detail)?;
    let event = |status| TaskRuntimeEvent::Approval {
        approval_id: id.clone(),
        approval_kind: kind,
        status,
        summary: summary.chars().take(MAX_SUMMARY_CHARS).collect(),
    };
    let mut open = OpenRequest {
        tasks_root: services.tasks_root.clone(),
        ctx: ctx.clone(),
        id: id.clone(),
        kind,
        summary: summary.chars().take(MAX_SUMMARY_CHARS).collect(),
        waiting: true,
    };
    emit(ctx, event(ApprovalStatus::Pending));
    emit(
        ctx,
        TaskRuntimeEvent::Phase {
            phase: TaskPhase::WaitingApproval,
        },
    );
    let decision = queue
        .wait_or_withdraw(&id, &ctx.task_id, cancel, &withdraw)
        .await;
    open.waiting = false;
    emit(
        ctx,
        TaskRuntimeEvent::Phase {
            phase: TaskPhase::Working,
        },
    );
    let Some(decision) = decision else {
        if let Ok(store) = TaskStore::new(services.tasks_root.clone()) {
            let _ = store.withdraw_approvals(&ctx.task_id, ctx.generation);
        }
        emit(ctx, event(ApprovalStatus::Withdrawn));
        return Err(APPROVAL_WITHDRAWN.into());
    };
    match decision {
        Decision::Approved => {
            emit(ctx, event(ApprovalStatus::Approved));
            Ok(())
        }
        Decision::Denied(reason) => {
            let status = if reason == EXPIRED {
                ApprovalStatus::Expired
            } else if reason == CANCELLED {
                ApprovalStatus::Withdrawn
            } else {
                ApprovalStatus::Denied
            };
            emit(ctx, event(status));
            Err(reason)
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;
    use std::time::Instant;

    use super::*;
    use crate::budget::BudgetClock;
    use crate::model::{ResearchTask, TaskBudget};
    use crate::runs::RunManager;
    use crate::scheduler::{lock, SuspendMode, SuspendSignals};
    use crate::store::approvals::NO_LONGER_WAITING;
    use crate::test_support::{draft, CHILD_PATIENCE};

    struct Fixture {
        _directory: tempfile::TempDir,
        root: PathBuf,
        store: TaskStore,
        task_id: String,
        generation: u64,
        services: TaskServices,
        events: Arc<Mutex<Vec<TaskRuntimeEvent>>>,
    }

    fn running(store: &TaskStore, project_id: &str, title: &str) -> ResearchTask {
        let task = store.create(draft(project_id, title)).unwrap();
        store.request_start(&task.id).unwrap();
        let claimed = store.claim_next().unwrap().unwrap();
        assert_eq!(claimed.id, task.id);
        claimed
    }

    fn fixture() -> Fixture {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("tasks");
        let store = TaskStore::new(root.clone()).unwrap();
        let task = running(&store, "paper", "Asks first");
        let clocks = Arc::new(BudgetClocks::default());
        let services = TaskServices {
            runs: RunManager::new(root.clone(), tokio::runtime::Handle::current()),
            tasks_root: root.clone(),
            clocks: clocks.clone(),
            approvals: ApprovalQueue::new(root.clone(), clocks),
            workspace: None,
            suspends: Arc::new(SuspendSignals::default()),
        };
        Fixture {
            _directory: directory,
            root,
            store,
            task_id: task.id,
            generation: task.execution_generation,
            services,
            events: Arc::new(Mutex::new(Vec::new())),
        }
    }

    fn context(fixture: &Fixture, policy: CommandPolicy) -> GateContext {
        let events = fixture.events.clone();
        let sink: TaskEventSink =
            Arc::new(move |event: TaskRuntimeEvent| lock(&events).push(event));
        GateContext {
            task_id: fixture.task_id.clone(),
            project_id: "paper".into(),
            task_title: "Asks first".into(),
            generation: fixture.generation,
            policy,
            events: Some(sink),
        }
    }

    fn ask(
        fixture: &Fixture,
        cancel: &CancellationToken,
    ) -> tokio::task::JoinHandle<Result<(), String>> {
        let services = fixture.services.clone();
        let context = context(fixture, CommandPolicy::Ask);
        let cancel = cancel.clone();
        tokio::spawn(async move {
            gate(
                &services,
                &context,
                ApprovalKind::Command,
                "Run the tests",
                "pytest -q",
                &cancel,
            )
            .await
        })
    }

    async fn waiting_request(fixture: &Fixture) -> String {
        tokio::time::timeout(CHILD_PATIENCE, async {
            loop {
                if let Some(record) = fixture
                    .services
                    .approvals
                    .pending("paper")
                    .unwrap()
                    .into_iter()
                    .next()
                {
                    return record.id;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("the task never asked")
    }

    async fn answer(asking: tokio::task::JoinHandle<Result<(), String>>) -> Result<(), String> {
        tokio::time::timeout(CHILD_PATIENCE, asking)
            .await
            .expect("the gate never let the action through or refused it")
            .unwrap()
    }

    fn statuses(fixture: &Fixture) -> Vec<ApprovalStatus> {
        lock(&fixture.events)
            .iter()
            .filter_map(|event| match event {
                TaskRuntimeEvent::Approval { status, .. } => Some(*status),
                _ => None,
            })
            .collect()
    }

    fn request_rows(fixture: &Fixture) -> i64 {
        rusqlite::Connection::open(fixture.root.join("tasks.sqlite3"))
            .unwrap()
            .query_row("SELECT COUNT(*) FROM research_task_approvals", [], |row| {
                row.get(0)
            })
            .unwrap()
    }

    #[tokio::test]
    async fn command_policy_off_refuses_without_asking() {
        let fixture = fixture();
        let cancel = CancellationToken::new();
        let refused = gate(
            &fixture.services,
            &context(&fixture, CommandPolicy::Off),
            ApprovalKind::Command,
            "Run the tests",
            "pytest -q",
            &cancel,
        )
        .await;
        assert_eq!(
            refused,
            Err("Commands are turned off for this task.".to_string())
        );
        let allowed = gate(
            &fixture.services,
            &context(&fixture, CommandPolicy::Allow),
            ApprovalKind::Run,
            "Start run train",
            "train\npython train.py",
            &cancel,
        )
        .await;
        assert_eq!(allowed, Ok(()));
        assert_eq!(request_rows(&fixture), 0);
        assert!(lock(&fixture.events).is_empty());
        assert_eq!(
            fixture
                .store
                .require(&fixture.task_id)
                .unwrap()
                .pending_approvals,
            0
        );
    }

    #[tokio::test]
    async fn a_request_too_long_to_show_is_refused_instead_of_shortened() {
        let fixture = fixture();
        let context = context(&fixture, CommandPolicy::Ask);
        let refused = gate(
            &fixture.services,
            &context,
            ApprovalKind::Mcp,
            "Use search",
            &"x".repeat(MAX_DETAIL_BYTES + 1),
            &CancellationToken::new(),
        )
        .await;
        assert_eq!(refused, Err(TOO_LONG_TO_SHOW.to_owned()));
        assert!(fixture
            .services
            .approvals
            .pending("paper")
            .unwrap()
            .is_empty());
        let services = fixture.services.clone();
        let asking = tokio::spawn(async move {
            gate(
                &services,
                &context,
                ApprovalKind::Mcp,
                "Use search",
                &"x".repeat(MAX_DETAIL_BYTES),
                &CancellationToken::new(),
            )
            .await
        });
        let id = waiting_request(&fixture).await;
        assert_eq!(
            fixture.store.approval(&id).unwrap().detail.len(),
            MAX_DETAIL_BYTES
        );
        fixture.services.approvals.decide(&id, true).unwrap();
        assert_eq!(answer(asking).await, Ok(()));
    }

    #[tokio::test]
    async fn requests_are_bounded_and_need_the_running_generation() {
        let fixture = fixture();
        let queue = &fixture.services.approvals;
        let summary = format!("  {}  ", "s".repeat(400));
        let detail = "é".repeat(10_000);
        let id = queue
            .request(
                &fixture.task_id,
                fixture.generation,
                ApprovalKind::Run,
                &summary,
                &detail,
            )
            .unwrap();
        let record = fixture.store.approval(&id).unwrap();
        assert_eq!(record.summary, "s".repeat(300));
        assert_eq!(record.detail.len(), 16 * 1024);
        assert!(detail.starts_with(&record.detail));
        assert_eq!(record.kind, ApprovalKind::Run);
        assert_eq!(record.status, ApprovalStatus::Pending);
        assert_eq!(record.execution_generation, fixture.generation);
        assert_eq!(record.decided_at, None);
        let day = APPROVAL_EXPIRY.as_millis() as i64;
        let lifetime = record.expires_at - record.created_at;
        assert!((day - 5_000..=day).contains(&lifetime), "{lifetime}");

        assert_eq!(
            queue
                .request(
                    &fixture.task_id,
                    fixture.generation + 1,
                    ApprovalKind::Command,
                    "Run",
                    "ls"
                )
                .unwrap_err(),
            "The task stopped before it could ask."
        );
        let queued = fixture.store.create(draft("paper", "Not started")).unwrap();
        assert!(queue
            .request(
                &queued.id,
                queued.execution_generation,
                ApprovalKind::Command,
                "Run",
                "ls"
            )
            .is_err());
        assert_eq!(request_rows(&fixture), 1);
    }

    #[tokio::test]
    async fn pending_requests_are_listed_per_project_oldest_first() {
        let fixture = fixture();
        let queue = &fixture.services.approvals;
        let second = running(&fixture.store, "paper", "Also asks");
        let elsewhere = running(&fixture.store, "other", "Asks elsewhere");
        let ask = |task_id: &str, generation: u64| {
            let id = queue
                .request(task_id, generation, ApprovalKind::Command, "Run", "ls")
                .unwrap();
            std::thread::sleep(Duration::from_millis(2));
            id
        };
        let first_id = ask(&fixture.task_id, fixture.generation);
        let other_id = ask(&elsewhere.id, elsewhere.execution_generation);
        let second_id = ask(&second.id, second.execution_generation);
        let ids = |project: &str| {
            queue
                .pending(project)
                .unwrap()
                .into_iter()
                .map(|record| record.id)
                .collect::<Vec<_>>()
        };
        assert_eq!(ids("paper"), vec![first_id.clone(), second_id.clone()]);
        assert_eq!(ids("other"), vec![other_id]);

        queue.decide(&first_id, true).unwrap();
        assert_eq!(ids("paper"), vec![second_id.clone()]);
        fixture
            .store
            .finish_failure(&second.id, second.execution_generation, "stopped")
            .unwrap();
        assert!(ids("paper").is_empty());
        assert_eq!(
            fixture.store.approval(&second_id).unwrap().status,
            ApprovalStatus::Pending
        );
    }

    #[tokio::test]
    async fn a_decision_needs_a_request_that_still_waits() {
        let fixture = fixture();
        let queue = &fixture.services.approvals;
        let ask = || {
            queue
                .request(
                    &fixture.task_id,
                    fixture.generation,
                    ApprovalKind::Command,
                    "Run",
                    "ls",
                )
                .unwrap()
        };
        let approved = ask();
        let decided = queue.decide(&approved, true).unwrap();
        assert_eq!(decided.status, ApprovalStatus::Approved);
        assert!(decided.decided_at.is_some());
        assert_eq!(
            queue.decide(&approved, false).unwrap_err(),
            NO_LONGER_WAITING
        );
        assert_eq!(
            fixture.store.approval(&approved).unwrap().status,
            ApprovalStatus::Approved
        );

        let withdrawn = ask();
        assert_eq!(
            fixture
                .store
                .withdraw_approvals(&fixture.task_id, fixture.generation)
                .unwrap(),
            1
        );
        assert_eq!(
            queue.decide(&withdrawn, true).unwrap_err(),
            NO_LONGER_WAITING
        );
        assert_eq!(
            fixture.store.approval(&withdrawn).unwrap().status,
            ApprovalStatus::Withdrawn
        );

        let overdue = fixture
            .store
            .insert_approval(
                &fixture.task_id,
                fixture.generation,
                ApprovalKind::Command,
                "Run",
                "ls",
                now_ms() - 1,
            )
            .unwrap();
        assert_eq!(
            queue.decide(&overdue.id, true).unwrap_err(),
            NO_LONGER_WAITING
        );
        assert_eq!(
            queue.decide("approval-unknown", true).unwrap_err(),
            NO_LONGER_WAITING
        );
    }

    #[tokio::test]
    async fn approvals_expire_after_a_day() {
        let fixture = fixture();
        let overdue = fixture
            .store
            .insert_approval(
                &fixture.task_id,
                fixture.generation,
                ApprovalKind::Command,
                "Run the tests",
                "pytest -q",
                now_ms() - 1,
            )
            .unwrap();
        let decision = fixture
            .services
            .approvals
            .wait(&overdue.id, &fixture.task_id, &CancellationToken::new())
            .await;
        assert_eq!(
            decision,
            Decision::Denied("Nobody answered the approval request in 24 hours.".into())
        );
        let row = fixture.store.approval(&overdue.id).unwrap();
        assert_eq!(row.status, ApprovalStatus::Expired);
        assert!(row.decided_at.is_some());
    }

    #[tokio::test]
    async fn a_request_nobody_answers_expires_through_the_gate() {
        let fixture = fixture();
        let asking = ask(&fixture, &CancellationToken::new());
        let id = waiting_request(&fixture).await;
        let connection = rusqlite::Connection::open(fixture.root.join("tasks.sqlite3")).unwrap();
        connection.busy_timeout(Duration::from_secs(5)).unwrap();
        connection
            .execute(
                "UPDATE research_task_approvals SET expires_at = ?2 WHERE id = ?1",
                rusqlite::params![id, now_ms() - 1],
            )
            .unwrap();
        drop(connection);

        assert_eq!(answer(asking).await, Err(EXPIRED.to_string()));
        assert_eq!(
            fixture.store.approval(&id).unwrap().status,
            ApprovalStatus::Expired
        );
        assert_eq!(
            statuses(&fixture),
            vec![ApprovalStatus::Pending, ApprovalStatus::Expired]
        );
    }

    #[tokio::test]
    async fn an_approved_request_lets_the_action_through() {
        let fixture = fixture();
        let asking = ask(&fixture, &CancellationToken::new());
        let id = waiting_request(&fixture).await;
        assert_eq!(
            fixture
                .store
                .require(&fixture.task_id)
                .unwrap()
                .pending_approvals,
            1
        );
        fixture.services.approvals.decide(&id, true).unwrap();

        assert_eq!(answer(asking).await, Ok(()));
        assert_eq!(
            fixture.store.approval(&id).unwrap().status,
            ApprovalStatus::Approved
        );
        let approval = |status| TaskRuntimeEvent::Approval {
            approval_id: id.clone(),
            approval_kind: ApprovalKind::Command,
            status,
            summary: "Run the tests".into(),
        };
        assert_eq!(
            *lock(&fixture.events),
            vec![
                approval(ApprovalStatus::Pending),
                TaskRuntimeEvent::Phase {
                    phase: TaskPhase::WaitingApproval
                },
                TaskRuntimeEvent::Phase {
                    phase: TaskPhase::Working
                },
                approval(ApprovalStatus::Approved),
            ]
        );
    }

    #[tokio::test]
    async fn a_denied_request_returns_the_denial() {
        let fixture = fixture();
        let asking = ask(&fixture, &CancellationToken::new());
        let id = waiting_request(&fixture).await;
        fixture.services.approvals.decide(&id, false).unwrap();

        assert_eq!(
            answer(asking).await,
            Err("The user didn't approve this command.".to_string())
        );
        assert_eq!(
            fixture.store.approval(&id).unwrap().status,
            ApprovalStatus::Denied
        );
        assert_eq!(
            statuses(&fixture),
            vec![ApprovalStatus::Pending, ApprovalStatus::Denied]
        );
    }

    #[tokio::test]
    async fn cancelling_the_task_ends_the_wait() {
        let fixture = fixture();
        let cancel = CancellationToken::new();
        let asking = ask(&fixture, &cancel);
        waiting_request(&fixture).await;
        cancel.cancel();

        assert_eq!(
            answer(asking).await,
            Err("The task was cancelled.".to_string())
        );
        assert_eq!(
            statuses(&fixture),
            vec![ApprovalStatus::Pending, ApprovalStatus::Withdrawn]
        );
    }

    #[tokio::test]
    async fn a_withdrawn_request_ends_the_wait() {
        let fixture = fixture();
        let asking = ask(&fixture, &CancellationToken::new());
        let id = waiting_request(&fixture).await;
        fixture
            .store
            .withdraw_approvals(&fixture.task_id, fixture.generation)
            .unwrap();

        assert_eq!(
            answer(asking).await,
            Err("The task was cancelled.".to_string())
        );
        assert_eq!(
            fixture.store.approval(&id).unwrap().status,
            ApprovalStatus::Withdrawn
        );
        assert_eq!(
            statuses(&fixture),
            vec![ApprovalStatus::Pending, ApprovalStatus::Withdrawn]
        );
    }

    #[tokio::test]
    async fn a_task_moving_to_another_process_asks_nothing_more() {
        let fixture = fixture();
        fixture
            .services
            .suspends
            .begin(&fixture.task_id, fixture.generation);
        fixture
            .services
            .suspends
            .signal(&fixture.task_id, SuspendMode::Prompt);

        assert_eq!(
            answer(ask(&fixture, &CancellationToken::new())).await,
            Err(APPROVAL_WITHDRAWN.to_string())
        );
        assert_eq!(request_rows(&fixture), 0);
        assert!(lock(&fixture.events).is_empty());
    }

    #[tokio::test]
    async fn a_dropped_wait_withdraws_its_request_and_resumes_the_clock() {
        let fixture = fixture();
        let now = Arc::new(Mutex::new(Instant::now()));
        let source = now.clone();
        let clock = Arc::new(BudgetClock::with_clock(
            TaskBudget::default(),
            0,
            Arc::new(|| None::<f64>),
            Box::new(move || *lock(&source)),
        ));
        fixture
            .services
            .clocks
            .insert(&fixture.task_id, clock.clone());
        let asking = ask(&fixture, &CancellationToken::new());
        let id = waiting_request(&fixture).await;
        asking.abort();
        let _ = asking.await;

        assert_eq!(
            fixture.store.approval(&id).unwrap().status,
            ApprovalStatus::Withdrawn
        );
        assert!(fixture
            .services
            .approvals
            .pending("paper")
            .unwrap()
            .is_empty());
        assert_eq!(
            fixture.services.approvals.decide(&id, true).unwrap_err(),
            NO_LONGER_WAITING
        );
        assert_eq!(
            statuses(&fixture),
            vec![ApprovalStatus::Pending, ApprovalStatus::Withdrawn]
        );
        assert_eq!(
            lock(&fixture.events).last(),
            Some(&TaskRuntimeEvent::Phase {
                phase: TaskPhase::Working
            })
        );
        *lock(&now) += Duration::from_secs(60);
        assert_eq!(clock.active_ms(), 60 * 1000, "the clock runs again");
    }

    #[tokio::test]
    async fn an_approval_wait_pauses_the_task_clock() {
        let fixture = fixture();
        let now = Arc::new(Mutex::new(Instant::now()));
        let source = now.clone();
        let clock = Arc::new(BudgetClock::with_clock(
            TaskBudget::default(),
            0,
            Arc::new(|| None::<f64>),
            Box::new(move || *lock(&source)),
        ));
        fixture
            .services
            .clocks
            .insert(&fixture.task_id, clock.clone());
        *lock(&now) += Duration::from_secs(5 * 60);
        let queue = &fixture.services.approvals;
        let id = queue
            .request(
                &fixture.task_id,
                fixture.generation,
                ApprovalKind::Command,
                "Run",
                "ls",
            )
            .unwrap();

        let cancel = CancellationToken::new();
        let waiting = queue.wait(&id, &fixture.task_id, &cancel);
        let answering = async {
            tokio::time::sleep(Duration::from_millis(50)).await;
            *lock(&now) += Duration::from_secs(10 * 60);
            assert_eq!(clock.active_ms(), 5 * 60 * 1000);
            queue.decide(&id, true).unwrap();
        };
        let (decision, ()) = tokio::join!(waiting, answering);
        assert_eq!(decision, Decision::Approved);
        assert_eq!(clock.active_ms(), 5 * 60 * 1000);
        *lock(&now) += Duration::from_secs(60);
        assert_eq!(
            clock.active_ms(),
            6 * 60 * 1000,
            "the clock runs again after the answer"
        );
    }
}
