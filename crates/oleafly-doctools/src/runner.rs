use std::future::Future;
use std::path::Path;
use std::pin::Pin;

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
