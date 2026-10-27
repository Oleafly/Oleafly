//! Typst function forms: the `[tool.oleafly]` schema a template author writes
//! in a package's `typst.toml` or in a project's `oleafly-forms.toml`, checked
//! and turned into the catalog Visual mode reads. Nothing else interprets the
//! schema: the desktop reads the files, and the editor gets the catalog as JSON.

use std::collections::HashSet;
use std::ops::Range;

use serde::Serialize;
use toml_edit::{Document, Item, Key, TableLike, Value};

#[cfg(test)]
mod tests;

/// The project's own forms file, at the project root.
pub const PROJECT_FORMS_FILE: &str = "oleafly-forms.toml";
/// The largest forms file that is read. The size is checked before reading.
pub const MAX_FORMS_FILE_BYTES: u64 = 256 * 1024;

const SCHEMA: i64 = 1;
/// Names Visual mode's built-in widgets dispatch on. A bare call keeps the widget.
const BUILTIN_NAMES: &[&str] = &[
    "figure",
    "table",
    "image",
    "link",
    "footnote",
    "cite",
    "ref",
    "underline",
    "strike",
    "overline",
    "highlight",
    "smallcaps",
    "emph",
    "strong",
    "sub",
    "super",
    "text",
    "upper",
    "lower",
];
const KEYWORDS: &[&str] = &[
    "none", "auto", "true", "false", "not", "and", "or", "let", "set", "show", "context", "if",
    "else", "for", "in", "while", "break", "continue", "return", "import", "include", "as",
];
const FORM_KEYS: &[&str] = &["module", "function", "label", "summary", "fields"];
const FIELD_KEYS: &[&str] = &["arg", "kind", "label", "help", "placeholder", "required"];
const KIND_KEYS: &[&str] = &[
    "multiline",
    "options",
    "integer",
    "min",
    "max",
    "step",
    "default",
];

/// Where a source's text came from.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SourceOrigin {
    ProjectFile,
    /// A package such as `@local/acme-report:0.1.0`. The caller validates the
    /// spec, or marks the read [`SourceText::InvalidSpec`].
    Package {
        spec: String,
    },
}

impl SourceOrigin {
    fn label(&self) -> &str {
        match self {
            Self::ProjectFile => PROJECT_FORMS_FILE,
            Self::Package { spec } => spec,
        }
    }
}

