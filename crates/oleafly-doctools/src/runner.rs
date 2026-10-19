//! How a document tool runs an external program (Pandoc, Typst): the app
//! supervises it its way, the CLI its own.
use std::future::Future;
use std::path::Path;
use std::pin::Pin;

/// The program's output and exit code, or why it couldn't run.
pub type RunFuture<'a> =
    Pin<Box<dyn Future<Output = Result<(String, Option<i32>), String>> + Send + 'a>>;

pub trait ToolRunner: Send + Sync {
    fn run<'a>(
        &'a self,
        program: &'a Path,
        args: &'a [String],
        working_dir: &'a Path,
        variables: &'a [(String, String)],
    ) -> RunFuture<'a>;
}
