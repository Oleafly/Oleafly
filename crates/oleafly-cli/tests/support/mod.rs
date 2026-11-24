use std::ffi::OsString;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::time::{Duration, Instant};

pub fn compiler_fixture(directory: &Path, failure: bool) -> PathBuf {
    let name = if failure {
        "fixture-failure"
    } else {
        "fixture-success"
    };
    rust_fixture(
        directory,
        "compiler.rs",
        name,
        failure.then_some("fixture_failure"),
    )
}

pub fn rust_fixture(directory: &Path, source: &str, name: &str, cfg: Option<&str>) -> PathBuf {
    let source = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(source);
    let output = directory.join(oleafly_cli::executable_name(name));
    let mut command =
        Command::new(std::env::var_os("RUSTC").unwrap_or_else(|| OsString::from("rustc")));
    command
        .args(["--edition=2021", "-o"])
        .arg(&output)
        .arg(source);
    if let Some(cfg) = cfg {
        command.args(["--cfg", cfg]);
    }
    let result = command.output().unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    output.canonicalize().unwrap()
}

#[cfg(unix)]
pub fn set_hangup(command: &mut Command, disposition: libc::sighandler_t) {
    use std::os::unix::process::CommandExt;
    // SAFETY: the hook only calls signal(2), which is async-signal-safe, between fork and exec.
    unsafe {
        command.pre_exec(move || {
            if libc::signal(libc::SIGHUP, disposition) == libc::SIG_ERR {
                Err(std::io::Error::last_os_error())
            } else {
                Ok(())
            }
        });
    }
}

pub fn exit_within(child: &mut Child, within: Duration) -> ExitStatus {
    let deadline = Instant::now() + within;
    loop {
        if let Some(status) = child.try_wait().unwrap() {
            return status;
        }
        assert!(
            Instant::now() < deadline,
            "the process kept running past {within:?}"
        );
        std::thread::sleep(Duration::from_millis(20));
    }
}

pub struct Running {
    pub process: Child,
    pub lines: Receiver<String>,
}

impl Running {
    pub fn start(command: &mut Command) -> Running {
        let mut process = command.stdout(Stdio::piped()).spawn().unwrap();
        let stdout = process.stdout.take().unwrap();
        let (sender, lines) = mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if sender.send(line).is_err() {
                    break;
                }
            }
        });
        Running { process, lines }
    }
}

impl Drop for Running {
    fn drop(&mut self) {
        let _ = self.process.kill();
        let _ = self.process.wait();
    }
}
