use clap::Parser;
use std::process::ExitCode;

#[tokio::main]
async fn main() -> ExitCode {
    ExitCode::from(oleafly_cli::run(oleafly_cli::Cli::parse()).await)
}
