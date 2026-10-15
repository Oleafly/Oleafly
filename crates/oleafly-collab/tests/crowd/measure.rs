use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::Duration;

#[derive(Debug, Clone, Copy, Default)]
pub struct Percentiles {
    pub count: usize,
    pub p50: f64,
    pub p95: f64,
    pub p99: f64,
    pub max: f64,
}

impl Percentiles {
    pub fn of(samples: &mut [u64]) -> Percentiles {
        if samples.is_empty() {
            return Percentiles::default();
        }
        samples.sort_unstable();
        let at = |fraction: f64| {
            let index = ((samples.len() as f64 - 1.0) * fraction).round() as usize;
            samples[index.min(samples.len() - 1)] as f64 / 1000.0
        };
        Percentiles {
            count: samples.len(),
            p50: at(0.50),
            p95: at(0.95),
            p99: at(0.99),
            max: samples[samples.len() - 1] as f64 / 1000.0,
        }
    }

    pub fn line(&self) -> String {
        if self.count == 0 {
            return "no samples".to_owned();
        }
        format!(
            "p50 {:.1} ms, p95 {:.1} ms, p99 {:.1} ms, max {:.1} ms (n={})",
            self.p50, self.p95, self.p99, self.max, self.count
        )
    }
}

pub struct ProcessSampler {
    running: Arc<AtomicBool>,
    peak_kb: Arc<AtomicU64>,
    cpu_ms: Arc<AtomicU64>,
    thread: Option<JoinHandle<()>>,
}

fn parse_cpu(text: &str) -> Option<u64> {
    let (days, rest) = match text.split_once('-') {
        Some((days, rest)) => (days.parse::<u64>().ok()?, rest),
        None => (0, text),
    };
    let mut seconds = 0.0f64;
    for part in rest.split(':') {
        seconds = seconds * 60.0 + part.parse::<f64>().ok()?;
    }
    Some(((days as f64 * 86_400.0 + seconds) * 1000.0) as u64)
}

pub fn sample(pid: u32) -> Option<(u64, u64)> {
    let output = Command::new("ps")
        .args(["-o", "rss=", "-o", "time=", "-p", &pid.to_string()])
        .output()
        .ok()?;
    let text = String::from_utf8(output.stdout).ok()?;
    let mut fields = text.split_whitespace();
    let rss = fields.next()?.parse::<u64>().ok()?;
    let cpu = parse_cpu(fields.next()?)?;
    Some((rss, cpu))
}

impl ProcessSampler {
    pub fn start() -> ProcessSampler {
        let running = Arc::new(AtomicBool::new(true));
        let peak_kb = Arc::new(AtomicU64::new(0));
        let cpu_ms = Arc::new(AtomicU64::new(0));
        let (alive, peak, cpu) = (
            Arc::clone(&running),
            Arc::clone(&peak_kb),
            Arc::clone(&cpu_ms),
        );
        let pid = std::process::id();
        let thread = std::thread::spawn(move || {
            while alive.load(Ordering::SeqCst) {
                if let Some((rss, used)) = sample(pid) {
                    peak.fetch_max(rss, Ordering::SeqCst);
                    cpu.store(used, Ordering::SeqCst);
                }
                std::thread::sleep(Duration::from_millis(200));
            }
        });
        ProcessSampler {
            running,
            peak_kb,
            cpu_ms,
            thread: Some(thread),
        }
    }

    pub fn cpu_ms(&self) -> u64 {
        sample(std::process::id())
            .map_or_else(|| self.cpu_ms.load(Ordering::SeqCst), |(_, cpu)| cpu)
    }

    pub fn finish(mut self) -> (Option<u64>, Option<u64>) {
        self.running.store(false, Ordering::SeqCst);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
        let final_sample = sample(std::process::id());
        if let Some((rss, _)) = final_sample {
            self.peak_kb.fetch_max(rss, Ordering::SeqCst);
        }
        let peak = self.peak_kb.load(Ordering::SeqCst);
        let cpu = final_sample.map(|(_, cpu)| cpu);
        ((peak > 0).then_some(peak), cpu)
    }
}

impl Drop for ProcessSampler {
    fn drop(&mut self) {
        self.running.store(false, Ordering::SeqCst);
    }
}

const BUCKET_GROWTH: f64 = 1.02;

#[derive(Clone, Debug, Default, PartialEq)]
pub struct LogHistogram {
    counts: Vec<u64>,
    count: u64,
    max: u64,
}

impl LogHistogram {
    fn bucket(micros: u64) -> usize {
        if micros <= 1 {
            return 0;
        }
        ((micros as f64).ln() / BUCKET_GROWTH.ln()).floor() as usize
    }

