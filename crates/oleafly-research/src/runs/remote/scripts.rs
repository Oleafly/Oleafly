//! POSIX `sh` scripts a remote run is driven with, and parsers for what they
//! print. Every path in a script is quoted, every id validated; environment
//! values go only into the run's owner-only supervisor script and are never
//! printed or put in an error.
use std::collections::BTreeMap;

use base64::Engine;
use serde::{Deserialize, Serialize};

use crate::runs::RunError;

/// The folder runs go to on a remote computer, below its home.
pub const DEFAULT_REMOTE_ROOT: &str = ".oleafly-runs";
const KILL_GRACE_SECS: u64 = 10;

pub struct RemoteRun<'a> {
    /// The run folder, relative to the remote home or absolute.
    pub dir: &'a str,
    pub command: &'a str,
    pub cwd_rel: &'a str,
    pub env: &'a BTreeMap<String, String>,
    pub timeout_secs: u64,
    pub prelude: &'a str,
}

/// How a run detaches from the connection that started it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Detach {
    /// `setsid`: its own session and process group.
    Setsid,
    /// macOS has no `setsid` command; Perl's POSIX module does the same.
    Perl,
    /// Neither: signals go to the recorded processes, not a group.
    Nohup,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Probe {
    pub home: String,
    pub os: String,
    pub rsync: bool,
    pub detach: Detach,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RemoteState {
    Missing,
    Running,
    Exited(i32),
    TimedOut,
    Cancelled,
    Lost,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PollReport {
    pub state: RemoteState,
    pub log_size: u64,
    pub chunk: Vec<u8>,
}

/// `value` in single quotes, safe in any `sh` word position.
pub fn sh_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

pub fn valid_env_name(name: &str) -> bool {
    let mut chars = name.chars();
    chars
        .next()
        .is_some_and(|first| first.is_ascii_alphabetic() || first == '_')
        && name.len() <= 128
        && chars.all(|character| character.is_ascii_alphanumeric() || character == '_')
}

fn valid_id(id: &str) -> bool {
    (1..=80).contains(&id.len())
        && id.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-')
        })
        && !id.chars().all(|character| character == '.')
}

fn valid_root(root: &str) -> bool {
    (1..=200).contains(&root.len())
        && !root.starts_with('-')
        && root.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '/' | '-')
        })
        && !root.split('/').any(|part| part == "..")
}

/// `<root>/<task>/<run>`: the root as configured (relative = below the
/// remote home), the ids checked.
pub fn run_dir(root: Option<&str>, task_id: &str, run_id: &str) -> Result<String, RunError> {
    if !valid_id(task_id) || !valid_id(run_id) {
        return Err(RunError::Config(
            "The run id is not valid for a remote folder.".into(),
        ));
    }
    let root = root
        .map(str::trim)
        .filter(|root| !root.is_empty())
        .unwrap_or(DEFAULT_REMOTE_ROOT);
    if !valid_root(root) {
        return Err(RunError::Config(
            "Enter a remote folder with letters, numbers, dots, dashes, underscores or slashes."
                .into(),
        ));
    }
    let trimmed = root.trim_end_matches('/');
    if trimmed.is_empty() {
        return Err(RunError::Config(
            "Choose a folder below the remote computer's root folder.".into(),
        ));
    }
    Ok(format!("{trimmed}/{task_id}/{run_id}"))
}

/// The task's folder that holds `dir` (`<root>/<task>`).
fn task_dir(dir: &str) -> Option<&str> {
    let (parent, run) = dir.rsplit_once('/')?;
    let task = parent.rsplit('/').next()?;
    (valid_id(run) && valid_id(task)).then_some(parent)
}

const PROBE: &str = r#"cd || exit 1
printf 'OLEAFLY_PROBE home %s\n' "$HOME"
printf 'OLEAFLY_PROBE os %s\n' "$(uname -s 2>/dev/null)"
if command -v setsid >/dev/null 2>&1; then echo 'OLEAFLY_PROBE setsid 1'; else echo 'OLEAFLY_PROBE setsid 0'; fi
if command -v perl >/dev/null 2>&1 && perl -MPOSIX -e 1 >/dev/null 2>&1; then echo 'OLEAFLY_PROBE perl 1'; else echo 'OLEAFLY_PROBE perl 0'; fi
if command -v rsync >/dev/null 2>&1; then echo 'OLEAFLY_PROBE rsync 1'; else echo 'OLEAFLY_PROBE rsync 0'; fi
echo 'OLEAFLY_PROBE end'
"#;

