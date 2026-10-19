//! The sandbox launcher on its own, for the Windows integration tests.
fn main() {
    std::process::exit(oleafly_sandbox::entry(|| None).unwrap_or(2));
}
