//! Document tools both the app and the `oleafly` CLI use. Nothing here
//! depends on Tauri; errors carry the app's error codes so its translations
//! keep working, with English text for the CLI.
pub mod bib_clean;
pub mod conversion;
pub mod error;
pub mod export;
pub mod pandoc_citations;
pub mod runner;
pub mod stats;
pub mod synctex;

pub use error::DocError;
pub use runner::{RunFuture, ToolRunner};