/// What the remote computer offers: home, OS, rsync, how to detach.
pub fn probe_script() -> &'static str {
    PROBE
}

pub fn parse_probe(stdout: &str) -> Result<Probe, RunError> {
    let mut values = BTreeMap::new();
    let mut ended = false;
    for line in stdout.lines() {
        let Some(rest) = line.trim_end_matches('\r').strip_prefix("OLEAFLY_PROBE ") else {
            continue;
        };
        if rest == "end" {
            ended = true;
            continue;
        }
        if let Some((key, value)) = rest.split_once(' ') {
            values.insert(key.to_string(), value.to_string());
        }
    }
    if !ended {
        return Err(RunError::Remote(
            "The remote computer didn't answer like a Linux or macOS shell. Oleafly runs need a POSIX shell (sh) there.".into(),
        ));
    }
    let os = values.get("os").cloned().unwrap_or_default();
    if ["MINGW", "MSYS", "CYGWIN", "Windows"]
        .iter()
        .any(|prefix| os.starts_with(prefix))
    {
        return Err(RunError::Config(
            "Runs on another computer need Linux or macOS there; this one runs Windows.".into(),
        ));
    }
    let flag = |key: &str| values.get(key).is_some_and(|value| value == "1");
    let detach = if flag("setsid") {
        Detach::Setsid
    } else if flag("perl") {
        Detach::Perl
    } else {
        Detach::Nohup
    };
    Ok(Probe {
        home: values.get("home").cloned().unwrap_or_default(),
        os,
        rsync: flag("rsync"),
        detach,
    })
}

/// A heredoc delimiter that no line of `content` equals.
fn delimiter(content: &str, mut candidate: impl FnMut() -> String) -> String {
    loop {
        let value = candidate();
        if !content
            .lines()
            .any(|line| line.trim_end_matches('\r') == value)
        {
            return value;
        }
    }
}

fn random_delimiter() -> String {
    format!("OLEAFLY_{:016x}", rand::random::<u64>())
}

fn heredoc(file: &str, content: &str) -> String {
    let end = delimiter(content, random_delimiter);
    let mut text = format!("cat > {file} <<'{end}'\n{content}");
    if !content.ends_with('\n') {
        text.push('\n');
    }
    text.push_str(&end);
    text.push('\n');
    text
}

fn exports(env: &BTreeMap<String, String>) -> Result<String, RunError> {
    let mut lines = String::new();
    for (name, value) in env {
        if !valid_env_name(name) {
            return Err(RunError::Config(format!(
                "{name} isn't a valid environment variable name."
            )));
        }
        if value.contains('\0') {
            return Err(RunError::Config(format!(
                "The value of {name} can't contain a NUL character."
            )));
        }
        lines.push_str(&format!("export {name}={}\n", sh_quote(value)));
    }
    Ok(lines)
}

fn work_dir(cwd_rel: &str) -> String {
    if cwd_rel.is_empty() {
        "\"$RUN/work\"".to_string()
    } else {
        format!("\"$RUN/work/\"{}", sh_quote(cwd_rel))
    }
}

/// The signal part of a kill for this detach mode.
fn kill_targets(signal: &str) -> String {
    format!(
        "if [ -s \"$RUN/pgid\" ]; then kill -{signal} -\"$(cat \"$RUN/pgid\")\" 2>/dev/null; \
         else for p in $(cat \"$RUN/child.pid\" 2>/dev/null); do kill -{signal} \"$p\" 2>/dev/null; done; fi"
    )
}

