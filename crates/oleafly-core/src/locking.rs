//! Bounded admission to storage transactions. A busy store must return an
//! error without stealing its owner's lock or changing any stored data.
use std::fs::File;
use std::io;
use std::sync::{Mutex, MutexGuard, TryLockError};
use std::time::{Duration, Instant};

pub const STORAGE_LOCK_TIMEOUT: Duration = Duration::from_secs(30);

fn retry<T>(budget: Duration, mut attempt: impl FnMut() -> io::Result<Option<T>>) -> io::Result<T> {
    let started = Instant::now();
    let mut delay = Duration::from_millis(2);
    loop {
        if let Some(value) = attempt()? {
            return Ok(value);
        }
        let remaining = budget.saturating_sub(started.elapsed());
        if remaining.is_zero() {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "storage is busy with another operation; retry when it finishes",
            ));
        }
        std::thread::sleep(delay.min(remaining));
        delay = (delay * 2).min(Duration::from_millis(100));
    }
}

pub fn lock_file(file: &File, exclusive: bool, budget: Duration) -> io::Result<()> {
    retry(budget, || {
        let result = if exclusive {
            fs4::FileExt::try_lock(file)
        } else {
            fs4::FileExt::try_lock_shared(file)
        };
        match result {
            Ok(()) => Ok(Some(())),
            Err(fs4::TryLockError::WouldBlock) => Ok(None),
            Err(fs4::TryLockError::Error(error)) => Err(error),
        }
    })
}

pub fn lock_mutex<T>(mutex: &Mutex<T>, budget: Duration) -> io::Result<MutexGuard<'_, T>> {
    retry(budget, || match mutex.try_lock() {
        Ok(guard) => Ok(Some(guard)),
        Err(TryLockError::Poisoned(error)) => Ok(Some(error.into_inner())),
        Err(TryLockError::WouldBlock) => Ok(None),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn busy_file_lock_times_out_and_preserves_ownership() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("transaction.lock");
        let first = File::create(&path).unwrap();
        let second = File::options().read(true).write(true).open(&path).unwrap();
        lock_file(&first, true, Duration::ZERO).unwrap();
        for exclusive in [false, true] {
            let started = Instant::now();
            let error = lock_file(&second, exclusive, Duration::from_millis(25)).unwrap_err();
            assert_eq!(error.kind(), io::ErrorKind::TimedOut);
            assert!(started.elapsed() < Duration::from_secs(2));
        }
        fs4::FileExt::unlock(&first).unwrap();
        lock_file(&second, true, Duration::ZERO).unwrap();
    }

    #[test]
    fn shared_readers_can_coexist_and_a_waiter_recovers_after_release() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("transaction.lock");
        let first = File::options()
            .read(true)
            .write(true)
            .create_new(true)
            .open(&path)
            .unwrap();
        let second = File::options().read(true).write(true).open(&path).unwrap();
        lock_file(&first, false, Duration::ZERO).unwrap();
        lock_file(&second, false, Duration::ZERO).unwrap();
        fs4::FileExt::unlock(&second).unwrap();
        let release = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(30));
            fs4::FileExt::unlock(&first).unwrap();
        });
        lock_file(&second, true, Duration::from_secs(2)).unwrap();
        release.join().unwrap();
    }

    #[test]
    fn busy_mutex_has_a_deadline_and_can_be_retried() {
        let mutex = Mutex::new(7);
        let guard = mutex.lock().unwrap();
        assert_eq!(
            lock_mutex(&mutex, Duration::from_millis(10))
                .unwrap_err()
                .kind(),
            io::ErrorKind::TimedOut
        );
        drop(guard);
        assert_eq!(*lock_mutex(&mutex, Duration::ZERO).unwrap(), 7);
    }
}
