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

fn sample(pid: u32) -> Option<(u64, u64)> {
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