fn supervisor(run: &RemoteRun<'_>, detach: Detach) -> Result<String, RunError> {
    let group = match detach {
        // A new session makes the supervisor its group's leader.
        Detach::Setsid | Detach::Perl => "echo $$ > \"$RUN/pgid\"\n",
        Detach::Nohup => "",
    };
    let mut script = String::new();
    script.push_str("RUN=$(pwd)\n");
    script.push_str("echo $$ > \"$RUN/pid\"\n");
    script.push_str(group);
    script.push_str(
        "LC_ALL=C ps -o lstart= -p $$ > \"$RUN/pid.start\" 2>/dev/null || : > \"$RUN/pid.start\"\n",
    );
    script.push_str(
        "oleafly_finish() { echo \"$1\" > \"$RUN/exit_code.tmp\" && mv \"$RUN/exit_code.tmp\" \"$RUN/exit_code\"; }\n",
    );
    if !run.prelude.trim().is_empty() {
        script.push_str(run.prelude.trim_end());
        script.push('\n');
    }
    script.push_str(&exports(run.env)?);
    script.push_str(&format!(
        "cd {} 2>/dev/null || {{ oleafly_finish 97; exit 97; }}\n",
        work_dir(run.cwd_rel)
    ));
    // A trap with a command (not an ignored signal) is reset in children, so
    // the run itself still stops on TERM while the supervisor records why.
    script.push_str("trap ':' TERM HUP\n");
    script.push_str("sh \"$RUN/command.sh\" > \"$RUN/stdout.log\" 2>&1 < /dev/null &\n");
    script.push_str("CHILD=$!\n");
    script.push_str("echo $CHILD > \"$RUN/child.pid\"\n");
    // The watchdog checks every second, so it ends soon after the run does
    // and a signal sent to the whole group cannot cut its wait short.
    script.push_str(&format!(
        "( trap ':' TERM; i=0; while [ $i -lt {timeout} ] && [ ! -e \"$RUN/exit_code\" ]; do sleep 1; i=$((i + 1)); done; \
         if [ ! -e \"$RUN/exit_code\" ]; then : > \"$RUN/timed_out\"; {term}; \
         j=0; while [ $j -lt {grace} ] && [ ! -e \"$RUN/exit_code\" ]; do sleep 1; j=$((j + 1)); done; \
         [ -e \"$RUN/exit_code\" ] || {{ {kill}; }}; fi ) < /dev/null > /dev/null 2>&1 &\n",
        timeout = run.timeout_secs.max(1),
        term = kill_targets("TERM"),
        grace = KILL_GRACE_SECS,
        kill = kill_targets("KILL"),
    ));
    script.push_str(
        "while :; do wait \"$CHILD\"; CODE=$?; kill -0 \"$CHILD\" 2>/dev/null || break; done\n",
    );
    script.push_str("oleafly_finish \"$CODE\"\n");
    Ok(script)
}

fn launch_line(detach: Detach) -> &'static str {
    match detach {
        Detach::Setsid => "setsid sh supervise.sh < /dev/null > /dev/null 2>&1 &\n",
        Detach::Perl => "perl -MPOSIX -e 'setsid() or die; exec @ARGV' -- sh supervise.sh < /dev/null > /dev/null 2>&1 &\n",
        Detach::Nohup => "nohup sh supervise.sh < /dev/null > /dev/null 2>&1 &\n",
    }
}

fn start_body(run: &RemoteRun<'_>, detach: Detach) -> Result<String, RunError> {
    let supervise = supervisor(run, detach)?;
    let dir = sh_quote(run.dir);
    let mut script = String::new();
    script.push_str(&format!("mkdir -p {dir}/work\n"));
    script.push_str(&format!("cd {dir}\n"));
    script.push_str("if ! mkdir start.lock 2>/dev/null; then echo OLEAFLY_ALREADY; exit 0; fi\n");
    script.push_str("date +%s > started\n");
    // Files whose clock is ahead of this computer's must not count as outputs.
    script.push_str("find work -newer started -exec touch -r started {} + 2>/dev/null || :\n");
    script.push_str(&heredoc("command.sh", run.command));
    script.push_str(&heredoc("supervise.sh", &supervise));
    script.push_str(launch_line(detach));
    script.push_str("echo \"OLEAFLY_STARTED $!\"\n");
    Ok(script)
}

const HEADER: &str = "set -eu\numask 077\ncd\n";

/// Starts the run in its folder, whose `work/` already holds the workspace.
/// Starting twice prints `OLEAFLY_ALREADY` and changes nothing.
pub fn start_script(run: &RemoteRun<'_>, detach: Detach) -> Result<String, RunError> {
    Ok(format!("{HEADER}{}", start_body(run, detach)?))
}

