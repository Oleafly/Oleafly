fn main() {
    std::process::exit(oleafly_sandbox::entry(|| None).unwrap_or(2));
}
