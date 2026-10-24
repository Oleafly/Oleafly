use std::collections::BTreeMap;
use std::path::Path;
use std::sync::Arc;

use oleafly_agent::CancellationToken;
use serde_json::{json, Value};
use tokio::io::AsyncWriteExt;

use super::command::{read_output, sandbox_task_command};
use super::extra::{call_task_tool, TaskBinding};
use super::*;
use crate::model::{
    CommandPolicy, ResearchBrief, ResearchTask, RunRecord, RunState, TaskPhase, TaskRunContext,
    TaskRuntimeEvent,
};
use crate::record::{parse_ledger, LEDGER_HEADER};
use crate::scheduler::{SuspendSignals, TaskRuntimeFuture, TaskServices};
use crate::store::TaskStore;

fn files(root: &Path) -> TaskFiles {
    TaskFiles::open(root, &["main.tex".into(), "analysis".into()]).unwrap()
}

fn commands(root: &Path) -> CommandContext {
    CommandContext {
        execution_root: root.to_string_lossy().into_owned(),
        allowed_paths: vec!["analysis".into()],
        read_paths: Vec::new(),
        network: false,
        ..CommandContext::default()
    }
}

#[test]
fn file_tools_write_only_the_isolated_allowed_paths() {
    let source = tempfile::tempdir().unwrap();
    let isolated = tempfile::tempdir().unwrap();
    std::fs::write(source.path().join("main.tex"), "original").unwrap();
    std::fs::write(isolated.path().join("main.tex"), "snapshot").unwrap();
    let files = files(isolated.path());
    files.write("main.tex", "changed").unwrap();
    files.write("analysis/results/note.md", "result").unwrap();
    assert_eq!(
        std::fs::read_to_string(source.path().join("main.tex")).unwrap(),
        "original"
    );
    assert_eq!(files.read("main.tex").unwrap(), "changed");
    assert!(files.write("private.txt", "denied").is_err());
    assert!(files.write("../escape", "denied").is_err());
    assert!(files.read("/etc/passwd").is_err());
    assert!(files.write("analysis/.git/config", "denied").is_err());
    assert!(files.write("analysis/.PRIVATE/note", "denied").is_err());
    assert!(files.read("analysis/.private/note").is_err());
    assert!(TaskFiles::open(isolated.path(), &[".private".into()]).is_err());
    assert!(files.read("C:\\private").is_err());
}

#[cfg(unix)]
#[test]
fn file_tools_reject_links_and_replace_hardlinks_without_mutating_the_source() {
    use std::os::unix::fs::symlink;
    let source = tempfile::tempdir().unwrap();
    let isolated = tempfile::tempdir().unwrap();
    std::fs::write(source.path().join("original"), "original").unwrap();
    symlink(source.path(), isolated.path().join("analysis")).unwrap();
    let files = files(isolated.path());
    assert!(files.read("analysis/original").is_err());
    assert!(files.write("analysis/original", "changed").is_err());
    assert!(files.list("").unwrap().0.is_empty());
    std::fs::hard_link(
        source.path().join("original"),
        isolated.path().join("main.tex"),
    )
    .unwrap();
    files.write("main.tex", "changed").unwrap();
    assert_eq!(
        std::fs::read_to_string(source.path().join("original")).unwrap(),
        "original"
    );
}