/// What reading a source produced.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SourceText {
    Missing,
    TooLarge(u64),
    Unreadable(String),
    /// The requested package spec isn't one, so nothing was looked up.
    InvalidSpec,
    Text(String),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SourceRead {
    pub origin: SourceOrigin,
    /// The project-relative path, with `/` separators, whose change should
    /// reload the catalog.
    pub watch: Option<String>,
    pub text: SourceText,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormCatalog {
    /// blake3 over every source's origin, watch path and text, in hex.
    pub version: String,
    pub watch: Vec<String>,
    pub forms: Vec<FormDefinition>,
    pub diagnostics: Vec<FormDiagnostic>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormDefinition {
    /// `pkg:<spec>#<function>` or `mod:<path>#<function>`.
    pub id: String,
    pub function: String,
    pub binding: FormBinding,
    /// The author's label, or `function` when there is none.
    pub label: String,
    pub summary: Option<ArgRef>,
    pub fields: Vec<FormField>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum FormBinding {
    Package { spec: String },
    Module { path: String },
}

/// A named argument, or a positional one counted from 0 in Typst order, where
/// trailing `[..]` blocks count as positional arguments.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ArgRef {
    Named(String),
    Positional(u32),
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormField {
    pub arg: ArgRef,
    pub label: String,
    pub help: Option<String>,
    pub placeholder: Option<String>,
    pub required: bool,
    pub kind: FieldKind,
}

/// A field's control. Every `default` is display-only and never written.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum FieldKind {
    Text {
        multiline: bool,
        default: Option<String>,
    },
    Content,
    Choice {
        options: Vec<ChoiceOption>,
        default: Option<String>,
    },
    Number {
        integer: bool,
        min: Option<f64>,
        max: Option<f64>,
        step: Option<f64>,
        default: Option<f64>,
    },
    Toggle {
        default: Option<bool>,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ChoiceOption {
    pub value: String,
    pub label: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Severity {
    Error,
    Warning,
}

/// Why a diagnostic was raised. The two warnings keep what they point at.
/// Every error drops the form it is in, or the whole source for the codes
/// about the file itself.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DiagnosticCode {
    /// The text isn't valid TOML.
    ParseError,
    /// `[tool.oleafly]` has no `schema`, or the project file has no `[tool.oleafly]`.
    SchemaMissing,
    /// `schema` is something other than `1`.
    SchemaVersion,
    FileTooLarge,
    /// The file exists but couldn't be read as UTF-8 text.
    Unreadable,
    /// A requested package isn't written `@namespace/name:x.y.z`.
    InvalidPackageSpec,
    /// A key the schema requires is absent.
    MissingKey,
    /// A key the schema doesn't know, or one for another field kind. Ignored.
    UnknownKey,
    /// A value of the wrong type, a blank label, an empty list, a repeated
    /// option, or a number that breaks its field's rules.
    InvalidValue,
    /// `function` isn't one Typst identifier.
    InvalidFunction,
    /// `function` is a name the built-in widgets dispatch on. Kept.
    BuiltinName,
    /// A second form for the same function (and module). The first is kept.
    DuplicateFunction,
    ModuleRequired,
    ModuleNotAllowed,
    InvalidModulePath,
    /// `arg` or `summary` is neither an argument name nor a position, or
    /// `summary` names no field of the form.
    InvalidArg,
    /// Two fields of one form bind the same argument.
    DuplicateArg,
    UnknownKind,
}

impl DiagnosticCode {
    fn severity(self) -> Severity {
        match self {
            Self::UnknownKey | Self::BuiltinName => Severity::Warning,
            _ => Severity::Error,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormDiagnostic {
    /// `oleafly-forms.toml`, or the package spec.
    pub source: String,
    pub severity: Severity,
    pub code: DiagnosticCode,
    /// The TOML key path, such as `tool.oleafly.forms[2].fields[0].kind`.
    pub path: String,
    /// 1-based: the value at fault, or the table a missing key belongs in.
    pub line: Option<u32>,
    pub detail: String,
}

/// The forms in a package's `typst.toml`, under `[tool.oleafly]`. A manifest
/// without that section has none and no diagnostics.
pub fn parse_package_forms(text: &str, spec: &str) -> (Vec<FormDefinition>, Vec<FormDiagnostic>) {
    parse(text, Scope::Package(spec))
}

/// The forms in the project's `oleafly-forms.toml`.
pub fn parse_project_forms(text: &str) -> (Vec<FormDefinition>, Vec<FormDiagnostic>) {
    parse(text, Scope::Project)
}

/// Every source's forms and diagnostics, in the order given. A source that
/// couldn't be read gets one diagnostic, and a missing one none.
pub fn assemble_catalog(sources: Vec<SourceRead>) -> FormCatalog {
    let mut hasher = blake3::Hasher::new();
    let mut catalog = FormCatalog {
        version: String::new(),
        watch: Vec::new(),
        forms: Vec::new(),
        diagnostics: Vec::new(),
    };
    for SourceRead {
        origin,
        watch,
        text,
    } in sources
    {
        hash_source(&mut hasher, &origin, watch.as_deref(), &text);
        if let Some(path) = watch {
            if !catalog.watch.contains(&path) {
                catalog.watch.push(path);
            }
        }
        let source = origin.label();
        let (code, detail) = match text {
            SourceText::Missing => continue,
            SourceText::Text(text) => {
                let (forms, diagnostics) = match &origin {
                    SourceOrigin::ProjectFile => parse_project_forms(&text),
                    SourceOrigin::Package { spec } => parse_package_forms(&text, spec),
                };
                catalog.forms.extend(forms);
                catalog.diagnostics.extend(diagnostics);
                continue;
            }
            SourceText::TooLarge(size) => (
                DiagnosticCode::FileTooLarge,
                format!(
                    "The file is {size} bytes. Forms are read from files of at most \
                     {MAX_FORMS_FILE_BYTES} bytes (256 KiB)."
                ),
            ),
            SourceText::Unreadable(reason) => (
                DiagnosticCode::Unreadable,
                format!("The file could not be read: {reason}"),
            ),
            SourceText::InvalidSpec => (
                DiagnosticCode::InvalidPackageSpec,
                format!(
                    "\"{source}\" is not a package such as @preview/name:1.0.0, so it was skipped."
                ),
            ),
        };
        catalog.diagnostics.push(FormDiagnostic {
            source: source.to_owned(),
            severity: code.severity(),
            code,
            path: String::new(),
            line: None,
            detail,
        });
    }
    catalog.version = hasher.finalize().to_hex().to_string();
    catalog
}

fn hash_source(
    hasher: &mut blake3::Hasher,
    origin: &SourceOrigin,
    watch: Option<&str>,
    text: &SourceText,
) {
    let mut part = |bytes: &[u8]| {
        hasher.update(&(bytes.len() as u64).to_le_bytes());
        hasher.update(bytes);
    };
    match origin {
        SourceOrigin::ProjectFile => part(b"project"),
        SourceOrigin::Package { spec } => {
            part(b"package");
            part(spec.as_bytes());
        }
    }
    match watch {
        Some(path) => {
            part(b"watch");
            part(path.as_bytes());
        }
        None => part(b"unwatched"),
    }
    match text {
        SourceText::Missing => part(b"missing"),
        SourceText::TooLarge(size) => {
            part(b"too-large");
            part(&size.to_le_bytes());
        }
        SourceText::Unreadable(reason) => {
            part(b"unreadable");
            part(reason.as_bytes());
        }
        SourceText::InvalidSpec => part(b"invalid-spec"),
        SourceText::Text(text) => {
            part(b"text");
            part(text.as_bytes());
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Scope<'a> {
    Package(&'a str),
    Project,
}

/// A table as written, `[header]` or inline, with the offset its own line is
/// reported from (the nearest enclosing table's when it has no span).
#[derive(Clone, Copy)]
struct Node<'a> {
    table: &'a dyn TableLike,
    at: Option<usize>,
}

impl<'a> Node<'a> {
    fn slot(&self, path: &str, key: &'static str) -> Option<Slot<'a>> {
        let item = self.table.get(key)?;
        Some(Slot {
            key,
            value: item.as_value(),
            type_name: item.type_name(),
            path: join(path, key),
            at: start(item.span()).or(self.at),
        })
    }
}

/// One value under check, named the way its diagnostics name it.
struct Slot<'a> {
    key: &'static str,
    value: Option<&'a Value>,
    type_name: &'static str,
    path: String,
    at: Option<usize>,
}

enum Element<'a> {
    Table(Node<'a>),
    Value(&'a Value),
}

/// The entries of an array, whichever way TOML wrote it: `[[header]]` tables,
/// or `[..]` with inline tables. `None` when `item` isn't an array.
fn elements(item: &Item, parent: Option<usize>) -> Option<Vec<Element<'_>>> {
    if let Some(tables) = item.as_array_of_tables() {
        return Some(
            tables
                .iter()
                .map(|table| {
                    Element::Table(Node {
                        table,
                        at: start(table.span()).or(parent),
                    })
                })
                .collect(),
        );
    }
    Some(
        item.as_array()?
            .iter()
            .map(|value| match value.as_inline_table() {
                Some(table) => Element::Table(Node {
                    table,
                    at: start(table.span()).or(parent),
                }),
                None => Element::Value(value),
            })
            .collect(),
    )
}

fn start(span: Option<Range<usize>>) -> Option<usize> {
    span.map(|span| span.start)
}

fn join(path: &str, key: &str) -> String {
    if path.is_empty() {
        key.to_owned()
    } else {
        format!("{path}.{key}")
    }
}

fn article(type_name: &str) -> String {
    let vowel = type_name.starts_with(['a', 'e', 'i', 'o', 'u']);
    format!("{} {type_name}", if vowel { "an" } else { "a" })
}

fn describe(arg: &ArgRef) -> String {
    match arg {
        ArgRef::Named(name) => format!("the argument {name}"),
        ArgRef::Positional(index) => format!("positional argument {index}"),
    }
}

/// One Typst identifier: hyphens allowed, no dots, not a keyword.
fn is_identifier(name: &str) -> bool {
    let mut characters = name.chars();
    characters
        .next()
        .is_some_and(|first| first.is_alphabetic() || first == '_')
        && characters
            .all(|character| character.is_alphanumeric() || character == '_' || character == '-')
        && !KEYWORDS.contains(&name)
}

fn module_path_problem(path: &str) -> Option<&'static str> {
    if path.is_empty() {
        Some("is empty.")
    } else if path.contains('\\') {
        Some("uses a backslash. Separate folders with /.")
    } else if path.starts_with('/') {
        Some("starts with /. Write it relative to the project folder.")
    } else if path.split('/').any(|part| part == "..") {
        Some("leaves the project folder through \"..\".")
    } else if path.split('/').any(|part| part.is_empty() || part == ".") {
        Some("has an empty or \".\" folder name.")
    } else {
        None
    }
}

fn parse(text: &str, scope: Scope<'_>) -> (Vec<FormDefinition>, Vec<FormDiagnostic>) {
    let source = match scope {
        Scope::Package(spec) => spec,
        Scope::Project => PROJECT_FORMS_FILE,
    };
    let mut checker = Checker {
        source,
        line_starts: std::iter::once(0)
            .chain(memchr::memchr_iter(b'\n', text.as_bytes()).map(|index| index + 1))
            .collect(),
        diagnostics: Vec::new(),
        errors: 0,
    };
    let forms = checker.document(text, scope);
    (forms, checker.diagnostics)
}

struct Checker<'s> {
    source: &'s str,
    line_starts: Vec<usize>,
    diagnostics: Vec<FormDiagnostic>,
    errors: usize,
}

impl Checker<'_> {
    fn report(&mut self, code: DiagnosticCode, path: &str, at: Option<usize>, detail: String) {
        if code.severity() == Severity::Error {
            self.errors += 1;
        }
        let line = at.map(|at| {
            u32::try_from(self.line_starts.partition_point(|start| *start <= at))
                .unwrap_or(u32::MAX)
        });
        self.diagnostics.push(FormDiagnostic {
            source: self.source.to_owned(),
            severity: code.severity(),
            code,
            path: path.to_owned(),
            line,
            detail,
        });
    }

    fn fault(&mut self, code: DiagnosticCode, slot: &Slot<'_>, detail: String) {
        self.report(code, &slot.path, slot.at, detail);
    }

    fn document(&mut self, text: &str, scope: Scope<'_>) -> Vec<FormDefinition> {
        let document = match Document::parse(text) {
            Ok(document) => document,
            Err(error) => {
                let message = error.message().split_whitespace().collect::<Vec<_>>();
                self.report(
                    DiagnosticCode::ParseError,
                    "",
                    start(error.span()),
                    format!(
                        "This is not valid TOML: {}.",
                        message.join(" ").trim_end_matches('.')
                    ),
                );
                return Vec::new();
            }
        };
        let path = "tool.oleafly";
        let Some(item) = document.get("tool").and_then(|tool| tool.get("oleafly")) else {
            if scope == Scope::Project {
                self.report(
                    DiagnosticCode::SchemaMissing,
                    "tool.oleafly.schema",
                    None,
                    "The file needs a [tool.oleafly] table with schema = 1.".into(),
                );
            }
            return Vec::new();
        };
        let at = start(item.span());
        let Some(table) = item.as_table_like() else {
            self.report(
                DiagnosticCode::InvalidValue,
                path,
                at,
                format!(
                    "tool.oleafly must be a table, not {}.",
                    article(item.type_name())
                ),
            );
            return Vec::new();
        };
        let node = Node { table, at };
        if !self.schema(node, path) {
            return Vec::new();
        }
        self.unknown_keys(node, path, |key| matches!(key, "schema" | "forms"), None);
        let Some(forms) = node.table.get("forms") else {
            return Vec::new();
        };
        let forms_path = join(path, "forms");
        let forms_at = start(forms.span()).or(at);
        let Some(elements) = elements(forms, forms_at) else {
            self.report(
                DiagnosticCode::InvalidValue,
                &forms_path,
                forms_at,
                "forms must be a list of tables, written [[tool.oleafly.forms]].".into(),
            );
            return Vec::new();
        };
        let mut seen = HashSet::new();
        let mut definitions = Vec::new();
        for (index, element) in elements.into_iter().enumerate() {
            let path = format!("{forms_path}[{index}]");
            match element {
                Element::Table(node) => {
                    definitions.extend(self.form(node, &path, scope, &mut seen));
                }
                Element::Value(value) => self.report(
                    DiagnosticCode::InvalidValue,
                    &path,
                    start(value.span()).or(forms_at),
                    format!(
                        "Each form must be a table, not {}.",
                        article(value.type_name())
                    ),
                ),
            }
        }
        definitions
    }

    fn schema(&mut self, node: Node<'_>, path: &str) -> bool {
        let Some(slot) = node.slot(path, "schema") else {
            self.report(
                DiagnosticCode::SchemaMissing,
                &join(path, "schema"),
                node.at,
                "Add schema = 1 to [tool.oleafly].".into(),
            );
            return false;
        };
        let detail = match slot.value.and_then(Value::as_integer) {
            Some(SCHEMA) => return true,
            Some(other) => {
                format!("Schema {other} is not supported. This version of Oleafly reads schema 1.")
            }
            None => format!(
                "schema must be the number 1, not {}.",
                article(slot.type_name)
            ),
        };
        self.fault(DiagnosticCode::SchemaVersion, &slot, detail);
        false
    }

    fn form(
        &mut self,
        node: Node<'_>,
        path: &str,
        scope: Scope<'_>,
        seen: &mut HashSet<(Option<String>, String)>,
    ) -> Option<FormDefinition> {
        let errors = self.errors;
        self.unknown_keys(node, path, |key| FORM_KEYS.contains(&key), None);
        let module = self.module(node, path, scope);
        let function = self.function(node, path);
        if let Some((function, slot)) = &function {
            let identity = match scope {
                Scope::Package(_) => Some((None, function.clone())),
                Scope::Project => module
                    .clone()
                    .map(|module| (Some(module), function.clone())),
            };
            if identity.is_some_and(|identity| !seen.insert(identity)) {
                let what = match &module {
                    Some(module) => format!("{function} from {module}"),
                    None => function.clone(),
                };
                self.fault(
                    DiagnosticCode::DuplicateFunction,
                    slot,
                    format!("{what} already has a form earlier in this file, and the first one is used."),
                );
            }
        }
        let label = node.slot(path, "label").and_then(|slot| self.label(&slot));
        let summary = node
            .slot(path, "summary")
            .and_then(|slot| Some((self.arg(&slot)?, slot)));
        let fields = self.fields(node, path);
        if let (Some((summary, slot)), Some(fields)) = (&summary, &fields) {
            if !fields.iter().any(|field| field.arg == *summary) {
                self.fault(
                    DiagnosticCode::InvalidArg,
                    slot,
                    format!(
                        "summary names {}, which is not one of this form's fields.",
                        describe(summary)
                    ),
                );
            }
        }
        if self.errors > errors {
            return None;
        }
        let (function, _) = function?;
        let binding = match scope {
            Scope::Package(spec) => FormBinding::Package {
                spec: spec.to_owned(),
            },
            Scope::Project => FormBinding::Module { path: module? },
        };
        let id = match &binding {
            FormBinding::Package { spec } => format!("pkg:{spec}#{function}"),
            FormBinding::Module { path } => format!("mod:{path}#{function}"),
        };
        Some(FormDefinition {
            id,
            label: label.unwrap_or_else(|| function.clone()),
            function,
            binding,
            summary: summary.map(|(summary, _)| summary),
            fields: fields?,
        })
    }

    fn module(&mut self, node: Node<'_>, path: &str, scope: Scope<'_>) -> Option<String> {
        let slot = node.slot(path, "module");
        match (scope, slot) {
            (Scope::Package(_), None) => None,
            (Scope::Package(_), Some(slot)) => {
                self.fault(
                    DiagnosticCode::ModuleNotAllowed,
                    &slot,
                    "module belongs in oleafly-forms.toml. A package's forms are for the package's own functions.".into(),
                );
                None
            }
            (Scope::Project, None) => {
                self.report(
                    DiagnosticCode::ModuleRequired,
                    &join(path, "module"),
                    node.at,
                    "Each form here needs module, the project path of the .typ file that defines the function.".into(),
                );
                None
            }
            (Scope::Project, Some(slot)) => {
                let module = self.string(&slot)?;
                let Some(problem) = module_path_problem(&module) else {
                    return Some(module);
                };
                self.fault(
                    DiagnosticCode::InvalidModulePath,
                    &slot,
                    format!("module \"{module}\" {problem}"),
                );
                None
            }
        }
    }

    fn function<'t>(&mut self, node: Node<'t>, path: &str) -> Option<(String, Slot<'t>)> {
        let slot = self.required(node, path, "function")?;
        let function = self.string(&slot)?;
        if !is_identifier(&function) {
            self.fault(
                DiagnosticCode::InvalidFunction,
                &slot,
                format!("\"{function}\" is not a Typst function name. Use one name, such as info-box, with no dots or spaces."),
            );
            return None;
        }
        if BUILTIN_NAMES.contains(&function.as_str()) {
            self.fault(
                DiagnosticCode::BuiltinName,
                &slot,
                format!("\"{function}\" is a built-in Typst name. Bare calls keep the built-in widget, so only qualified or renamed calls use this form."),
            );
        }
        Some((function, slot))
    }

    fn fields(&mut self, node: Node<'_>, path: &str) -> Option<Vec<FormField>> {
        let slot = self.required(node, path, "fields")?;
        let item = node.table.get("fields")?;
        let Some(elements) = elements(item, slot.at) else {
            self.fault(
                DiagnosticCode::InvalidValue,
                &slot,
                format!(
                    "fields must be a list of tables, not {}.",
                    article(slot.type_name)
                ),
            );
            return None;
        };
        if elements.is_empty() {
            self.fault(
                DiagnosticCode::InvalidValue,
                &slot,
                "A form needs at least one field.".into(),
            );
            return None;
        }
        let errors = self.errors;
        let mut args = HashSet::new();
        let mut fields = Vec::new();
        for (index, element) in elements.into_iter().enumerate() {
            let path = format!("{}[{index}]", slot.path);
            match element {
                Element::Table(node) => fields.extend(self.field(node, &path, &mut args)),
                Element::Value(value) => self.report(
                    DiagnosticCode::InvalidValue,
                    &path,
                    start(value.span()).or(slot.at),
                    format!(
                        "Each field must be a table, not {}.",
                        article(value.type_name())
                    ),
                ),
            }
        }
        (self.errors == errors).then_some(fields)
    }

    fn field(
        &mut self,
        node: Node<'_>,
        path: &str,
        args: &mut HashSet<ArgRef>,
    ) -> Option<FormField> {
        let errors = self.errors;
        let arg = self.required(node, path, "arg").and_then(|slot| {
            let arg = self.arg(&slot)?;
            if args.insert(arg.clone()) {
                return Some(arg);
            }
            self.fault(
                DiagnosticCode::DuplicateArg,
                &slot,
                format!(
                    "Another field of this form already binds {}.",
                    describe(&arg)
                ),
            );
            None
        });
        let kind = self
            .required(node, path, "kind")
            .and_then(|slot| self.kind_name(&slot));
        let label = self
            .required(node, path, "label")
            .and_then(|slot| self.label(&slot));
        let help = node.slot(path, "help").and_then(|slot| self.string(&slot));
        let placeholder = node
            .slot(path, "placeholder")
            .and_then(|slot| self.string(&slot));
        let required = self.flag(node, path, "required");
        let kind = kind.and_then(|kind| self.kind(node, path, kind));
        if self.errors > errors {
            return None;
        }
        Some(FormField {
            arg: arg?,
            label: label?,
            help,
            placeholder,
            required,
            kind: kind?,
        })
    }

    fn kind_name(&mut self, slot: &Slot<'_>) -> Option<&'static str> {
        let name = self.string(slot)?;
        let kind = ["text", "content", "choice", "number", "toggle"]
            .into_iter()
            .find(|kind| *kind == name);
        if kind.is_none() {
            self.fault(
                DiagnosticCode::UnknownKind,
                slot,
                format!(
                    "\"{name}\" is not a field kind. Use text, content, choice, number or toggle."
                ),
            );
        }
        kind
    }

    fn kind(&mut self, node: Node<'_>, path: &str, kind: &'static str) -> Option<FieldKind> {
        let own: &[&str] = match kind {
            "text" => &["multiline", "default"],
            "choice" => &["options", "default"],
            "number" => &["integer", "min", "max", "step", "default"],
            "toggle" => &["default"],
            _ => &[],
        };
        self.unknown_keys(
            node,
            path,
            |key| FIELD_KEYS.contains(&key) || own.contains(&key),
            Some(kind),
        );
        let default = node.slot(path, "default");
        Some(match kind {
            "text" => FieldKind::Text {
                multiline: self.flag(node, path, "multiline"),
                default: default.and_then(|slot| self.string(&slot)),
            },
            "choice" => {
                let options = self.options(node, path)?;
                let default = default.and_then(|slot| {
                    let value = self.string(&slot)?;
                    if options.iter().any(|option| option.value == value) {
                        return Some(value);
                    }
                    self.fault(
                        DiagnosticCode::InvalidValue,
                        &slot,
                        format!("default \"{value}\" is not one of the options."),
                    );
                    None
                });
                FieldKind::Choice { options, default }
            }
            "number" => self.number_kind(node, path, default),
            "toggle" => FieldKind::Toggle {
                default: default.and_then(|slot| self.boolean(&slot)),
            },
            _ => FieldKind::Content,
        })
    }

    fn number_kind(&mut self, node: Node<'_>, path: &str, default: Option<Slot<'_>>) -> FieldKind {
        let integer = self.flag(node, path, "integer");
        let bound = |checker: &mut Self, key| {
            let slot = node.slot(path, key)?;
            Some((checker.number(&slot)?, slot))
        };
        let min = bound(self, "min");
        let max = bound(self, "max");
        let step = bound(self, "step");
        if let (Some((min, _)), Some((max, slot))) = (&min, &max) {
            if max < min {
                self.fault(
                    DiagnosticCode::InvalidValue,
                    slot,
                    format!("max {max} is smaller than min {min}."),
                );
            }
        }
        if let Some((step, slot)) = &step {
            if *step <= 0.0 {
                self.fault(
                    DiagnosticCode::InvalidValue,
                    slot,
                    "step must be greater than 0.".into(),
                );
            }
        }
        FieldKind::Number {
            integer,
            min: min.map(|(min, _)| min),
            max: max.map(|(max, _)| max),
            step: step.map(|(step, _)| step),
            default: default.and_then(|slot| self.number(&slot)),
        }
    }

    fn options(&mut self, node: Node<'_>, path: &str) -> Option<Vec<ChoiceOption>> {
        let slot = self.required(node, path, "options")?;
        let item = node.table.get("options")?;
        let Some(elements) = elements(item, slot.at) else {
            self.fault(
                DiagnosticCode::InvalidValue,
                &slot,
                format!("options must be a list, not {}.", article(slot.type_name)),
            );
            return None;
        };
        if elements.is_empty() {
            self.fault(
                DiagnosticCode::InvalidValue,
                &slot,
                "A choice field needs at least one option.".into(),
            );
            return None;
        }
        let errors = self.errors;
        let mut values = HashSet::new();
        let mut options = Vec::new();
        for (index, element) in elements.into_iter().enumerate() {
            let path = format!("{}[{index}]", slot.path);
            let (option, at) = match element {
                Element::Table(node) => (self.option(node, &path), node.at),
                Element::Value(value) => {
                    let entry = Slot {
                        key: "option",
                        value: Some(value),
                        type_name: value.type_name(),
                        path: path.clone(),
                        at: start(value.span()).or(slot.at),
                    };
                    let option = if value.is_str() {
                        self.label(&entry).map(|value| ChoiceOption {
                            label: value.clone(),
                            value,
                        })
                    } else {
                        self.fault(
                            DiagnosticCode::InvalidValue,
                            &entry,
                            format!(
                                "Each option must be a string or a {{ value, label }} table, not {}.",
                                article(entry.type_name)
                            ),
                        );
                        None
                    };
                    (option, entry.at)
                }
            };
            let Some(option) = option else {
                continue;
            };
            if values.insert(option.value.clone()) {
                options.push(option);
            } else {
                self.report(
                    DiagnosticCode::InvalidValue,
                    &path,
                    at,
                    format!("The option \"{}\" is listed twice.", option.value),
                );
            }
        }
        (self.errors == errors).then_some(options)
    }

    fn option(&mut self, node: Node<'_>, path: &str) -> Option<ChoiceOption> {
        self.unknown_keys(node, path, |key| matches!(key, "value" | "label"), None);
        let value = self
            .required(node, path, "value")
            .and_then(|slot| self.string(&slot));
        let label = self
            .required(node, path, "label")
            .and_then(|slot| self.label(&slot));
        Some(ChoiceOption {
            value: value?,
            label: label?,
        })
    }

    fn arg(&mut self, slot: &Slot<'_>) -> Option<ArgRef> {
        let arg = match slot.value {
            Some(Value::String(name)) if is_identifier(name.value()) => {
                Some(ArgRef::Named(name.value().clone()))
            }
            Some(Value::Integer(index)) => {
                u32::try_from(*index.value()).ok().map(ArgRef::Positional)
            }
            _ => None,
        };
        if arg.is_none() {
            self.fault(
                DiagnosticCode::InvalidArg,
                slot,
                format!(
                    "{} must be an argument name, such as \"title\", or a position counted from 0.",
                    slot.key
                ),
            );
        }
        arg
    }

    fn required<'t>(&mut self, node: Node<'t>, path: &str, key: &'static str) -> Option<Slot<'t>> {
        let slot = node.slot(path, key);
        if slot.is_none() {
            self.report(
                DiagnosticCode::MissingKey,
                &join(path, key),
                node.at,
                format!("{key} is required."),
            );
        }
        slot
    }

    fn unknown_keys(
        &mut self,
        node: Node<'_>,
        path: &str,
        known: impl Fn(&str) -> bool,
        kind: Option<&str>,
    ) {
        for (key, item) in node.table.iter() {
            if known(key) {
                continue;
            }
            let at = start(node.table.key(key).and_then(Key::span))
                .or(start(item.span()))
                .or(node.at);
            let detail = match kind {
                Some(kind) if KIND_KEYS.contains(&key) => {
                    format!("{key} does not apply to {kind} fields, so it is ignored.")
                }
                _ => format!("{key} is not a forms key, so it is ignored."),
            };
            self.report(DiagnosticCode::UnknownKey, &join(path, key), at, detail);
        }
    }

    fn flag(&mut self, node: Node<'_>, path: &str, key: &'static str) -> bool {
        node.slot(path, key)
            .and_then(|slot| self.boolean(&slot))
            .unwrap_or(false)
    }

    fn label(&mut self, slot: &Slot<'_>) -> Option<String> {
        let label = self.string(slot)?;
        if !label.trim().is_empty() {
            return Some(label);
        }
        self.fault(
            DiagnosticCode::InvalidValue,
            slot,
            format!("{} must not be blank.", slot.key),
        );
        None
    }

    fn number(&mut self, slot: &Slot<'_>) -> Option<f64> {
        let number = self.cast(slot, "a number", |value| match value {
            Value::Integer(integer) => Some(*integer.value() as f64),
            Value::Float(float) => Some(*float.value()),
            _ => None,
        })?;
        if number.is_finite() {
            return Some(number);
        }
        self.fault(
            DiagnosticCode::InvalidValue,
            slot,
            format!("{} must be a finite number.", slot.key),
        );
        None
    }

    fn string(&mut self, slot: &Slot<'_>) -> Option<String> {
        self.cast(slot, "a string", |value| value.as_str().map(str::to_owned))
    }

    fn boolean(&mut self, slot: &Slot<'_>) -> Option<bool> {
        self.cast(slot, "true or false", Value::as_bool)
    }

    fn cast<T>(
        &mut self,
        slot: &Slot<'_>,
        expected: &str,
        cast: impl FnOnce(&Value) -> Option<T>,
    ) -> Option<T> {
        let value = slot.value.and_then(cast);
        if value.is_none() {
            self.fault(
                DiagnosticCode::InvalidValue,
                slot,
                format!(
                    "{} must be {expected}, not {}.",
                    slot.key,
                    article(slot.type_name)
                ),
            );
        }
        value
    }
}
