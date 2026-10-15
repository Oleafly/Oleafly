#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Command {
    Serve,
    Version,
    Healthcheck,
}

pub fn parse_command(arguments: &[String]) -> Result<Command, String> {
    match arguments {
        [] => Ok(Command::Serve),
        [only] if only == "--version" => Ok(Command::Version),
        [only] if only == "healthcheck" => Ok(Command::Healthcheck),
        _ => Err(format!(
            "oleafly-server does not understand {}. Run it with no arguments to serve, or with healthcheck or --version.",
            arguments.join(" ")
        )),
    }
}

pub fn version_line() -> String {
    format!("oleafly-server {}", env!("CARGO_PKG_VERSION"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(arguments: &[&str]) -> Result<Command, String> {
        let owned: Vec<String> = arguments
            .iter()
            .map(|argument| (*argument).to_string())
            .collect();
        parse_command(&owned)
    }

    #[test]
    fn no_arguments_serve_and_the_two_subcommands_are_recognised() {
        assert_eq!(parse(&[]), Ok(Command::Serve));
        assert_eq!(parse(&["--version"]), Ok(Command::Version));
        assert_eq!(parse(&["healthcheck"]), Ok(Command::Healthcheck));
    }

    #[test]
    fn anything_else_is_a_usage_error() {
        let cases: [&[&str]; 4] = [
            &["serve"],
            &["--help"],
            &["healthcheck", "now"],
            &["--version", "--verbose"],
        ];
        for arguments in cases {
            let error = parse(arguments).unwrap_err();
            assert!(
                error.contains("healthcheck") && error.contains("--version"),
                "{error}"
            );
        }
    }

    #[test]
    fn the_version_line_names_the_binary_and_its_version() {
        assert_eq!(
            version_line(),
            concat!("oleafly-server ", env!("CARGO_PKG_VERSION"))
        );
    }
}
