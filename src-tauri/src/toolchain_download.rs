//! Verified toolchain downloads (Typst, Tinymist, TinyTeX). The installer
//! and its tests live in `oleafly_downloads::toolchain`, shared with the
//! `oleafly` CLI; the app's quit gate and updater read its install state
//! from here.
pub(crate) use oleafly_downloads::toolchain::*;
