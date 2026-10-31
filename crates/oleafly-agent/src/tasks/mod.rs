use std::future::Future;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, Weak};
use std::time::Duration;

use tokio::sync::watch;

pub const GRACEFULL_INTERRUPTION_TIMEOUT_MS: u64 = 100;

struct CancelInner {
    cancelled: AtomicBool,
    wake: watch::Sender<u64>,
    parent: Option<Weak<CancelInner>>,
    children: Mutex<Vec<Weak<CancelInner>>>,
}

#[derive(Clone)]
pub struct CancellationToken {
    inner: Arc<CancelInner>,
}

impl Default for CancellationToken {
    fn default() -> Self {
        Self::new()
    }
}

impl CancellationToken {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(CancelInner {
                cancelled: AtomicBool::new(false),
                wake: watch::Sender::new(0),
                parent: None,
                children: Mutex::new(Vec::new()),
            }),
        }
    }

    pub fn child(&self) -> Self {
        let child = Self {
            inner: Arc::new(CancelInner {
                cancelled: AtomicBool::new(false),
                wake: watch::Sender::new(0),
                parent: Some(Arc::downgrade(&self.inner)),
                children: Mutex::new(Vec::new()),
            }),
        };
        let mut children = lock_children(&self.inner);
        children.push(Arc::downgrade(&child.inner));
        child
    }

    pub fn cancel(&self) {
        if self.inner.cancelled.swap(true, Ordering::SeqCst) {
            return;
        }
        self.inner.wake.send_modify(|version| *version += 1);
        let children = std::mem::take(&mut *lock_children(&self.inner));
        for child in children {
            if let Some(live) = child.upgrade() {
                CancellationToken { inner: live }.cancel();
            }
        }
    }

    pub fn is_cancelled(&self) -> bool {
        is_cancelled_deep(&self.inner)
    }

    pub async fn cancelled(&self) {
        loop {
            let mut receiver = self.inner.wake.subscribe();
            if self.is_cancelled() {
                return;
            }
            if receiver.changed().await.is_err() {
                return;
            }
        }
    }

    pub async fn run_with_graceful_abort<T>(
        &self,
        task: impl Future<Output = T> + Send + 'static,
    ) -> Option<T>
    where
        T: Send + 'static,
    {
        let mut handle = tokio::spawn(task);
        tokio::select! {
            output = &mut handle => output.ok(),
            _ = self.cancelled() => {
                let grace = Duration::from_millis(GRACEFULL_INTERRUPTION_TIMEOUT_MS);
                match tokio::time::timeout(grace, &mut handle).await {
                    Ok(output) => output.ok(),
                    Err(_) => {
                        handle.abort();
                        handle.await.ok()
                    }
                }
            }
        }
    }
}

fn is_cancelled_deep(inner: &CancelInner) -> bool {
    if inner.cancelled.load(Ordering::SeqCst) {
        return true;
    }
    inner
        .parent
        .as_ref()
        .and_then(std::sync::Weak::upgrade)
        .is_some_and(|parent| is_cancelled_deep(&parent))
}

fn lock_children(inner: &CancelInner) -> std::sync::MutexGuard<'_, Vec<Weak<CancelInner>>> {
    inner
        .children
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn cancelling_a_parent_cancels_descendants_but_not_ancestors() {
        let parent = CancellationToken::new();
        let child = parent.child();
        let grandchild = child.child();
        let sibling = parent.child();

        child.cancel();
        assert!(child.is_cancelled());
        assert!(grandchild.is_cancelled());
        assert!(!parent.is_cancelled());
        assert!(!sibling.is_cancelled());

        parent.cancel();
        assert!(sibling.is_cancelled());
    }

    #[tokio::test]
    async fn cancelled_resolves_for_every_watcher_after_cancel() {
        let parent = CancellationToken::new();
        let child = parent.child();
        let waiter = tokio::spawn({
            let child = child.clone();
            async move {
                child.cancelled().await;
                "woke"
            }
        });
        tokio::time::sleep(Duration::from_millis(1)).await;
        parent.cancel();
        assert_eq!(waiter.await.unwrap(), "woke");
    }

    #[tokio::test]
    async fn cancel_is_idempotent() {
        let token = CancellationToken::new();
        token.cancel();
        token.cancel();
        assert!(token.is_cancelled());
    }

    #[tokio::test]
    async fn a_dropped_child_does_not_break_parent_cancellation() {
        let parent = CancellationToken::new();
        let child = parent.child();
        drop(child);
        parent.cancel();
        assert!(parent.is_cancelled());
    }

    #[tokio::test]
    async fn a_task_that_finishes_within_the_grace_window_keeps_its_output() {
        let token = CancellationToken::new();
        let task_token = token.clone();
        let result = token
            .run_with_graceful_abort(async move {
                task_token.cancel();
                tokio::time::sleep(Duration::from_millis(5)).await;
                "recorded"
            })
            .await;
        assert_eq!(result, Some("recorded"));
    }

    #[tokio::test]
    async fn a_task_that_overruns_the_grace_window_is_aborted() {
        let token = CancellationToken::new();
        let task_token = token.clone();
        let result = token
            .run_with_graceful_abort(async move {
                task_token.cancel();
                tokio::time::sleep(Duration::from_millis(400)).await;
                "should not be recorded"
            })
            .await;
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn an_uncancelled_task_returns_its_output() {
        let token = CancellationToken::new();
        let result = token.run_with_graceful_abort(async { "plain" }).await;
        assert_eq!(result, Some("plain"));
        assert!(!token.is_cancelled());
    }
}
