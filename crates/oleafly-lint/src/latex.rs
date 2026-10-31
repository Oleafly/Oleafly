use std::collections::HashMap;
use std::sync::LazyLock;

use oleafly_preflight::jsre::JsRegex;
use oleafly_preflight::latex::lexical::{
    is_command_unit, latex_balanced_group_end, latex_inline_verbatim_span,
};
use oleafly_preflight::latex::novalidate::{
    novalidate_directive_at, skip_novalidate_region, Novalidate,
};
use oleafly_preflight::messages::MessageRef;
use oleafly_preflight::msg;
use oleafly_preflight::text::{index_of_units, js_trim, units_eq_str, SourceText};
use oleafly_preflight::types::Severity;

use crate::diagnostic::{compare, LintDiagnostic, LintSource};
use crate::xparse::validate_xparse_argument_specification;

const BACKSLASH: u16 = b'\\' as u16;
const OPEN_BRACE: u16 = b'{' as u16;
const CLOSE_BRACE: u16 = b'}' as u16;
const OPEN_BRACKET: u16 = b'[' as u16;
const CLOSE_BRACKET: u16 = b']' as u16;
const OPEN_PAREN: u16 = b'(' as u16;
const CLOSE_PAREN: u16 = b')' as u16;
const DOLLAR: u16 = b'$' as u16;
const PERCENT: u16 = b'%' as u16;
const STAR: u16 = b'*' as u16;
const NEWLINE: u16 = b'\n' as u16;

const VERBATIM_ENVIRONMENTS: &[&str] = &[
    "verbatim",
    "verbatim*",
    "Verbatim",
    "Verbatim*",
    "lstlisting",
    "minted",
    "comment",
];
const REQUIRED_BRACED_COMMANDS: &[&str] = &[
    "documentclass",
    "usepackage",
    "RequirePackage",
    "addbibresource",
    "newtheorem",
];
const CLASSIC_COMMAND_DEFINITIONS: &[&str] = &[
    "newcommand",
    "renewcommand",
    "providecommand",
    "DeclareRobustCommand",
];
const XPARSE_COMMAND_DEFINITIONS: &[&str] = &[
    "NewDocumentCommand",
    "RenewDocumentCommand",
    "ProvideDocumentCommand",
    "DeclareDocumentCommand",
];
const CLASSIC_ENVIRONMENT_DEFINITIONS: &[&str] = &["newenvironment", "renewenvironment"];
const XPARSE_ENVIRONMENT_DEFINITIONS: &[&str] = &[
    "NewDocumentEnvironment",
    "RenewDocumentEnvironment",
    "ProvideDocumentEnvironment",
    "DeclareDocumentEnvironment",
];

#[derive(Clone, Copy, PartialEq, Eq)]
enum MathDelimiter {
    Dollar,
    DoubleDollar,
    Paren,
    Bracket,
}

impl MathDelimiter {
    fn text(self) -> &'static str {
        match self {
            Self::Dollar => "$",
            Self::DoubleDollar => "$$",
            Self::Paren => "\\(",
            Self::Bracket => "\\[",
        }
    }

    fn closing(self) -> &'static str {
        match self {
            Self::Dollar => "$",
            Self::DoubleDollar => "$$",
            Self::Paren => "\\)",
            Self::Bracket => "\\]",
        }
    }
}

struct OpenMath {
    delimiter: MathDelimiter,
    from: usize,
    to: usize,
}

struct OpenEnvironment {
    name: String,
    from: usize,
    to: usize,
}

fn is_whitespace(unit: Option<u16>) -> bool {
    matches!(unit, Some(0x20) | Some(0x09) | Some(0x0a) | Some(0x0d))
}

fn skip_whitespace(text: &[u16], start: usize) -> usize {
    let mut cursor = start;
    while is_whitespace(text.get(cursor).copied()) {
        cursor += 1;
    }
    cursor
}

fn lossy(units: &[u16]) -> String {
    String::from_utf16_lossy(units)
}

fn slice(text: &[u16], from: usize, to: usize) -> &[u16] {
    let to = to.min(text.len());
    &text[from.min(to)..to]
}

fn diagnostic(from: usize, to: usize, severity: Severity, message: MessageRef) -> LintDiagnostic {
    LintDiagnostic::catalog(from, to, severity, message, LintSource::Latex)
}