/// Unpacks the uploaded workspace (a path below the remote home), then starts.
pub fn unpack_and_start_script(
    run: &RemoteRun<'_>,
    archive: &str,
    detach: Detach,
) -> Result<String, RunError> {
    let dir = sh_quote(run.dir);
    let archive = sh_quote(archive);
    Ok(format!(
        "{HEADER}if [ ! -e {dir}/started ]; then mkdir -p {dir}/work && tar -xzmf {archive} -C {dir}/work; fi\nrm -f {archive}\n{}",
        start_body(run, detach)?
    ))
}

/// Prints the run's state, the log size and up to `max_bytes` of the log
/// from `log_offset` as base64.
pub fn poll_script(dir: &str, log_offset: u64, max_bytes: u64) -> String {
    format!(
        r#"cd || exit 1
d={dir}
if [ ! -d "$d" ]; then echo 'OLEAFLY_STATE missing'; exit 0; fi
cd "$d"
alive=0
if [ -s pid ] && kill -0 "$(cat pid)" 2>/dev/null; then
  now=$(LC_ALL=C ps -o lstart= -p "$(cat pid)" 2>/dev/null)
  was=$(cat pid.start 2>/dev/null)
  if [ -z "$was" ] || [ "$now" = "$was" ]; then alive=1; fi
fi
if [ -e exit_code ]; then
  if [ -e cancelled ]; then state=cancelled
  elif [ -e timed_out ]; then state=timed_out
  else state="exited $(cat exit_code)"; fi
elif [ "$alive" = 1 ]; then state=running
elif [ ! -e started ]; then state=missing
elif [ ! -s pid ] && [ $(( $(date +%s) - $(cat started) )) -lt 60 ]; then state=running
elif [ -e cancelled ]; then state=cancelled
elif [ -e timed_out ]; then state=timed_out
else state=lost; fi
echo "OLEAFLY_STATE $state"
{log}"#,
        dir = sh_quote(dir),
        log = log_section(log_offset, max_bytes),
    )
}

/// Prints the size of `stdout.log` in the current folder and up to
/// `max_bytes` of it from `log_offset`, as base64.
pub fn log_section(log_offset: u64, max_bytes: u64) -> String {
    format!(
        r#"size=0
if [ -f stdout.log ]; then size=$(wc -c < stdout.log | tr -d ' '); fi
echo "OLEAFLY_LOGSIZE $size"
echo OLEAFLY_LOG_BEGIN
if [ -f stdout.log ]; then
  if command -v base64 >/dev/null 2>&1; then
    tail -c +{start} stdout.log | head -c {max_bytes} | base64
  else
    tail -c +{start} stdout.log | head -c {max_bytes} | openssl base64
  fi
fi
echo OLEAFLY_LOG_END
"#,
        start = log_offset + 1,
    )
}

fn parse_state(value: &str) -> RemoteState {
    match value {
        "missing" => RemoteState::Missing,
        "running" => RemoteState::Running,
        "timed_out" => RemoteState::TimedOut,
        "cancelled" => RemoteState::Cancelled,
        "lost" => RemoteState::Lost,
        other => match other
            .strip_prefix("exited ")
            .map(|code| code.trim().parse::<i32>())
        {
            Some(Ok(code)) => RemoteState::Exited(code),
            _ => RemoteState::Lost,
        },
    }
}

/// The log size and chunk a [`log_section`] printed.
pub fn parse_log(stdout: &str) -> Result<(u64, Vec<u8>), RunError> {
    let mut log_size = 0u64;
    let mut encoded = String::new();
    let mut in_log = false;
    for line in stdout.lines() {
        let line = line.trim_end_matches('\r');
        if in_log {
            if line == "OLEAFLY_LOG_END" {
                in_log = false;
            } else {
                encoded.extend(line.chars().filter(|character| !character.is_whitespace()));
            }
            continue;
        }
        if let Some(value) = line.strip_prefix("OLEAFLY_LOGSIZE ") {
            log_size = value.trim().parse().unwrap_or(0);
        } else if line == "OLEAFLY_LOG_BEGIN" {
            in_log = true;
        }
    }
    let chunk = base64::engine::general_purpose::STANDARD
        .decode(encoded.as_bytes())
        .map_err(|_| RunError::Remote("The run log arrived damaged.".into()))?;
    Ok((log_size, chunk))
}