    fn middle(bucket: usize) -> f64 {
        BUCKET_GROWTH.powi(bucket as i32) * (1.0 + BUCKET_GROWTH) / 2.0
    }

    pub fn record(&mut self, micros: u64) {
        let bucket = LogHistogram::bucket(micros);
        if self.counts.len() <= bucket {
            self.counts.resize(bucket + 1, 0);
        }
        self.counts[bucket] += 1;
        self.count += 1;
        self.max = self.max.max(micros);
    }

    pub fn merge(&mut self, other: &LogHistogram) {
        if self.counts.len() < other.counts.len() {
            self.counts.resize(other.counts.len(), 0);
        }
        for (bucket, count) in other.counts.iter().enumerate() {
            self.counts[bucket] += count;
        }
        self.count += other.count;
        self.max = self.max.max(other.max);
    }

    fn quantile(&self, fraction: f64) -> f64 {
        let wanted = ((self.count as f64 - 1.0) * fraction).round() as u64 + 1;
        let mut seen = 0u64;
        for (bucket, count) in self.counts.iter().enumerate() {
            seen += count;
            if seen >= wanted {
                return (LogHistogram::middle(bucket) / 1000.0).min(self.max as f64 / 1000.0);
            }
        }
        self.max as f64 / 1000.0
    }

    pub fn percentiles(&self) -> Percentiles {
        if self.count == 0 {
            return Percentiles::default();
        }
        Percentiles {
            count: usize::try_from(self.count).unwrap_or(usize::MAX),
            p50: self.quantile(0.50),
            p95: self.quantile(0.95),
            p99: self.quantile(0.99),
            max: self.max as f64 / 1000.0,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Storage {
    pub database: u64,
    pub snapshots: u64,
    pub blobs: u64,
}

fn folder_bytes(path: &std::path::Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(path) else {
        return 0;
    };
    entries
        .flatten()
        .map(|entry| match entry.metadata() {
            Ok(meta) if meta.is_dir() => folder_bytes(&entry.path()),
            Ok(meta) => meta.len(),
            Err(_) => 0,
        })
        .sum()
}

pub fn storage(root: &std::path::Path) -> Storage {
    let database = std::fs::read_dir(root)
        .map(|entries| {
            entries
                .flatten()
                .filter(|entry| {
                    entry
                        .file_name()
                        .to_string_lossy()
                        .starts_with("oleafly-server.sqlite3")
                })
                .filter_map(|entry| entry.metadata().ok())
                .map(|meta| meta.len())
                .sum()
        })
        .unwrap_or(0);
    let snapshots =
        folder_bytes(&root.join("blobs").join("snapshots")) + folder_bytes(&root.join("snapshots"));
    Storage {
        database,
        snapshots,
        blobs: folder_bytes(&root.join("blobs")).saturating_sub(snapshots),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_histogram_reports_percentiles_within_two_percent() {
        let mut histogram = LogHistogram::default();
        for millis in 1..=1_000u64 {
            histogram.record(millis * 1_000);
        }
        let summary = histogram.percentiles();
        assert_eq!(summary.count, 1_000);
        assert!((summary.p50 - 500.0).abs() <= 10.0, "{summary:?}");
        assert!((summary.p95 - 950.0).abs() <= 19.0, "{summary:?}");
        assert!((summary.p99 - 990.0).abs() <= 20.0, "{summary:?}");
        assert_eq!(summary.max, 1_000.0);
        let mut other = LogHistogram::default();
        other.record(5_000_000);
        histogram.merge(&other);
        assert_eq!(histogram.percentiles().count, 1_001);
        assert_eq!(histogram.percentiles().max, 5_000.0);
        assert_eq!(LogHistogram::default().percentiles().count, 0);
    }

    #[test]
    fn storage_is_split_into_database_snapshots_and_files() {
        let folder = tempfile::tempdir().expect("folder");
        let root = folder.path();
        let write = |relative: &str, bytes: usize| {
            let path = root.join(relative);
            std::fs::create_dir_all(path.parent().expect("parent")).expect("folders");
            std::fs::write(path, vec![0u8; bytes]).expect("file");
        };
        write("oleafly-server.sqlite3", 100);
        write("oleafly-server.sqlite3-wal", 50);
        write("oleafly-server.sqlite3-shm", 8);
        write("blobs/snapshots/p1/aaaa", 30);
        write("blobs/snapshots/p1/bbbb", 12);
        write("blobs/ab/abcdef", 20);
        write("server.log", 999);
        assert_eq!(
            storage(root),
            Storage {
                database: 158,
                snapshots: 42,
                blobs: 20,
            }
        );
    }
}