fn error(from: usize, to: usize, message: MessageRef) -> LintDiagnostic {
    diagnostic(from, to, Severity::Error, message)
}

fn optional_argument_close(text: &[u16], opening: usize) -> Option<usize> {
    let mut brace_depth = 0usize;
    let mut cursor = opening + 1;
    while cursor < text.len() {
        let unit = text[cursor];
        if unit == BACKSLASH {
            cursor += 2.min(text.len() - cursor);
            continue;
        }
        if unit == OPEN_BRACE {
            brace_depth += 1;
        } else if unit == CLOSE_BRACE && brace_depth > 0 {
            brace_depth -= 1;
        } else if unit == CLOSE_BRACKET && brace_depth == 0 {
            return Some(cursor + 1);
        }
        cursor += 1;
    }
    None
}

fn after_optional_arguments(text: &[u16], start: usize) -> Result<usize, usize> {
    let mut cursor = skip_whitespace(text, start);
    if text.get(cursor) == Some(&STAR) {
        cursor = skip_whitespace(text, cursor + 1);
    }
    while text.get(cursor) == Some(&OPEN_BRACKET) {
        let opening = cursor;
        match optional_argument_close(text, opening) {
            Some(close) => cursor = skip_whitespace(text, close),
            None => return Err(opening),
        }
    }
    Ok(cursor)
}

fn balanced_brace_end(text: &[u16], start: usize) -> Option<usize> {
    if text.get(start) != Some(&OPEN_BRACE) {
        return None;
    }
    let mut depth = 1usize;
    let mut cursor = start + 1;
    while cursor < text.len() {
        if text[cursor] == BACKSLASH {
            cursor += 2;
            continue;
        }
        if text[cursor] == OPEN_BRACE {
            depth += 1;
        } else if text[cursor] == CLOSE_BRACE {
            depth -= 1;
            if depth == 0 {
                return Some(cursor);
            }
        }
        cursor += 1;
    }
    None
}

static DEFINED_COMMAND: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(r"^\\(?:[\p{L}\p{M}@]+|[^\n\r\x{2028}\x{2029}])$"));
static SINGLE_DIGIT: LazyLock<JsRegex> = LazyLock::new(|| JsRegex::std(r"^[0-9]$"));

fn valid_defined_command(value: &str) -> bool {
    DEFINED_COMMAND.is_match(js_trim(value))
}

struct DefinitionGroup {
    content: Vec<u16>,
    from: usize,
    to: usize,
}

fn definition_group(text: &[u16], start: usize, optional: bool) -> Option<DefinitionGroup> {
    let from = skip_whitespace(text, start);
    let to = if optional {
        optional_argument_close(text, from)?
    } else {
        latex_balanced_group_end(text, from, OPEN_BRACE, CLOSE_BRACE)?
    };
    Some(DefinitionGroup {
        content: text[from + 1..to - 1].to_vec(),
        from,
        to,
    })
}

#[derive(Clone, Copy)]
enum GroupKind {
    EnvironmentName,
    CommandName,
    ArgumentSpecification,
    ArgumentCount,
    DefaultArgument,
    BeginBody,
    ReplacementBody,
    EndBody,
}

fn braced_key(kind: GroupKind) -> &'static str {
    match kind {
        GroupKind::EnvironmentName => "latex.lint.bracedEnvironmentName",
        GroupKind::CommandName => "latex.lint.bracedCommandName",
        GroupKind::ArgumentSpecification => "latex.lint.bracedArgumentSpecification",
        GroupKind::ArgumentCount => "latex.lint.bracedArgumentCount",
        GroupKind::DefaultArgument => "latex.lint.bracedDefaultArgument",
        GroupKind::BeginBody => "latex.lint.bracedBeginBody",
        GroupKind::ReplacementBody => "latex.lint.bracedReplacementBody",
        GroupKind::EndBody => "latex.lint.bracedEndBody",
    }
}

fn unclosed_key(kind: GroupKind) -> &'static str {
    match kind {
        GroupKind::EnvironmentName => "latex.lint.unclosedEnvironmentName",
        GroupKind::CommandName => "latex.lint.unclosedCommandName",
        GroupKind::ArgumentSpecification => "latex.lint.unclosedArgumentSpecification",
        GroupKind::ArgumentCount => "latex.lint.unclosedArgumentCount",
        GroupKind::DefaultArgument => "latex.lint.unclosedDefaultArgument",
        GroupKind::BeginBody => "latex.lint.unclosedBeginBody",
        GroupKind::ReplacementBody => "latex.lint.unclosedReplacementBody",
        GroupKind::EndBody => "latex.lint.unclosedEndBody",
    }
}