pub fn parse_poll(stdout: &str) -> Result<PollReport, RunError> {
    let state = stdout
        .lines()
        .find_map(|line| {
            line.trim_end_matches('\r')
                .strip_prefix("OLEAFLY_STATE ")
                .map(|value| parse_state(value.trim()))
        })
        .ok_or_else(|| RunError::Remote("The remote computer sent an unexpected answer.".into()))?;
    let (log_size, chunk) = parse_log(stdout)?;
    Ok(PollReport {
        state,
        log_size,
        chunk,
    })
}

/// Marks the run cancelled, stops it, then kills what is left after
/// `grace_secs`. Nothing happens to a run that already finished.
pub fn cancel_script(dir: &str, grace_secs: u64) -> String {
    format!(
        "cd || exit 1\ncd {dir} 2>/dev/null || exit 0\nRUN=$(pwd)\n[ -e exit_code ] && exit 0\n: > cancelled\n{term}\ni=0\nwhile [ $i -lt {grace_secs} ] && [ ! -e exit_code ]; do sleep 1; i=$((i + 1)); done\n[ -e exit_code ] || {{ {kill}; }}\necho OLEAFLY_CANCELLED\n",
        dir = sh_quote(dir),
        term = kill_targets("TERM"),
        kill = kill_targets("KILL"),
    )
}

/// Files the run created or changed (newer than its start, at most 64 MiB
/// each and 10,000 in all, outside `runs/`), as `tar.gz` on standard output
/// or in `<dir>/outputs.tgz`.
pub fn outputs_script(dir: &str, to_file: bool) -> String {
    let target = if to_file { "../outputs.tgz" } else { "-" };
    // An archive in a file says how big it is, so a download can be refused.
    let size = if to_file {
        "echo \"OLEAFLY_OUTPUTS_BYTES $(wc -c < ../outputs.tgz)\"\n"
    } else {
        ""
    };
    format!(
        "cd || exit 1\ncd {dir}/work || exit 1\nfind . -type f -newer ../started -size -65537k ! -path './runs/*' 2>/dev/null | head -n 10000 > ../outputs.list\nCOPYFILE_DISABLE=1 tar -czf {target} -T ../outputs.list\n{size}",
        dir = sh_quote(dir),
    )
}

/// The size of an outputs archive, from what [`outputs_script`] printed.
pub fn outputs_bytes(printed: &str) -> Option<u64> {
    printed
        .lines()
        .find_map(|line| line.strip_prefix("OLEAFLY_OUTPUTS_BYTES "))
        .and_then(|bytes| bytes.trim().parse().ok())
}