#[test]
fn file_reads_and_searches_are_bounded_and_skip_binary_files() {
    let isolated = tempfile::tempdir().unwrap();
    let files = files(isolated.path());
    files.write("main.tex", "one\nneedle two\n").unwrap();
    files.write("analysis/results.txt", "needle three").unwrap();
    std::fs::write(isolated.path().join("analysis/binary"), [0xff, 0xfe]).unwrap();
    assert_eq!(
        files.search("needle").unwrap()["matches"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    assert!(files
        .write("main.tex", &"x".repeat(MAX_FILE_BYTES + 1))
        .is_err());
    std::fs::write(
        isolated.path().join("main.tex"),
        vec![b'x'; MAX_FILE_BYTES + 1],
    )
    .unwrap();
    assert!(files.read("main.tex").is_err());
}

#[test]
fn partial_file_reads_can_continue_without_splitting_unicode() {
    let isolated = tempfile::tempdir().unwrap();
    let files = files(isolated.path());
    files.write("main.tex", "a🍃remaining text").unwrap();
    let first = files.read_window("main.tex", 0, 4).unwrap();
    assert_eq!(first["content"], "a");
    assert_eq!(first["nextOffset"], 1);
    let next = files.read_window("main.tex", 1, 4).unwrap();
    assert_eq!(next["content"], "🍃");
    assert_eq!(next["nextOffset"], 5);
    let last = files.read_window("main.tex", 5, MAX_OUTPUT_BYTES).unwrap();
    assert_eq!(last["content"], "remaining text");
    assert!(last["nextOffset"].is_null());
    assert!(files.read_window("main.tex", 2, 4).is_err());
    assert!(files.read_window("main.tex", usize::MAX, 4).is_err());
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
#[tokio::test]
async fn commands_cannot_write_original_files_or_follow_writable_links_outside_the_workspace() {
    let source = tempfile::tempdir().unwrap();
    let isolated = tempfile::tempdir().unwrap();
    let original = source.path().join("main.tex");
    std::fs::write(&original, "original").unwrap();
    let quoted = original.to_string_lossy().replace('\'', "'\\''");
    let command = format!("printf allowed > analysis/result.txt; printf denied > '{quoted}'; ln -s '{quoted}' analysis/linked; printf denied > analysis/linked; ln '{quoted}' analysis/hardlinked; printf denied > analysis/hardlinked; printf denied > unapproved.txt; printf done");
    let result = execute_command(
        &commands(isolated.path()),
        &command,
        CancellationToken::new(),
    )
    .await
    .unwrap();
    assert_eq!(result["exitCode"], 0, "{result}");
    assert_eq!(std::fs::read_to_string(&original).unwrap(), "original");
    assert_eq!(
        std::fs::read_to_string(isolated.path().join("analysis/result.txt")).unwrap(),
        "allowed"
    );
    assert!(!isolated.path().join("unapproved.txt").exists());
}

#[cfg(target_os = "macos")]
#[tokio::test]
async fn cancelling_a_command_waits_for_its_process_group_and_output_readers() {
    let isolated = tempfile::tempdir().unwrap();
    let context = commands(isolated.path());
    let token = CancellationToken::new();
    let child_token = token.clone();
    let task = tokio::spawn(async move {
        execute_command(
            &context,
            "sleep 60 & printf '%s' \"$!\" > analysis/child.pid; wait",
            child_token,
        )
        .await
    });
    let pid_path = isolated.path().join("analysis/child.pid");
    // The shell's `>` creates child.pid before printf writes to it, so wait
    // for the pid itself, not for the file.
    let pid = crate::test_support::read_until(
        &pid_path,
        crate::test_support::CHILD_PATIENCE,
        crate::test_support::pid,
    )
    .await
    .expect("the command must record its background child's process id");
    token.cancel();
    let result = tokio::time::timeout(Duration::from_secs(5), task)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert_eq!(result["cancelled"], true);
    tokio::time::timeout(Duration::from_secs(2), async {
        while unsafe { libc::kill(pid, 0) } == 0 {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("the command's descendant must be stopped before cleanup finishes");
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
#[tokio::test]
async fn commands_drain_both_streams_without_retaining_unbounded_output() {
    let isolated = tempfile::tempdir().unwrap();
    let result = execute_command(
        &commands(isolated.path()),
        "dd if=/dev/zero bs=1024 count=128; dd if=/dev/zero bs=1024 count=128 >&2",
        CancellationToken::new(),
    )
    .await
    .unwrap();
    assert_eq!(result["exitCode"], 0, "{result}");
    assert_eq!(result["truncated"], true);
    assert!(result["output"].as_str().unwrap().len() <= MAX_OUTPUT_BYTES);
}

#[cfg(target_os = "macos")]
#[tokio::test]
async fn command_descendants_cannot_detach_and_write_after_completion() {
    let isolated = tempfile::tempdir().unwrap();
    let analysis = isolated.path().join("analysis");
    std::fs::create_dir(&analysis).unwrap();
    let source = analysis.join("escape.c");
    let binary = analysis.join("escape");
    std::fs::write(
        &source,
        r#"
#include <errno.h>
#include <fcntl.h>
#include <spawn.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/wait.h>
#include <unistd.h>
extern char **environ;
int main(void) {
pid_t child = fork();
if (child > 0) { waitpid(child, NULL, 0); return 0; }
if (child < 0) return 2;
errno = 0; int sid = setsid(); int sid_error = errno;
errno = 0; int group = setpgid(0, 0); int group_error = errno;
posix_spawnattr_t attributes;
posix_spawnattr_init(&attributes);
posix_spawnattr_setflags(&attributes, POSIX_SPAWN_SETPGROUP);
posix_spawnattr_setpgroup(&attributes, 0);
char *arguments[] = { "/bin/true", NULL };
pid_t spawned;
int spawn_error = posix_spawn(&spawned, arguments[0], NULL, &attributes, arguments, environ);
if (!spawn_error) waitpid(spawned, NULL, 0);
FILE *report = fopen("analysis/report", "w");
fprintf(report, "%d %d %d %d %d", sid, sid_error, group, group_error, spawn_error);
fclose(report);
pid_t grandchild = fork();
if (grandchild == 0) {
    close(0); close(1); close(2);
    for (int tick = 0; tick < 6000 && access("analysis/release", F_OK) != 0; tick++) usleep(10000);
    int marker = open("analysis/survived", O_WRONLY | O_CREAT, 0600);
    if (marker >= 0) { write(marker, "survived", 8); close(marker); }
    _exit(0);
}
FILE *pidfile = fopen("analysis/grandchild.pid", "w");
fprintf(pidfile, "%d", grandchild);
fclose(pidfile);
_exit(0);
}
"#,
    )
    .unwrap();
    let compile = std::process::Command::new("/usr/bin/cc")
        .arg(&source)
        .arg("-o")
        .arg(&binary)
        .output()
        .unwrap();
    assert!(
        compile.status.success(),
        "{}",
        String::from_utf8_lossy(&compile.stderr)
    );
    let result = execute_command(
        &commands(isolated.path()),
        "analysis/escape",
        CancellationToken::new(),
    )
    .await
    .unwrap();
    assert_eq!(result["exitCode"], 0, "{result}");
    let report = std::fs::read_to_string(analysis.join("report")).unwrap();
    let pid = std::fs::read_to_string(analysis.join("grandchild.pid"))
        .unwrap()
        .parse::<i32>()
        .unwrap();
    // The grandchild writes its marker only once released, and release is
    // created only after the command was reported finished.
    std::fs::write(analysis.join("release"), "").unwrap();
    let gone = tokio::time::timeout(crate::test_support::CHILD_PATIENCE, async {
        while unsafe { libc::kill(pid, 0) } == 0 {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .is_ok();
    let survived = analysis.join("survived").exists();
    if !gone {
        unsafe {
            libc::kill(pid, libc::SIGKILL);
        }
    }
    assert_eq!(report, "-1 1 -1 1 78");
    assert!(
        !survived,
        "a detached grandchild wrote after the command was reported finished"
    );
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
#[tokio::test]
async fn task_commands_cannot_read_unlinked_files() {
    let unrelated = tempfile::tempdir().unwrap();
    let isolated = tempfile::tempdir().unwrap();
    let secret = unrelated.path().join("private.txt");
    std::fs::write(&secret, "private data").unwrap();
    let quoted = secret.to_string_lossy().replace('\'', "'\\''");
    let result = execute_command(
        &commands(isolated.path()),
        &format!("cat '{quoted}' > analysis/leaked"),
        CancellationToken::new(),
    )
    .await
    .unwrap();
    assert_ne!(result["exitCode"], 0);
    assert_eq!(
        std::fs::read(isolated.path().join("analysis/leaked")).unwrap(),
        Vec::<u8>::new()
    );
}

#[test]
fn workspace_requires_a_directory_and_explicit_nonempty_scope() {
    let root = tempfile::tempdir().unwrap();
    let ordinary_file = root.path().join("file");
    std::fs::write(&ordinary_file, "original").unwrap();
    assert!(TaskFiles::open(&ordinary_file, &["analysis".into()]).is_err());
    assert!(TaskFiles::open(&root.path().join("missing"), &["analysis".into()]).is_err());
    assert!(TaskFiles::open(root.path(), &[]).is_err());
    for path in [
        "",
        ".",
        "..",
        "/",
        "analysis/../outside",
        "analysis/.OLEAFLY/state",
    ] {
        assert!(
            TaskFiles::open(root.path(), &[path.into()]).is_err(),
            "{path}"
        );
    }
    assert_eq!(std::fs::read_to_string(ordinary_file).unwrap(), "original");
}

#[test]
fn listing_leaf_scopes_traverses_parents_without_exposing_siblings() {
    let root = tempfile::tempdir().unwrap();
    for (path, content) in [
        ("analysis/allowed/answer.md", "needle answer"),
        ("analysis/allowed/extra.md", "needle extra"),
        ("analysis/hidden.md", "needle hidden"),
        ("analysis-neighbor/hidden.md", "needle neighbor"),
        ("data/source.csv", "needle source"),
    ] {
        let path = root.path().join(path);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, content).unwrap();
    }
    let files = TaskFiles::open(
        root.path(),
        &[
            "analysis/allowed/answer.md".into(),
            "data/source.csv".into(),
        ],
    )
    .unwrap();
    assert_eq!(
        files.list("").unwrap(),
        (
            vec![
                "analysis/allowed/answer.md".into(),
                "data/source.csv".into()
            ],
            false
        )
    );
    assert_eq!(
        files.list("analysis").unwrap(),
        (vec!["analysis/allowed/answer.md".into()], false)
    );
    assert!(files.list("analysis-neighbor").is_err());
    assert!(files.list("analysis/hidden.md").is_err());
    assert!(files.read("analysis/allowed/extra.md").is_err());
    let matches = files.search("needle").unwrap();
    assert_eq!(matches["matches"].as_array().unwrap().len(), 2);
    assert_eq!(matches["truncated"], false);
}

#[test]
fn writes_reject_directory_destinations_and_file_parents_without_losing_data() {
    let root = tempfile::tempdir().unwrap();
    let files = TaskFiles::open(root.path(), &["analysis".into()]).unwrap();
    files.write("analysis/existing.md", "original").unwrap();
    assert!(files.write("analysis", "replacement").is_err());
    assert!(files
        .write("analysis/existing.md/child", "replacement")
        .is_err());
    assert_eq!(files.read("analysis/existing.md").unwrap(), "original");
    assert_eq!(files.list("").unwrap().0, vec!["analysis/existing.md"]);
    assert!(files.read("analysis").is_err());
}

#[cfg(unix)]
#[test]
fn fifo_and_symlink_roots_are_rejected_without_opening_external_files() {
    use std::os::unix::fs::symlink;
    let root = tempfile::tempdir().unwrap();
    let linked = root.path().join("linked");
    symlink(root.path(), &linked).unwrap();
    assert!(TaskFiles::open(&linked, &["analysis".into()]).is_err());
    std::fs::create_dir(root.path().join("analysis")).unwrap();
    let fifo = root.path().join("analysis/pipe");
    let fifo_name = std::ffi::CString::new(fifo.as_os_str().as_encoded_bytes()).unwrap();
    assert_eq!(unsafe { libc::mkfifo(fifo_name.as_ptr(), 0o600) }, 0);
    let files = TaskFiles::open(root.path(), &["analysis".into()]).unwrap();
    assert!(files.read("analysis/pipe").is_err());
    assert!(files.write("analysis/pipe", "text").is_err());
    assert!(files.list("").unwrap().0.is_empty());
}

#[test]
fn search_caps_matches_and_unicode_line_output_and_validates_queries() {
    let root = tempfile::tempdir().unwrap();
    let files = TaskFiles::open(root.path(), &["analysis".into()]).unwrap();
    files
        .write(
            "analysis/matches.md",
            &format!("needle {}\n", "🍃".repeat(400)).repeat(40),
        )
        .unwrap();
    let result = files.search("needle").unwrap();
    let matches = result["matches"].as_array().unwrap();
    assert_eq!(matches.len(), 32);
    assert_eq!(result["truncated"], true);
    for (index, entry) in matches.iter().enumerate() {
        assert_eq!(entry["path"], "analysis/matches.md");
        assert_eq!(entry["line"], index + 1);
        let text = entry["text"].as_str().unwrap();
        assert!(text.starts_with("needle 🍃"));
        assert!(text.ends_with("\n[output truncated]"));
        assert!(!text.contains('\u{fffd}'));
        assert!(text.len() <= 1024 + "\n[output truncated]".len());
    }
    assert!(files.search("").is_err());
    assert!(files.search(&"x".repeat(1025)).is_err());
    let missing = files.search("absent").unwrap();
    assert!(missing["matches"].as_array().unwrap().is_empty());
    assert_eq!(missing["truncated"], false);
}

#[test]
fn search_reports_when_its_total_scan_budget_leaves_files_unread() {
    let root = tempfile::tempdir().unwrap();
    let analysis = root.path().join("analysis");
    std::fs::create_dir(&analysis).unwrap();
    let data = vec![b'x'; MAX_FILE_BYTES];
    for index in 0..17 {
        std::fs::write(analysis.join(format!("{index:02}.txt")), &data).unwrap();
    }
    std::fs::write(analysis.join("99.txt"), "needle").unwrap();
    let files = TaskFiles::open(root.path(), &["analysis".into()]).unwrap();
    let result = files.search("needle").unwrap();
    assert!(result["matches"].as_array().unwrap().is_empty());
    assert_eq!(result["truncated"], true);
}

#[test]
fn listing_reports_truncation_without_exceeding_its_output_budget() {
    let root = tempfile::tempdir().unwrap();
    let analysis = root.path().join("analysis");
    std::fs::create_dir(&analysis).unwrap();
    for index in 0..150 {
        std::fs::write(
            analysis.join(format!("{index:03}-{}.txt", "a".repeat(190))),
            "",
        )
        .unwrap();
    }
    let files = TaskFiles::open(root.path(), &["analysis".into()]).unwrap();
    let (listed, truncated) = files.list("").unwrap();
    assert!(truncated);
    assert!(!listed.is_empty());
    assert!(listed.len() < 150);
    assert!(listed.iter().map(|path| path.len() + 4).sum::<usize>() <= MAX_OUTPUT_BYTES / 2);
    assert!(listed.windows(2).all(|pair| pair[0] < pair[1]));
    assert!(listed
        .iter()
        .all(|path| files.read(path).unwrap().is_empty()));
}

#[test]
fn sandbox_rejects_invalid_temporary_folders_and_overbroad_read_grants() {
    let root = tempfile::tempdir().unwrap();
    let program = std::env::current_exe().unwrap();
    let allowed = vec!["analysis".into()];
    let temp_file = root.path().join("temp-file");
    std::fs::write(&temp_file, "original").unwrap();
    for temp in [root.path().join("missing"), temp_file.clone()] {
        assert!(sandbox_task_command(&program, &[], root.path(), &allowed, &temp, false).is_err());
    }
    let temp = tempfile::tempdir().unwrap();
    let filesystem_root = program.ancestors().last().unwrap().to_path_buf();
    for read in [filesystem_root, root.path().join("missing-read")] {
        assert!(sandbox_task_command_with_reads(
            &program,
            &[],
            root.path(),
            &allowed,
            temp.path(),
            false,
            &[read]
        )
        .is_err());
    }
    assert_eq!(std::fs::read_to_string(temp_file).unwrap(), "original");
}

#[cfg(unix)]
#[test]
fn sandbox_rejects_linked_write_grants_and_linked_temporary_folders() {
    use std::os::unix::fs::symlink;
    let root = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let temp = tempfile::tempdir().unwrap();
    symlink(outside.path(), root.path().join("analysis")).unwrap();
    let program = std::env::current_exe().unwrap();
    assert!(sandbox_task_command(
        &program,
        &[],
        root.path(),
        &["analysis".into()],
        temp.path(),
        false
    )
    .is_err());
    let linked_temp = root.path().join("linked-temp");
    symlink(temp.path(), &linked_temp).unwrap();
    assert!(sandbox_task_command(
        &program,
        &[],
        root.path(),
        &["other".into()],
        &linked_temp,
        false
    )
    .is_err());
    assert!(std::fs::read_dir(outside.path()).unwrap().next().is_none());
    assert!(!root.path().join("other").exists());
}

#[tokio::test]
async fn output_reader_drains_backpressure_after_reaching_its_retention_limit() {
    let (mut writer, reader) = tokio::io::duplex(1024);
    let output = tokio::spawn(read_output(reader));
    tokio::time::timeout(Duration::from_secs(5), async {
        writer
            .write_all(&vec![b'x'; MAX_OUTPUT_BYTES * 4])
            .await
            .unwrap();
        writer.shutdown().await.unwrap();
        let output = output.await.unwrap();
        assert_eq!(output.len(), MAX_OUTPUT_BYTES + 1);
        assert!(output.iter().all(|byte| *byte == b'x'));
    })
    .await
    .unwrap();
}

#[tokio::test]
async fn cancelled_and_invalid_commands_do_not_create_task_files() {
    let root = tempfile::tempdir().unwrap();
    let context = commands(root.path());
    let jobs = CommandJobs::default();
    let cancelled = CancellationToken::new();
    cancelled.cancel();
    assert!(jobs
        .run(
            context.clone(),
            "printf changed > analysis/result".into(),
            cancelled
        )
        .await
        .is_err());
    for command in [" \n\t".to_string(), "x".repeat(16 * 1024 + 1)] {
        assert!(jobs
            .run(context.clone(), command, CancellationToken::new())
            .await
            .is_err());
    }
    jobs.finish().await;
    assert!(lock(&jobs.tasks).is_empty());
    assert!(std::fs::read_dir(root.path()).unwrap().next().is_none());
}

// 0.4.8: the task tools both runtimes share (runs, the ledger, results
// tables, todos and notes).

/// A task host for tools that need none of its services.
struct NoModelHost;

impl crate::builtin::TaskHost for NoModelHost {
    fn skills(&self, _context: &TaskRunContext) -> Result<String, String> {
        Ok(String::new())
    }

    fn skill_read_paths(&self, _context: &TaskRunContext) -> Vec<std::path::PathBuf> {
        Vec::new()
    }

    fn provider(
        &self,
        _context: TaskRunContext,
    ) -> TaskRuntimeFuture<crate::builtin::TaskProvider> {
        Box::pin(async { Err("No model in this test.".to_string()) })
    }

    fn bridge(
        &self,
        _context: TaskRunContext,
        _binding: Option<TaskBinding>,
    ) -> TaskRuntimeFuture<Arc<dyn crate::builtin::TaskBridge>> {
        Box::pin(async { Err("No bridge in this test.".to_string()) })
    }
}

/// A task the store is running, and the binding its tools use.
struct ToolTask {
    temp: tempfile::TempDir,
    store: TaskStore,
    task: ResearchTask,
    binding: TaskBinding,
    events: Arc<std::sync::Mutex<Vec<TaskRuntimeEvent>>>,
}

fn tool_task(brief: ResearchBrief) -> ToolTask {
    let temp = tempfile::tempdir().unwrap();
    let tasks_root = temp.path().join("tasks");
    let workspace = temp.path().join("workspace");
    std::fs::create_dir_all(workspace.join("analysis")).unwrap();
    let store = TaskStore::new(tasks_root.clone()).unwrap();
    let mut draft = crate::test_support::draft("paper", "Dropout sweep");
    draft.brief = Some(brief.clone());
    let created = store.create(draft).unwrap();
    store.request_start(&created.id).unwrap();
    let task = store.claim_next().unwrap().unwrap();
    let clocks = Arc::new(crate::budget::BudgetClocks::default());
    let events: Arc<std::sync::Mutex<Vec<TaskRuntimeEvent>>> =
        Arc::new(std::sync::Mutex::new(Vec::new()));
    let sink = events.clone();
    let binding = TaskBinding {
        task_id: task.id.clone(),
        project_id: task.project_id.clone(),
        task_title: task.title.clone(),
        generation: task.execution_generation,
        brief,
        record_dir: task.record_dir(),
        execution_root: workspace,
        allowed_paths: vec!["analysis".into(), "research".into()],
        read_paths: Vec::new(),
        linked_roots: Vec::new(),
        search_dirs: Vec::new(),
        project_root: None,
        services: TaskServices {
            runs: crate::runs::RunManager::new(
                tasks_root.clone(),
                tokio::runtime::Handle::current(),
            ),
            tasks_root: tasks_root.clone(),
            clocks: clocks.clone(),
            approvals: crate::approvals::ApprovalQueue::new(tasks_root, clocks),
            workspace: None,
            suspends: Arc::new(SuspendSignals::default()),
        },
        host: Arc::new(NoModelHost),
        events: Some(Arc::new(move |event: TaskRuntimeEvent| {
            lock(&sink).push(event)
        })),
        cancel: CancellationToken::new(),
    };
    ToolTask {
        temp,
        store,
        task,
        binding,
        events,
    }
}

impl ToolTask {
    async fn call(&self, name: &str, args: Value) -> Result<Value, String> {
        call_task_tool(name, args, &self.binding)
            .await
            .unwrap_or_else(|| panic!("{name} is not a task tool"))
    }

    /// Records a run of the task; a finished one gets exit code 0 and
    /// `metrics`.
    fn add_run(&self, run_id: &str, command: &str, state: RunState, metrics: &[(&str, f64)]) {
        self.store
            .insert_run(&RunRecord {
                task_id: self.task.id.clone(),
                run_id: run_id.into(),
                execution_generation: self.task.execution_generation,
                name: format!("{run_id} run"),
                executor: "local".into(),
                command: command.into(),
                cwd_rel: String::new(),
                state: RunState::Running,
                exit_code: None,
                started_at: crate::model::now_ms(),
                finished_at: None,
                run_dir: self
                    .temp
                    .path()
                    .join("runs")
                    .join(run_id)
                    .to_string_lossy()
                    .into_owned(),
                metrics: BTreeMap::new(),
                reported: false,
            })
            .unwrap();
        if state.is_terminal() {
            let metrics = metrics
                .iter()
                .map(|(name, value)| ((*name).to_owned(), *value))
                .collect();
            assert!(self
                .store
                .finish_run(
                    &self.task.id,
                    run_id,
                    state,
                    Some(0),
                    crate::model::now_ms(),
                    &metrics
                )
                .unwrap());
        }
    }

    fn record_file(&self, name: &str) -> std::path::PathBuf {
        self.binding
            .execution_root
            .join(self.task.record_dir())
            .join(name)
    }

    fn ledger(&self) -> Vec<crate::record::LedgerRow> {
        parse_ledger(&std::fs::read_to_string(self.record_file("ledger.tsv")).unwrap())
    }

    fn phases(&self) -> Vec<TaskPhase> {
        lock(&self.events)
            .iter()
            .filter_map(|event| match event {
                TaskRuntimeEvent::Phase { phase } => Some(*phase),
                _ => None,
            })
            .collect()
    }
}

#[tokio::test]
async fn ledger_append_fills_the_command_and_metrics_from_the_run() {
    let fixture = tool_task(ResearchBrief::default());
    fixture.add_run(
        "r001",
        "python train.py --dropout 0.3",
        RunState::Succeeded,
        &[("acc", 0.913), ("loss", 0.25)],
    );
    let saved = fixture
        .call(
            "ledger_append",
            json!({
                "hypothesis": "Dropout helps",
                "change": "dropout 0.3",
                "run_id": "r001",
                "metrics": {"acc": 0.92},
                "verdict": "keep",
                "notes": "First\tsweep",
            }),
        )
        .await
        .unwrap();
    assert_eq!(
        saved,
        json!({"id": "r001", "path": format!("{}/ledger.tsv", fixture.task.record_dir())})
    );
    let text = std::fs::read_to_string(fixture.record_file("ledger.tsv")).unwrap();
    assert!(text.starts_with(LEDGER_HEADER), "{text}");
    let rows = fixture.ledger();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].id, "r001");
    assert_eq!(rows[0].command, "python train.py --dropout 0.3");
    // What the agent passed wins; the run's recorded metrics fill in the rest.
    assert_eq!(
        rows[0].metrics,
        BTreeMap::from([("acc".to_owned(), 0.92), ("loss".to_owned(), 0.25)])
    );
    assert_eq!(
        (
            rows[0].hypothesis.as_str(),
            rows[0].change.as_str(),
            rows[0].verdict.as_str(),
            rows[0].notes.as_str()
        ),
        ("Dropout helps", "dropout 0.3", "keep", "First sweep")
    );
    assert!(rows[0].time.ends_with('Z'), "{}", rows[0].time);

    // A finding without a run gets its own id and no command.
    let note = fixture
        .call(
            "ledger_append",
            json!({"hypothesis": "Batch size matters", "change": "none yet", "verdict": "discard"}),
        )
        .await
        .unwrap();
    assert_eq!(note["id"], "n001");
    let rows = fixture.ledger();
    assert_eq!(
        (rows[1].id.as_str(), rows[1].command.as_str()),
        ("n001", "")
    );
    assert_eq!(
        fixture
            .call(
                "ledger_append",
                json!({"hypothesis": "h", "change": "c", "run_id": "r404", "verdict": "crash"}),
            )
            .await
            .unwrap_err(),
        "No run r404 in this task."
    );
}

#[tokio::test]
async fn ledger_append_accepts_only_keep_discard_or_crash() {
    let fixture = tool_task(ResearchBrief::default());
    for verdict in ["keep", "discard", "crash"] {
        fixture
            .call(
                "ledger_append",
                json!({"hypothesis": "h", "change": "c", "verdict": verdict}),
            )
            .await
            .unwrap();
    }
    assert_eq!(
        fixture
            .call("ledger_append", json!({"hypothesis": "h", "change": "c"}))
            .await
            .unwrap_err(),
        "Missing required argument: verdict."
    );
    let maybe = fixture
        .call(
            "ledger_append",
            json!({"hypothesis": "h", "change": "c", "verdict": "maybe"}),
        )
        .await;
    assert!(
        maybe.is_err(),
        "a verdict other than keep, discard or crash reached the ledger: {maybe:?}"
    );
    let verdicts: Vec<String> = fixture
        .ledger()
        .into_iter()
        .map(|row| row.verdict)
        .collect();
    assert_eq!(verdicts, ["keep", "discard", "crash"]);
}

#[tokio::test]
async fn results_tables_mark_each_finished_run_in_every_format() {
    let fixture = tool_task(ResearchBrief::default());
    fixture.add_run("r001", "python a.py", RunState::Succeeded, &[("acc", 0.88)]);
    fixture.add_run("r002", "python b.py", RunState::Failed, &[("acc", 0.913)]);
    fixture.add_run("r003", "python c.py", RunState::Running, &[]);
    for (format, marker) in [
        ("latex", "% run: r002"),
        ("typst", "// run: r002"),
        ("markdown", "<!-- run: r002 -->"),
    ] {
        let table = fixture
            .call(
                "results_table",
                json!({"metrics": ["acc"], "format": format}),
            )
            .await
            .unwrap();
        let text = table["table"].as_str().unwrap();
        assert!(text.contains(marker), "{format}: {text}");
        assert!(
            text.contains("0.913") && text.contains("0.88"),
            "{format}: {text}"
        );
        assert!(
            !text.contains("r003"),
            "a run still going has no row: {text}"
        );
    }
    let picked = fixture
        .call(
            "results_table",
            json!({"metrics": ["acc"], "format": "latex", "run_ids": ["r001"]}),
        )
        .await
        .unwrap();
    let text = picked["table"].as_str().unwrap();
    assert!(
        text.contains("% run: r001") && !text.contains("r002"),
        "{text}"
    );
    assert_eq!(
        fixture
            .call("results_table", json!({"metrics": [], "format": "latex"}))
            .await
            .unwrap_err(),
        "Name at least one metric."
    );
    assert_eq!(
        fixture
            .call(
                "results_table",
                json!({"metrics": ["acc"], "format": "latex", "run_ids": ["r003"]}),
            )
            .await
            .unwrap_err(),
        "No finished runs match."
    );
}

#[tokio::test]
async fn todos_are_checked_item_by_item_and_saved_for_the_running_task() {
    let fixture = tool_task(ResearchBrief::default());
    let todos = json!([
        {"id": "1", "content": "Run the baseline", "status": "in_progress"},
        {"id": "2", "content": "Write the report", "status": "pending"},
    ]);
    assert_eq!(
        fixture
            .call("update_todos", json!({"todos": todos}))
            .await
            .unwrap(),
        json!({"saved": 2})
    );
    assert_eq!(
        fixture.call("get_todos", json!({})).await.unwrap()["todos"],
        todos
    );
    let too_many: Vec<Value> = (0..101)
        .map(|index| json!({"id": index.to_string(), "content": "x", "status": "pending"}))
        .collect();
    for (refused, message) in [
        (json!("Run the baseline"), "Give the todos as a list."),
        (json!(too_many), "Keep at most 100 todos."),
        (
            json!([{"id": "1", "content": "Run", "status": "maybe"}]),
            "A todo's status must be pending, in_progress, completed or cancelled.",
        ),
        (
            json!([{"id": "1", "content": "  ", "status": "pending"}]),
            "Each todo needs text of up to 300 characters.",
        ),
        (
            json!([{"id": "1", "content": "x".repeat(301), "status": "pending"}]),
            "Each todo needs text of up to 300 characters.",
        ),
    ] {
        assert_eq!(
            fixture
                .call("update_todos", json!({"todos": refused}))
                .await
                .unwrap_err(),
            message
        );
    }
    // A refused list leaves the saved one as it was.
    assert_eq!(
        fixture.call("get_todos", json!({})).await.unwrap()["todos"],
        todos
    );
}

#[tokio::test]
async fn notes_are_dated_one_line_each_and_bounded() {
    let fixture = tool_task(ResearchBrief::default());
    assert_eq!(
        fixture
            .call(
                "remember_note",
                json!({"text": "Baseline acc 0.88\nwith seed 1"})
            )
            .await
            .unwrap(),
        json!({"saved": true})
    );
    let listed = fixture.call("list_notes", json!({})).await.unwrap();
    let notes = listed["notes"].as_str().unwrap();
    let lines: Vec<&str> = notes.lines().collect();
    assert_eq!(lines.len(), 1, "{notes}");
    assert!(
        lines[0].starts_with("- ") && lines[0].ends_with("Z Baseline acc 0.88 with seed 1"),
        "{notes}"
    );
    assert_eq!(
        fixture.call("remember_note", json!({})).await.unwrap_err(),
        "Missing required argument: text."
    );
    assert_eq!(
        fixture
            .call("remember_note", json!({"text": "x".repeat(4 * 1024 + 1)}))
            .await
            .unwrap_err(),
        "A note can be up to 4 KB."
    );
    std::fs::write(fixture.record_file("notes.md"), "x".repeat(256 * 1024 - 8)).unwrap();
    assert_eq!(
        fixture
            .call("remember_note", json!({"text": "One more"}))
            .await
            .unwrap_err(),
        "notes.md is full (256 KB). Move older notes into handoff.md or sources.md."
    );
}

#[tokio::test]
async fn start_run_is_refused_when_commands_are_off() {
    let mut brief = ResearchBrief::default();
    brief.permissions.commands = CommandPolicy::Off;
    let fixture = tool_task(brief);
    assert_eq!(
        fixture
            .call(
                "start_run",
                json!({"name": "baseline", "command": "python train.py"})
            )
            .await
            .unwrap_err(),
        "Commands are turned off for this task."
    );
    assert!(fixture
        .binding
        .services
        .runs
        .list(&fixture.task.id)
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn start_run_stops_at_the_run_limit_and_at_four_runs_in_flight() {
    let mut limited = ResearchBrief::default();
    limited.budget.max_runs = Some(1);
    let fixture = tool_task(limited);
    fixture.add_run("r001", "python a.py", RunState::Succeeded, &[]);
    assert_eq!(
        fixture
            .call(
                "start_run",
                json!({"name": "again", "command": "python a.py"})
            )
            .await
            .unwrap_err(),
        "The task reached its run limit of 1."
    );

    let busy = tool_task(ResearchBrief::default());
    for index in 1..=4 {
        busy.add_run(
            &format!("r00{index}"),
            "python sweep.py",
            RunState::Running,
            &[],
        );
    }
    assert_eq!(
        busy.call(
            "start_run",
            json!({"name": "fifth", "command": "python sweep.py"})
        )
        .await
        .unwrap_err(),
        "Wait for a run to finish before starting another."
    );
    assert_eq!(
        busy.binding
            .services
            .runs
            .list(&busy.task.id)
            .unwrap()
            .len(),
        4
    );
}

#[tokio::test]
async fn start_run_names_a_compute_target_that_is_not_set_up() {
    let mut brief = ResearchBrief::default();
    brief.compute.executor = "gpu-cluster".into();
    let fixture = tool_task(brief);
    assert_eq!(
        fixture
            .call(
                "start_run",
                json!({"name": "baseline", "command": "python train.py"})
            )
            .await
            .unwrap_err(),
        "The gpu-cluster compute target isn't available."
    );
}

#[tokio::test]
async fn start_run_checks_its_arguments_before_anything_runs() {
    let fixture = tool_task(ResearchBrief::default());
    for (args, message) in [
        (
            json!({"command": "python train.py"}),
            "Missing required argument: name.",
        ),
        (
            json!({"name": "baseline"}),
            "Missing required argument: command.",
        ),
        (
            json!({"name": "baseline", "command": "python train.py", "env": ["SEED=1"]}),
            "Give env as an object of names and text values.",
        ),
        (
            json!({"name": "baseline", "command": "python train.py", "env": {"SEED": 1}}),
            "SEED must be text.",
        ),
        (
            json!({"name": "baseline", "command": "python train.py", "env": {"PATH": "/tmp"}}),
            "The task cannot change PATH.",
        ),
        (
            json!({"name": "baseline", "command": "python train.py", "timeout": 61}),
            "Runs in this task can last up to 60 minutes.",
        ),
        (
            json!({"name": "baseline", "command": "python train.py", "cwd": "../outside"}),
            "Use a folder inside the task workspace, written with forward slashes.",
        ),
    ] {
        assert_eq!(fixture.call("start_run", args).await.unwrap_err(), message);
    }
    assert!(fixture
        .binding
        .services
        .runs
        .list(&fixture.task.id)
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn wait_runs_returns_finished_runs_at_once_and_says_when_none_are_in_flight() {
    let fixture = tool_task(ResearchBrief::default());
    fixture.add_run("r001", "python a.py", RunState::Succeeded, &[("acc", 0.9)]);
    let first = fixture
        .call("wait_runs", json!({"timeout": 5}))
        .await
        .unwrap();
    assert_eq!(first["finished"][0]["runId"], "r001");
    assert_eq!(first["finished"][0]["metrics"]["acc"], 0.9);
    assert_eq!(first["timedOut"], false);
    // Each finished run is reported once.
    let none = fixture
        .call("wait_runs", json!({"timeout": 5}))
        .await
        .unwrap();
    assert_eq!(
        none,
        json!({"finished": [], "stillRunning": [], "timedOut": false, "note": "No runs are in flight."})
    );
    assert_eq!(
        fixture.phases(),
        [
            TaskPhase::WaitingRuns,
            TaskPhase::Working,
            TaskPhase::WaitingRuns,
            TaskPhase::Working
        ]
    );
}

#[tokio::test]
async fn run_tools_name_the_runs_a_task_does_not_have() {
    let fixture = tool_task(ResearchBrief::default());
    assert_eq!(
        fixture.call("run_status", json!({})).await.unwrap(),
        json!([])
    );
    fixture.add_run("r001", "python a.py", RunState::Failed, &[]);
    let status = fixture
        .call("run_status", json!({"id": "r001"}))
        .await
        .unwrap();
    assert_eq!(
        (status["runId"].as_str(), status["state"].as_str()),
        (Some("r001"), Some("failed"))
    );
    assert_eq!(
        fixture
            .call("run_status", json!({}))
            .await
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        fixture
            .call("run_status", json!({"id": "r404"}))
            .await
            .unwrap_err(),
        "No run r404 in this task."
    );
    assert_eq!(
        fixture.call("read_run_log", json!({})).await.unwrap_err(),
        "Missing required argument: id."
    );
    assert_eq!(
        fixture
            .call("read_run_log", json!({"id": "r001", "tail": 5}))
            .await
            .unwrap(),
        json!({"log": ""})
    );
    assert_eq!(
        fixture.call("cancel_run", json!({})).await.unwrap_err(),
        "Missing required argument: id."
    );
    // A run that already ended has nothing left to stop.
    assert_eq!(
        fixture
            .call("cancel_run", json!({"id": "r001"}))
            .await
            .unwrap(),
        json!({"stopping": "r001"})
    );
}

#[tokio::test]
async fn tools_that_need_the_host_say_what_is_missing() {
    let fixture = tool_task(ResearchBrief::default());
    assert_eq!(
        fixture.call("compile", json!({})).await.unwrap(),
        json!({"ok": false, "skipped": "The command-line tool isn't available."})
    );
    assert_eq!(
        fixture.call("project_map", json!({})).await.unwrap_err(),
        "Project maps in tasks need a newer build."
    );
    assert_eq!(
        fixture
            .call("web_fetch", json!({"url": "https://example.org"}))
            .await
            .unwrap_err(),
        "Web access is off for this task."
    );
    assert_eq!(
        fixture.call("read_paper", json!({})).await.unwrap_err(),
        "Give a doi, arxiv id, url or path."
    );
    assert_eq!(
        fixture
            .call("literature_search", json!({}))
            .await
            .unwrap_err(),
        "Missing required argument: query."
    );
    // Helpers and the workspace tools are not task tools.
    for name in [super::extra::SPAWN_AGENT, "read_file", "run_command"] {
        assert!(
            call_task_tool(name, json!({}), &fixture.binding)
                .await
                .is_none(),
            "{name}"
        );
    }
}

#[tokio::test]
async fn runs_wait_for_the_plan_for_every_agent() {
    let brief = ResearchBrief {
        review_plan_first: true,
        ..ResearchBrief::default()
    };
    let fixture = tool_task(brief);
    // A CLI agent reaches `start_run` through the bridge, not through the
    // built-in agent's own plan check.
    let refused = fixture
        .call(
            "start_run",
            json!({"name": "baseline", "command": "python train.py"}),
        )
        .await;
    assert_eq!(refused, Err(extra::PLAN_NO_RUNS.to_owned()));
    assert!(fixture
        .binding
        .services
        .runs
        .list(&fixture.task.id)
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn a_cancelled_task_starts_no_run_after_its_approval() {
    let fixture = tool_task(ResearchBrief::default());
    fixture.binding.cancel.cancel();
    let refused = fixture
        .call(
            "start_run",
            json!({"name": "baseline", "command": "python train.py"}),
        )
        .await;
    assert_eq!(refused, Err("The task was cancelled.".to_owned()));
    assert!(fixture
        .binding
        .services
        .runs
        .list(&fixture.task.id)
        .unwrap()
        .is_empty());
}

#[test]
fn write_grants_cover_folders_not_every_file() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().canonicalize().unwrap();
    for folder in ["src/sub", "analysis"] {
        std::fs::create_dir_all(root.join(folder)).unwrap();
    }
    for file in ["main.tex", "src/a.py", "src/sub/b.py", "analysis/c.py"] {
        std::fs::write(root.join(file), "x").unwrap();
    }
    // The allowed paths of a copied project: every file and every folder
    // that holds one, with the output folders.
    let allowed: Vec<String> = [
        "main.tex",
        "src",
        "src/a.py",
        "src/sub",
        "src/sub/b.py",
        "analysis",
        "analysis/c.py",
        "results",
    ]
    .map(String::from)
    .to_vec();
    let writable = task_writable_paths(&root, &allowed).unwrap();
    // `src` covers `src/a.py` and `src/sub`; `analysis` covers its file.
    assert_eq!(
        writable,
        vec![
            root.join("analysis"),
            root.join("main.tex"),
            root.join("results"),
            root.join("src"),
        ]
    );
}

#[test]
fn a_deleted_file_is_not_brought_back_as_a_folder() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().canonicalize().unwrap();
    std::fs::create_dir_all(root.join("data/raw")).unwrap();
    std::fs::write(root.join("data/raw/a.csv"), "x").unwrap();
    std::fs::write(root.join("table.csv"), "x").unwrap();
    let allowed: Vec<String> = ["table.csv", "data/raw", "data/raw/a.csv", "results"]
        .map(String::from)
        .to_vec();
    // The task deleted a file and a whole folder of its copy.
    std::fs::remove_file(root.join("table.csv")).unwrap();
    std::fs::remove_dir_all(root.join("data")).unwrap();

    let writable = task_writable_paths(&root, &allowed).unwrap();
    // The deleted file stays gone; the folders the task writes in return.
    assert!(!root.join("table.csv").exists());
    assert!(root.join("data/raw").is_dir());
    assert!(root.join("results").is_dir());
    assert!(!root.join("data/raw/a.csv").exists());
    assert_eq!(writable, vec![root.join("data/raw"), root.join("results")]);
}

#[tokio::test]
async fn an_unreadable_ledger_is_never_replaced_by_a_fresh_one() {
    let fixture = tool_task(ResearchBrief::default());
    let path = fixture.record_file("ledger.tsv");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    // Not text, as a command could leave it.
    let damaged: Vec<u8> = [LEDGER_HEADER.as_bytes(), b"\nr001\t\xff\xfe\n"].concat();
    std::fs::write(&path, &damaged).unwrap();

    let refused = fixture
        .call(
            "ledger_append",
            json!({"hypothesis": "h", "change": "c", "verdict": "keep"}),
        )
        .await;
    assert!(refused.is_err(), "{refused:?}");
    assert_eq!(std::fs::read(&path).unwrap(), damaged);
}

#[tokio::test]
async fn a_ledger_row_keeps_a_short_command_and_a_new_note_follows_the_last_one() {
    let fixture = tool_task(ResearchBrief::default());
    let command = format!("python train.py {}", "--flag ".repeat(500));
    fixture.add_run("r001", &command, RunState::Succeeded, &[("acc", 0.9)]);
    fixture
        .call(
            "ledger_append",
            json!({"hypothesis": "h", "change": "c", "run_id": "r001", "verdict": "keep"}),
        )
        .await
        .unwrap();
    let kept = &fixture.ledger()[0].command;
    assert!(kept.chars().count() <= 401, "{}", kept.chars().count());
    assert!(kept.starts_with("python train.py --flag") && kept.ends_with('…'));

    // The row read may be only the newest of a long ledger: ids come from the
    // highest note, not from how many rows were read.
    let path = fixture.record_file("ledger.tsv");
    let mut text = std::fs::read_to_string(&path).unwrap();
    text.push_str("n007\t\t\t\t\t\tdiscard\t\n");
    std::fs::write(&path, text).unwrap();
    let note = fixture
        .call(
            "ledger_append",
            json!({"hypothesis": "h", "change": "c", "verdict": "discard"}),
        )
        .await
        .unwrap();
    assert_eq!(note["id"], "n008");
}

#[tokio::test]
async fn a_full_ledger_says_so_instead_of_a_size_error() {
    let fixture = tool_task(ResearchBrief::default());
    let path = fixture.record_file("ledger.tsv");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    // Within a few bytes of the 1 MiB a file operation may write.
    let filler = "x".repeat(1024 * 1024 - LEDGER_HEADER.len() - 32);
    std::fs::write(
        &path,
        format!("{LEDGER_HEADER}\nn001\t\t{filler}\t\t\t\tkeep\t\n"),
    )
    .unwrap();
    let refused = fixture
        .call(
            "ledger_append",
            json!({"hypothesis": "h", "change": "c", "verdict": "keep"}),
        )
        .await
        .unwrap_err();
    assert!(refused.contains("ledger.tsv is full"), "{refused}");
}