fn marker(text: &[u16], from: usize) -> (usize, usize) {
    let marker_from = from.min(text.len().saturating_sub(1));
    (marker_from, text.len().min(marker_from + 1))
}

fn required_definition_group(
    text: &[u16],
    start: usize,
    command: &str,
    kind: GroupKind,
    diagnostics: &mut Vec<LintDiagnostic>,
) -> Option<DefinitionGroup> {
    let from = skip_whitespace(text, start);
    if text.get(from) != Some(&OPEN_BRACE) {
        let (marker_from, marker_to) = marker(text, from);
        diagnostics.push(error(
            marker_from,
            marker_to,
            msg!(braced_key(kind), "command" => command),
        ));
        return None;
    }
    let group = definition_group(text, from, false);
    if group.is_none() {
        let (marker_from, marker_to) = marker(text, from);
        diagnostics.push(error(
            marker_from,
            marker_to,
            msg!(unclosed_key(kind), "command" => command),
        ));
    }
    group
}

enum OptionalGroup {
    Absent,
    Unclosed,
    Present(DefinitionGroup),
}

fn optional_definition_group(
    text: &[u16],
    start: usize,
    command: &str,
    kind: GroupKind,
    diagnostics: &mut Vec<LintDiagnostic>,
) -> OptionalGroup {
    let from = skip_whitespace(text, start);
    if text.get(from) != Some(&OPEN_BRACKET) {
        return OptionalGroup::Absent;
    }
    match definition_group(text, from, true) {
        Some(group) => OptionalGroup::Present(group),
        None => {
            let (marker_from, marker_to) = marker(text, from);
            diagnostics.push(error(
                marker_from,
                marker_to,
                msg!(unclosed_key(kind), "command" => command),
            ));
            OptionalGroup::Unclosed
        }
    }
}

#[derive(Clone, Copy)]
struct DefinitionKinds {
    classic_command: bool,
    xparse_command: bool,
    classic_environment: bool,
    xparse_environment: bool,
}

impl DefinitionKinds {
    fn environment(self) -> bool {
        self.classic_environment || self.xparse_environment
    }
}

fn control_sequence_name_end(
    text: &[u16],
    cursor: usize,
    command: &str,
    diagnostics: &mut Vec<LintDiagnostic>,
) -> Option<usize> {
    let mut name_end = cursor + 1;
    if text.get(name_end).is_none() {
        diagnostics.push(error(
            cursor,
            cursor + 1,
            msg!("latex.lint.incompleteCommandName", "command" => command),
        ));
        return None;
    }
    if is_command_unit(text.get(name_end).copied()) {
        while is_command_unit(text.get(name_end).copied()) {
            name_end += 1;
        }
    } else {
        name_end += 1;
    }
    Some(name_end)
}

fn definition_name_end(
    text: &[u16],
    cursor: usize,
    command: &str,
    kinds: DefinitionKinds,
    diagnostics: &mut Vec<LintDiagnostic>,
) -> Option<usize> {
    if kinds.classic_command && text.get(cursor) == Some(&BACKSLASH) {
        return control_sequence_name_end(text, cursor, command, diagnostics);
    }
    let kind = if kinds.environment() {
        GroupKind::EnvironmentName
    } else {
        GroupKind::CommandName
    };
    let name = required_definition_group(text, cursor, command, kind, diagnostics)?;
    let content = lossy(&name.content);
    if (kinds.classic_command || kinds.xparse_command) && !valid_defined_command(&content) {
        diagnostics.push(error(
            name.from + 1,
            name.to - 1,
            msg!("latex.lint.requiresControlSequence", "command" => command),
        ));
    }
    if kinds.environment() && js_trim(&content).is_empty() {
        diagnostics.push(error(
            name.from,
            name.to,
            msg!("latex.lint.emptyEnvironmentName", "command" => command),
        ));
    }
    Some(name.to)
}