/// Removes the run's folder (and its task folder once empty). Only a folder
/// shaped like `<root>/<task>/<run>` is accepted.
pub fn cleanup_script(dir: &str) -> Result<String, RunError> {
    let parent = task_dir(dir)
        .ok_or_else(|| RunError::Config("The remote run folder is not one Oleafly made.".into()))?;
    let (root, _) = parent
        .rsplit_once('/')
        .ok_or_else(|| RunError::Config("The remote run folder is not one Oleafly made.".into()))?;
    if root.is_empty() || !valid_root(root) {
        return Err(RunError::Config(
            "The remote run folder is not one Oleafly made.".into(),
        ));
    }
    Ok(format!(
        "cd || exit 1\nrm -rf -- {dir}\nrmdir -- {parent} 2>/dev/null || :\necho OLEAFLY_CLEANED\n",
        dir = sh_quote(dir),
        parent = sh_quote(parent),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    fn sh(script: &str, home: &std::path::Path) -> String {
        use std::io::Write;
        let mut child = std::process::Command::new("/bin/sh")
            .arg("-s")
            .env("HOME", home)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .spawn()
            .unwrap();
        child
            .stdin
            .take()
            .unwrap()
            .write_all(script.as_bytes())
            .unwrap();
        String::from_utf8(child.wait_with_output().unwrap().stdout).unwrap()
    }

    #[cfg(unix)]
    #[test]
    fn sh_quote_round_trips_awkward_values() {
        let home = tempfile::tempdir().unwrap();
        for value in ["it's", "\"q\"", "$HOME", "`x`", "a;b", "multi\nline"] {
            assert_eq!(
                sh(&format!("printf %s {}", sh_quote(value)), home.path()),
                value
            );
        }
    }

    #[test]
    fn env_values_never_appear_in_error_text() {
        let env = BTreeMap::from([("A-B".to_string(), "s3cr3t".to_string())]);
        let run = RemoteRun {
            dir: "d",
            command: "true",
            cwd_rel: "",
            env: &env,
            timeout_secs: 60,
            prelude: "",
        };
        let error = start_script(&run, Detach::Setsid).unwrap_err().to_string();
        assert!(!error.contains("s3cr3t"), "{error}");
    }

    #[test]
    fn heredoc_delimiter_cannot_be_forged() {
        let mut candidates = vec!["OLEAFLY_b".to_string(), "OLEAFLY_a".to_string()];
        let picked = delimiter("echo 1\nOLEAFLY_a\n", || candidates.pop().unwrap());
        assert_eq!(picked, "OLEAFLY_b");
    }

    #[test]
    fn run_dir_rejects_unsafe_ids_and_roots() {
        assert!(run_dir(None, "../x", "r1").is_err());
        assert!(run_dir(Some("/a b"), "t1", "r1").is_err());
        assert!(run_dir(Some("/"), "t1", "r1").is_err());
        assert_eq!(run_dir(None, "t1", "r1").unwrap(), ".oleafly-runs/t1/r1");
        assert_eq!(
            run_dir(Some("/scratch/jdoe/"), "t1", "r1").unwrap(),
            "/scratch/jdoe/t1/r1"
        );
    }

    #[test]
    fn probe_parsing_picks_perl_without_setsid() {
        let probe = parse_probe(
            "OLEAFLY_PROBE home /Users/j\nOLEAFLY_PROBE os Darwin\nOLEAFLY_PROBE setsid 0\nOLEAFLY_PROBE perl 1\nOLEAFLY_PROBE rsync 1\nOLEAFLY_PROBE end\n",
        )
        .unwrap();
        assert_eq!(probe.detach, Detach::Perl);
        assert!(probe.rsync);
        assert_eq!(probe.home, "/Users/j");
        assert!(parse_probe("'sh' is not recognized as an internal or external command").is_err());
    }

    #[test]
    fn poll_parsing_handles_wrapped_base64_and_missing() {
        let encoded =
            base64::engine::general_purpose::STANDARD.encode(b"hello world, this is a log line\n");
        let (first, second) = encoded.split_at(10);
        let report = parse_poll(&format!(
            "OLEAFLY_STATE running\nOLEAFLY_LOGSIZE 32\nOLEAFLY_LOG_BEGIN\n{first}\n{second}\nOLEAFLY_LOG_END\n"
        ))
        .unwrap();
        assert_eq!(report.state, RemoteState::Running);
        assert_eq!(report.chunk, b"hello world, this is a log line\n");
        assert_eq!(
            parse_poll("OLEAFLY_STATE missing\n").unwrap().state,
            RemoteState::Missing
        );
        assert_eq!(
            parse_poll("OLEAFLY_STATE exited 3\n").unwrap().state,
            RemoteState::Exited(3)
        );
    }

    #[test]
    fn cleanup_only_accepts_run_folders() {
        assert!(cleanup_script(".oleafly-runs/t1/r1").is_ok());
        assert!(cleanup_script("/scratch/j/t1/r1").is_ok());
        assert!(cleanup_script("t1").is_err());
        assert!(cleanup_script("/t1/r1").is_err());
    }

    #[cfg(unix)]
    mod lifecycle {
        use super::*;
        use std::path::Path;
        use std::time::{Duration, Instant};

        fn detach(home: &Path) -> Detach {
            parse_probe(&sh(probe_script(), home)).unwrap().detach
        }

        fn start(home: &Path, command: &str, timeout_secs: u64) -> (String, Detach) {
            let env = BTreeMap::from([("GREETING".to_string(), "hello".to_string())]);
            let dir = run_dir(None, "t1", "r1").unwrap();
            let mode = detach(home);
            let run = RemoteRun {
                dir: &dir,
                command,
                cwd_rel: "",
                env: &env,
                timeout_secs,
                prelude: "",
            };
            let out = sh(&start_script(&run, mode).unwrap(), home);
            assert!(out.contains("OLEAFLY_STARTED"), "{out}");
            (dir, mode)
        }

        fn poll_until(home: &Path, dir: &str, done: impl Fn(&PollReport) -> bool) -> PollReport {
            let deadline = Instant::now() + Duration::from_secs(15);
            loop {
                let report = parse_poll(&sh(&poll_script(dir, 0, 1 << 20), home)).unwrap();
                if done(&report) || Instant::now() > deadline {
                    return report;
                }
                std::thread::sleep(Duration::from_millis(200));
            }
        }

        fn group_gone(home: &Path, dir: &str) -> bool {
            let Ok(pgid) = std::fs::read_to_string(home.join(dir).join("pgid")) else {
                return true;
            };
            let pgid: i32 = pgid.trim().parse().unwrap();
            // SAFETY: signal 0 only checks that the group exists.
            unsafe { libc::kill(-pgid, 0) != 0 }
        }

        #[test]
        fn start_poll_cancel_cycle_under_sh() {
            let home = tempfile::tempdir().unwrap();
            let (dir, _) = start(home.path(), "echo \"$GREETING\"; sleep 30", 120);
            let report = poll_until(home.path(), &dir, |report| {
                String::from_utf8_lossy(&report.chunk).contains("hello")
            });
            assert_eq!(report.state, RemoteState::Running);
            sh(&cancel_script(&dir, 2), home.path());
            let report = poll_until(home.path(), &dir, |report| {
                report.state != RemoteState::Running
            });
            assert_eq!(report.state, RemoteState::Cancelled);
            let deadline = Instant::now() + Duration::from_secs(5);
            while !group_gone(home.path(), &dir) && Instant::now() < deadline {
                std::thread::sleep(Duration::from_millis(100));
            }
            assert!(group_gone(home.path(), &dir));
        }

        #[test]
        fn timeout_marks_timed_out() {
            let home = tempfile::tempdir().unwrap();
            let (dir, _) = start(home.path(), "sleep 30", 1);
            let report = poll_until(home.path(), &dir, |report| {
                report.state != RemoteState::Running
            });
            assert_eq!(report.state, RemoteState::TimedOut);
        }

        #[test]
        fn exit_code_is_reported() {
            let home = tempfile::tempdir().unwrap();
            let (dir, _) = start(home.path(), "exit 3", 60);
            let report = poll_until(home.path(), &dir, |report| {
                report.state != RemoteState::Running
            });
            assert_eq!(report.state, RemoteState::Exited(3));
        }

        #[test]
        fn start_is_idempotent() {
            let home = tempfile::tempdir().unwrap();
            let (dir, mode) = start(home.path(), "sleep 5", 60);
            let env = BTreeMap::new();
            let run = RemoteRun {
                dir: &dir,
                command: "sleep 5",
                cwd_rel: "",
                env: &env,
                timeout_secs: 60,
                prelude: "",
            };
            let again = sh(&start_script(&run, mode).unwrap(), home.path());
            assert!(again.contains("OLEAFLY_ALREADY"), "{again}");
            sh(&cancel_script(&dir, 1), home.path());
        }

        #[test]
        fn outputs_include_only_new_files() {
            let home = tempfile::tempdir().unwrap();
            let dir = run_dir(None, "t1", "r1").unwrap();
            std::fs::create_dir_all(home.path().join(&dir).join("work")).unwrap();
            std::fs::write(home.path().join(&dir).join("work/old.txt"), "old").unwrap();
            let (_, _) = start(
                home.path(),
                "mkdir -p results; echo new > results/a.txt",
                60,
            );
            poll_until(home.path(), &dir, |report| {
                report.state != RemoteState::Running
            });
            sh(&outputs_script(&dir, true), home.path());
            let archive = std::fs::File::open(home.path().join(&dir).join("outputs.tgz")).unwrap();
            let mut names: Vec<String> = tar::Archive::new(flate2::read::GzDecoder::new(archive))
                .entries()
                .unwrap()
                .map(|entry| String::from_utf8_lossy(&entry.unwrap().path_bytes()).into_owned())
                .collect();
            names.sort();
            assert_eq!(names, ["./results/a.txt"]);
        }

        #[test]
        fn outputs_with_no_new_files_are_an_empty_archive() {
            let home = tempfile::tempdir().unwrap();
            let (dir, _) = start(home.path(), "true", 60);
            poll_until(home.path(), &dir, |report| {
                report.state != RemoteState::Running
            });
            sh(&outputs_script(&dir, true), home.path());
            let archive = std::fs::File::open(home.path().join(&dir).join("outputs.tgz")).unwrap();
            let count = tar::Archive::new(flate2::read::GzDecoder::new(archive))
                .entries()
                .unwrap()
                .count();
            assert_eq!(count, 0);
        }
    }
}