fn xparse_specification_end(
    text: &[u16],
    cursor: usize,
    command: &str,
    diagnostics: &mut Vec<LintDiagnostic>,
) -> Option<usize> {
    let specification = required_definition_group(
        text,
        cursor,
        command,
        GroupKind::ArgumentSpecification,
        diagnostics,
    )?;
    for (from, to, message) in validate_xparse_argument_specification(&specification.content) {
        diagnostics.push(error(
            specification.from + 1 + from,
            specification.from + 1 + to,
            message,
        ));
    }
    Some(specification.to)
}

fn classic_argument_count_end(
    text: &[u16],
    cursor: usize,
    command: &str,
    diagnostics: &mut Vec<LintDiagnostic>,
) -> Option<usize> {
    let count = match optional_definition_group(
        text,
        cursor,
        command,
        GroupKind::ArgumentCount,
        diagnostics,
    ) {
        OptionalGroup::Unclosed => return None,
        OptionalGroup::Absent => return Some(cursor),
        OptionalGroup::Present(count) => count,
    };
    if !SINGLE_DIGIT.is_match(js_trim(&lossy(&count.content))) {
        diagnostics.push(error(
            count.from + 1,
            count.to - 1,
            msg!("latex.lint.argumentCountDigit", "command" => command),
        ));
    }
    match optional_definition_group(
        text,
        count.to,
        command,
        GroupKind::DefaultArgument,
        diagnostics,
    ) {
        OptionalGroup::Unclosed => None,
        OptionalGroup::Absent => Some(count.to),
        OptionalGroup::Present(default_value) => Some(default_value.to),
    }
}

fn validate_definition(
    text: &[u16],
    command_end: usize,
    command: &str,
    diagnostics: &mut Vec<LintDiagnostic>,
) {
    let kinds = DefinitionKinds {
        classic_command: CLASSIC_COMMAND_DEFINITIONS.contains(&command),
        xparse_command: XPARSE_COMMAND_DEFINITIONS.contains(&command),
        classic_environment: CLASSIC_ENVIRONMENT_DEFINITIONS.contains(&command),
        xparse_environment: XPARSE_ENVIRONMENT_DEFINITIONS.contains(&command),
    };
    if !kinds.classic_command && !kinds.xparse_command && !kinds.environment() {
        return;
    }
    let mut cursor = skip_whitespace(text, command_end);
    if text.get(cursor) == Some(&STAR) {
        cursor = skip_whitespace(text, cursor + 1);
    }
    let Some(after_name) = definition_name_end(text, cursor, command, kinds, diagnostics) else {
        return;
    };
    let after_arguments = if kinds.xparse_command || kinds.xparse_environment {
        xparse_specification_end(text, after_name, command, diagnostics)
    } else {
        classic_argument_count_end(text, after_name, command, diagnostics)
    };
    let Some(after_arguments) = after_arguments else {
        return;
    };
    let body_kind = if kinds.environment() {
        GroupKind::BeginBody
    } else {
        GroupKind::ReplacementBody
    };
    let Some(first_body) =
        required_definition_group(text, after_arguments, command, body_kind, diagnostics)
    else {
        return;
    };
    if !kinds.environment() {
        return;
    }
    required_definition_group(
        text,
        first_body.to,
        command,
        GroupKind::EndBody,
        diagnostics,
    );
}

struct Scan<'a> {
    text: &'a [u16],
    diagnostics: Vec<LintDiagnostic>,
    braces: Vec<(usize, usize)>,
    environments: Vec<OpenEnvironment>,
    math: Vec<OpenMath>,
    labels: HashMap<String, usize>,
    disabled: bool,
}

impl Scan<'_> {
    fn comment_step(&mut self, cursor: usize) -> Option<usize> {
        let text = self.text;
        let line_end = index_of_units(text, &[NEWLINE], cursor + 1);
        let stop = line_end.unwrap_or(text.len());
        match novalidate_directive_at(text, cursor, stop) {
            Some(Novalidate::File) => {
                self.disabled = true;
                None
            }
            Some(Novalidate::Begin) => Some(skip_novalidate_region(text, stop)),
            _ => Some(line_end.map_or(text.len(), |end| end + 1)),
        }
    }

    fn close_brace_step(&mut self, cursor: usize) -> usize {
        if self.braces.pop().is_none() {
            self.diagnostics.push(error(
                cursor,
                cursor + 1,
                msg!("latex.lint.unmatchedClosingBrace"),
            ));
        }
        cursor + 1
    }

    fn dollar_math_step(&mut self, cursor: usize) -> usize {
        let delimiter = if self.text.get(cursor + 1) == Some(&DOLLAR) {
            MathDelimiter::DoubleDollar
        } else {
            MathDelimiter::Dollar
        };
        let width = delimiter.text().len();
        match self.math.last() {
            Some(top) if top.delimiter == delimiter => {
                self.math.pop();
            }
            None => self.math.push(OpenMath {
                delimiter,
                from: cursor,
                to: cursor + width,
            }),
            Some(top) => {
                let expected = top.delimiter.closing();
                self.diagnostics.push(error(
                    cursor,
                    cursor + width,
                    msg!("latex.lint.mismatchedMathDelimiter", "expected" => expected, "found" => delimiter.text()),
                ));
            }
        }
        cursor + width
    }

    fn open_inline_math_step(&mut self, cursor: usize, next: u16) -> usize {
        self.math.push(OpenMath {
            delimiter: if next == OPEN_PAREN {
                MathDelimiter::Paren
            } else {
                MathDelimiter::Bracket
            },
            from: cursor,
            to: cursor + 2,
        });
        cursor + 2
    }

    fn close_inline_math_step(&mut self, cursor: usize, next: u16) -> usize {
        let (close, expected_open) = if next == CLOSE_PAREN {
            ("\\)", MathDelimiter::Paren)
        } else {
            ("\\]", MathDelimiter::Bracket)
        };
        match self.math.last() {
            Some(top) if top.delimiter == expected_open => {
                self.math.pop();
            }
            Some(top) => {
                let expected = top.delimiter.closing();
                self.diagnostics.push(error(
                    cursor,
                    cursor + 2,
                    msg!("latex.lint.mismatchedMathDelimiter", "expected" => expected, "found" => close),
                ));
            }
            None => {
                self.diagnostics.push(error(
                    cursor,
                    cursor + 2,
                    msg!("latex.lint.endWithoutBegin", "end" => close, "begin" => expected_open.text()),
                ));
            }
        }
        cursor + 2
    }

    fn inline_verbatim_step(&mut self, cursor: usize, command_end: usize, command: &str) -> usize {
        let Some(inline) = latex_inline_verbatim_span(self.text, cursor) else {
            self.diagnostics.push(error(
                cursor,
                command_end,
                msg!("latex.lint.invalidVerbatimArgument", "command" => command),
            ));
            return command_end;
        };
        if !inline.complete {
            self.diagnostics.push(error(
                cursor,
                self.text.len().min(command_end + 1),
                msg!("latex.lint.unclosedCommand", "command" => command),
            ));
        }
        command_end.max(inline.to)
    }

    fn validate_required_braced_argument(
        &mut self,
        cursor: usize,
        command_end: usize,
        command: &str,
    ) {
        let text = self.text;
        let start = match after_optional_arguments(text, command_end) {
            Ok(start) => start,
            Err(opening) => {
                self.diagnostics.push(error(
                    opening,
                    opening + 1,
                    msg!("latex.lint.unclosedOptionalArgument", "command" => command),
                ));
                return;
            }
        };
        if text.get(start) != Some(&OPEN_BRACE) {
            self.diagnostics.push(error(
                cursor,
                command_end,
                msg!("latex.lint.requiresBracedArgument", "command" => command),
            ));
            return;
        }
        if let Some(argument_end) = balanced_brace_end(text, start) {
            if js_trim(&lossy(slice(text, start + 1, argument_end))).is_empty() {
                self.diagnostics.push(error(
                    start,
                    argument_end + 1,
                    msg!("latex.lint.emptyArgument", "command" => command),
                ));
            }
        }
    }

    fn validate_command_arguments(&mut self, cursor: usize, command_end: usize, command: &str) {
        let definition = CLASSIC_COMMAND_DEFINITIONS.contains(&command)
            || XPARSE_COMMAND_DEFINITIONS.contains(&command)
            || CLASSIC_ENVIRONMENT_DEFINITIONS.contains(&command)
            || XPARSE_ENVIRONMENT_DEFINITIONS.contains(&command);
        if definition {
            validate_definition(self.text, command_end, command, &mut self.diagnostics);
            return;
        }
        if REQUIRED_BRACED_COMMANDS.contains(&command) {
            self.validate_required_braced_argument(cursor, command_end, command);
        }
    }

    fn label_step(&mut self, argument_start: usize, argument_end: usize, argument: &str) -> usize {
        if self.labels.contains_key(argument) {
            self.diagnostics.push(diagnostic(
                argument_start + 1,
                argument_end,
                Severity::Warning,
                msg!("latex.lint.duplicateLabel", "label" => argument),
            ));
        } else {
            self.labels.insert(argument.to_string(), argument_start + 1);
        }
        argument_end + 1
    }

    fn begin_environment_step(
        &mut self,
        cursor: usize,
        argument_end: usize,
        argument: &str,
    ) -> usize {
        let text = self.text;
        if VERBATIM_ENVIRONMENTS.contains(&argument) {
            let closing: Vec<u16> = format!("\\end{{{argument}}}").encode_utf16().collect();
            return match index_of_units(text, &closing, argument_end + 1) {
                Some(close) => close + closing.len(),
                None => {
                    self.diagnostics.push(error(
                        cursor,
                        argument_end + 1,
                        msg!("latex.lint.unclosedEnvironment", "environment" => format!("\\begin{{{argument}}}")),
                    ));
                    text.len()
                }
            };
        }
        self.environments.push(OpenEnvironment {
            name: argument.to_string(),
            from: cursor,
            to: argument_end + 1,
        });
        argument_end + 1
    }

    fn end_environment_step(
        &mut self,
        cursor: usize,
        argument_end: usize,
        argument: &str,
    ) -> usize {
        if self
            .environments
            .last()
            .is_some_and(|top| top.name == argument)
        {
            self.environments.pop();
            return argument_end + 1;
        }
        let Some(matching) = self
            .environments
            .iter()
            .rposition(|open| open.name == argument)
        else {
            self.diagnostics.push(error(
                cursor,
                argument_end + 1,
                msg!(
                    "latex.lint.endWithoutBegin",
                    "end" => format!("\\end{{{argument}}}"),
                    "begin" => format!("\\begin{{{argument}}}")
                ),
            ));
            return argument_end + 1;
        };
        let top_name = self
            .environments
            .last()
            .map(|top| top.name.clone())
            .unwrap_or_else(|| argument.to_string());
        self.diagnostics.push(error(
            cursor,
            argument_end + 1,
            msg!(
                "latex.lint.mismatchedEnvironment",
                "expected" => format!("\\end{{{top_name}}}"),
                "found" => format!("\\end{{{argument}}}")
            ),
        ));
        for skipped in self.environments[matching + 1..].iter().rev() {
            self.diagnostics.push(error(
                skipped.from,
                skipped.to,
                msg!("latex.lint.unclosedEnvironment", "environment" => format!("\\begin{{{}}}", skipped.name)),
            ));
        }
        self.environments.truncate(matching);
        argument_end + 1
    }

    fn structural_command_step(
        &mut self,
        cursor: usize,
        command_end: usize,
        command: &str,
    ) -> usize {
        let text = self.text;
        let mut argument_start = command_end;
        while is_whitespace(text.get(argument_start).copied()) {
            argument_start += 1;
        }
        if text.get(argument_start) != Some(&OPEN_BRACE) {
            self.diagnostics.push(error(
                cursor,
                command_end,
                msg!("latex.lint.requiresBracedArgument", "command" => command),
            ));
            return command_end;
        }
        let Some(argument_end) = index_of_units(text, &[CLOSE_BRACE], argument_start + 1) else {
            self.diagnostics.push(error(
                cursor,
                text.len().min(argument_start + 1),
                msg!("latex.lint.unclosedArgument", "command" => command),
            ));
            return argument_start + 1;
        };
        let raw = lossy(&text[argument_start + 1..argument_end]);
        let argument = js_trim(&raw).to_string();
        if argument.is_empty() {
            self.diagnostics.push(error(
                argument_start,
                argument_end + 1,
                msg!("latex.lint.emptyArgument", "command" => command),
            ));
            return argument_end + 1;
        }
        match command {
            "label" => self.label_step(argument_start, argument_end, &argument),
            "begin" => self.begin_environment_step(cursor, argument_end, &argument),
            _ => self.end_environment_step(cursor, argument_end, &argument),
        }
    }

    fn backslash_step(&mut self, cursor: usize) -> Option<usize> {
        let text = self.text;
        let Some(&next) = text.get(cursor + 1) else {
            self.diagnostics.push(error(
                cursor,
                cursor + 1,
                msg!("latex.lint.incompleteCommandAtEof"),
            ));
            return None;
        };
        if next == OPEN_PAREN || next == OPEN_BRACKET {
            return Some(self.open_inline_math_step(cursor, next));
        }
        if next == CLOSE_PAREN || next == CLOSE_BRACKET {
            return Some(self.close_inline_math_step(cursor, next));
        }
        if !is_command_unit(Some(next)) {
            return Some(cursor + 2);
        }
        let mut command_end = cursor + 2;
        while is_command_unit(text.get(command_end).copied()) {
            command_end += 1;
        }
        let command_units = &text[cursor + 1..command_end];
        let command = lossy(command_units);
        if units_eq_str(command_units, "verb")
            || units_eq_str(command_units, "lstinline")
            || units_eq_str(command_units, "mintinline")
        {
            return Some(self.inline_verbatim_step(cursor, command_end, &command));
        }
        self.validate_command_arguments(cursor, command_end, &command);
        if command != "begin" && command != "end" && command != "label" {
            return Some(command_end);
        }
        Some(self.structural_command_step(cursor, command_end, &command))
    }

    fn step(&mut self, cursor: usize) -> Option<usize> {
        match self.text[cursor] {
            PERCENT => self.comment_step(cursor),
            OPEN_BRACE => {
                self.braces.push((cursor, cursor + 1));
                Some(cursor + 1)
            }
            CLOSE_BRACE => Some(self.close_brace_step(cursor)),
            DOLLAR => Some(self.dollar_math_step(cursor)),
            BACKSLASH => self.backslash_step(cursor),
            _ => Some(cursor + 1),
        }
    }

    fn report_unclosed_tokens(&mut self) {
        for &(from, to) in &self.braces {
            self.diagnostics
                .push(error(from, to, msg!("latex.lint.unclosedOpeningBrace")));
        }
        for open in &self.math {
            self.diagnostics.push(error(
                open.from,
                open.to,
                msg!(
                    "latex.lint.unclosedMathDelimiter",
                    "delimiter" => open.delimiter.text(),
                    "expected" => open.delimiter.closing()
                ),
            ));
        }
        for open in &self.environments {
            self.diagnostics.push(error(
                open.from,
                open.to,
                msg!("latex.lint.unclosedEnvironment", "environment" => format!("\\begin{{{}}}", open.name)),
            ));
        }
    }
}

pub fn lint_latex_text(text: &SourceText) -> Vec<LintDiagnostic> {
    let mut scan = Scan {
        text: text.units(),
        diagnostics: Vec::new(),
        braces: Vec::new(),
        environments: Vec::new(),
        math: Vec::new(),
        labels: HashMap::new(),
        disabled: false,
    };
    let mut cursor = 0;
    while cursor < scan.text.len() {
        match scan.step(cursor) {
            Some(next) => cursor = next,
            None => break,
        }
    }
    if scan.disabled {
        return Vec::new();
    }
    scan.report_unclosed_tokens();
    let mut diagnostics = scan.diagnostics;
    diagnostics.sort_by(compare);
    diagnostics
}

#[cfg(test)]
mod tests {
    use super::*;

    fn keys(text: &str) -> Vec<(usize, usize, String)> {
        lint_latex_text(&SourceText::new(text.to_string()))
            .into_iter()
            .map(|d| (d.from, d.to, d.key().unwrap_or("").to_string()))
            .collect()
    }

    #[test]
    fn diagnostics_cover_at_least_one_unit() {
        assert_eq!(
            keys("}"),
            vec![(0, 1, "latex.lint.unmatchedClosingBrace".to_string())]
        );
    }

    #[test]
    fn environments_and_math_must_balance() {
        let found = keys("\\begin{a}\\begin{b}\\end{a} $x \\]");
        let names: Vec<&str> = found.iter().map(|(_, _, key)| key.as_str()).collect();
        assert!(names.contains(&"latex.lint.mismatchedEnvironment"));
        assert!(names.contains(&"latex.lint.unclosedEnvironment"));
        assert!(names.contains(&"latex.lint.mismatchedMathDelimiter"));
        assert!(names.contains(&"latex.lint.unclosedMathDelimiter"));
    }

    #[test]
    fn novalidate_disables_the_file() {
        assert!(keys("% novalidate\n}").is_empty());
    }

    #[test]
    fn an_emoji_before_an_unmatched_brace_shifts_by_two_units() {
        assert_eq!(keys("😀}")[0].0, 2);
    }
}
