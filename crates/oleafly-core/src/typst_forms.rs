use std::collections::HashSet;
use std::ops::Range;

use serde::Serialize;
use toml_edit::{Document, Item, Key, TableLike, Value};

#[cfg(test)]
mod tests;

pub const PROJECT_FORMS_FILE: &str = "oleafly-forms.toml";
pub const MAX_FORMS_FILE_BYTES: u64 = 256 * 1024;

const SCHEMA: i64 = 1;
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

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SourceOrigin {
    ProjectFile,
    Package { spec: String },
}

impl SourceOrigin {
    fn label(&self) -> &str {
        match self {
            Self::ProjectFile => PROJECT_FORMS_FILE,
            Self::Package { spec } => spec,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SourceText {
    Missing,
    TooLarge(u64),
    Unreadable(String),
    NotUtf8,
    InvalidSpec,
    Text(String),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SourceRead {
    pub origin: SourceOrigin,
    pub watch: Option<String>,
    pub text: SourceText,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormCatalog {
    pub version: String,
    pub watch: Vec<String>,
    pub forms: Vec<FormDefinition>,
    pub diagnostics: Vec<FormDiagnostic>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormDefinition {
    pub id: String,
    pub function: String,
    pub binding: FormBinding,
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

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DiagnosticCode {
    ParseError,
    SchemaMissing,
    SchemaVersion,
    FileTooLarge,
    Unreadable,
    /// A requested package isn't written `@namespace/name:x.y.z`.
    InvalidPackageSpec,
    MissingKey,
    UnknownKey,
    InvalidValue,
    InvalidFunction,
    BuiltinName,
    DuplicateFunction,
    ModuleRequired,
    ModuleNotAllowed,
    InvalidModulePath,
    InvalidArg,
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
    pub source: String,
    pub severity: Severity,
    pub code: DiagnosticCode,
    pub path: String,
    pub line: Option<u32>,
    pub message: DiagnosticMessage,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ValueType {
    String,
    Integer,
    Float,
    Boolean,
    Datetime,
    Array,
    InlineTable,
    Table,
    ArrayOfTables,
    None,
}

impl ValueType {
    fn of_item(item: &Item) -> Self {
        match item {
            Item::None => Self::None,
            Item::Value(value) => Self::of_value(value),
            Item::Table(_) => Self::Table,
            Item::ArrayOfTables(_) => Self::ArrayOfTables,
        }
    }

    fn of_value(value: &Value) -> Self {
        match value {
            Value::String(_) => Self::String,
            Value::Integer(_) => Self::Integer,
            Value::Float(_) => Self::Float,
            Value::Boolean(_) => Self::Boolean,
            Value::Datetime(_) => Self::Datetime,
            Value::Array(_) => Self::Array,
            Value::InlineTable(_) => Self::InlineTable,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "id", rename_all = "camelCase")]
pub enum DiagnosticMessage {
    FileTooLarge { size: u64, limit: u64 },
    Unreadable { reason: String },
    NotUtf8,
    InvalidPackageSpec { spec: String },
    NotToml { error: String },
    NotToml10 { error: String },
    NoOleaflyTable,
    OleaflyNotTable { found: ValueType },
    FormsNotList,
    FormNotTable { found: ValueType },
    NoSchema,
    SchemaUnsupported { schema: i64 },
    SchemaNotNumber { found: ValueType },
    SummaryNotAField { arg: ArgRef },
    DuplicateFunction { function: String },
    DuplicateModuleFunction { function: String, module: String },
    ModuleNotAllowed,
    ModuleRequired,
    ModulePathEmpty { module: String },
    ModulePathPackage { module: String },
    ModulePathBackslash { module: String },
    ModulePathAbsolute { module: String },
    ModulePathParent { module: String },
    ModulePathEmptyFolder { module: String },
    InvalidFunction { function: String },
    BuiltinName { function: String },
    FieldsNotList { found: ValueType },
    NoFields,
    FieldNotTable { found: ValueType },
    DuplicateArg { arg: ArgRef },
    UnknownKind { kind: String },
    DefaultNotOption { value: String },
    MaxBelowMin { min: String, max: String },
    StepNotPositive,
    OptionsNotList { found: ValueType },
    NoOptions,
    OptionNotStringOrTable { found: ValueType },
    DuplicateOption { value: String },
    NotArg { key: String },
    MissingKey { key: String },
    KeyNotForKind { key: String, kind: String },
    UnknownKey { key: String },
    Blank { key: String },
    NotFinite { key: String },
    NotString { key: String, found: ValueType },
    NotNumber { key: String, found: ValueType },
    NotBoolean { key: String, found: ValueType },
}

pub fn parse_package_forms(text: &str, spec: &str) -> (Vec<FormDefinition>, Vec<FormDiagnostic>) {
    parse(text, Scope::Package(spec))
}

pub fn parse_project_forms(text: &str) -> (Vec<FormDefinition>, Vec<FormDiagnostic>) {
    parse(text, Scope::Project)
}

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
        let (code, message) = match text {
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
                DiagnosticMessage::FileTooLarge {
                    size,
                    limit: MAX_FORMS_FILE_BYTES,
                },
            ),
            SourceText::Unreadable(reason) => (
                DiagnosticCode::Unreadable,
                DiagnosticMessage::Unreadable { reason },
            ),
            SourceText::NotUtf8 => (DiagnosticCode::Unreadable, DiagnosticMessage::NotUtf8),
            SourceText::InvalidSpec => (
                DiagnosticCode::InvalidPackageSpec,
                DiagnosticMessage::InvalidPackageSpec {
                    spec: source.to_owned(),
                },
            ),
        };
        catalog.diagnostics.push(FormDiagnostic {
            source: source.to_owned(),
            severity: code.severity(),
            code,
            path: String::new(),
            line: None,
            message,
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
        SourceText::NotUtf8 => part(b"not-utf8"),
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
            found: ValueType::of_item(item),
            path: join(path, key),
            at: start(item.span()).or(self.at),
        })
    }
}

struct Slot<'a> {
    key: &'static str,
    value: Option<&'a Value>,
    found: ValueType,
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

/// One Typst identifier, by the lexer's rule: XID_Start or `_`, then
/// XID_Continue, `_` or `-`. No dots, and not a keyword.
fn is_identifier(name: &str) -> bool {
    let mut characters = name.chars();
    characters
        .next()
        .is_some_and(|first| unicode_ident::is_xid_start(first) || first == '_')
        && characters.all(|character| {
            unicode_ident::is_xid_continue(character) || character == '_' || character == '-'
        })
        && !KEYWORDS.contains(&name)
}

fn one_line(message: &str) -> String {
    message
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim_end_matches('.')
        .to_owned()
}

fn module_path_problem(path: &str) -> Option<fn(String) -> DiagnosticMessage> {
    if path.is_empty() {
        Some(|module| DiagnosticMessage::ModulePathEmpty { module })
    } else if path.starts_with('@') {
        // Typst and the editor read any `@` import as a package spec.
        Some(|module| DiagnosticMessage::ModulePathPackage { module })
    } else if path.contains('\\') {
        Some(|module| DiagnosticMessage::ModulePathBackslash { module })
    } else if path.starts_with('/') {
        Some(|module| DiagnosticMessage::ModulePathAbsolute { module })
    } else if path.split('/').any(|part| part == "..") {
        Some(|module| DiagnosticMessage::ModulePathParent { module })
    } else if path.split('/').any(|part| part.is_empty() || part == ".") {
        Some(|module| DiagnosticMessage::ModulePathEmptyFolder { module })
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
    fn report(
        &mut self,
        code: DiagnosticCode,
        path: &str,
        at: Option<usize>,
        message: DiagnosticMessage,
    ) {
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
            message,
        });
    }

    fn fault(&mut self, code: DiagnosticCode, slot: &Slot<'_>, message: DiagnosticMessage) {
        self.report(code, &slot.path, slot.at, message);
    }

    fn document(&mut self, text: &str, scope: Scope<'_>) -> Vec<FormDefinition> {
        let document = match Document::parse(text) {
            Ok(document) => document,
            Err(error) => {
                self.report(
                    DiagnosticCode::ParseError,
                    "",
                    start(error.span()),
                    DiagnosticMessage::NotToml {
                        error: one_line(error.message()),
                    },
                );
                return Vec::new();
            }
        };
        // toml_edit reads TOML 1.1. Typst reads typst.toml with a TOML 1.0
        // parser and refuses the package over, say, a newline or a trailing
        // comma in an inline table, so a manifest has to pass that one too.
        if let Some(error) = matches!(scope, Scope::Package(_))
            .then(|| text.parse::<toml::Table>().err())
            .flatten()
        {
            self.report(
                DiagnosticCode::ParseError,
                "",
                start(error.span()),
                DiagnosticMessage::NotToml10 {
                    error: one_line(error.message()),
                },
            );
            return Vec::new();
        }
        let path = "tool.oleafly";
        let Some(item) = document.get("tool").and_then(|tool| tool.get("oleafly")) else {
            if scope == Scope::Project {
                self.report(
                    DiagnosticCode::SchemaMissing,
                    "tool.oleafly.schema",
                    None,
                    DiagnosticMessage::NoOleaflyTable,
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
                DiagnosticMessage::OleaflyNotTable {
                    found: ValueType::of_item(item),
                },
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
                DiagnosticMessage::FormsNotList,
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
                    DiagnosticMessage::FormNotTable {
                        found: ValueType::of_value(value),
                    },
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
                DiagnosticMessage::NoSchema,
            );
            return false;
        };
        let message = match slot.value.and_then(Value::as_integer) {
            Some(SCHEMA) => return true,
            Some(schema) => DiagnosticMessage::SchemaUnsupported { schema },
            None => DiagnosticMessage::SchemaNotNumber { found: slot.found },
        };
        self.fault(DiagnosticCode::SchemaVersion, &slot, message);
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
                    DiagnosticMessage::SummaryNotAField {
                        arg: summary.clone(),
                    },
                );
            }
        }
        if self.errors > errors {
            return None;
        }
        let (function, slot) = function?;
        if !seen.insert((module.clone(), function.clone())) {
            let message = match &module {
                Some(module) => DiagnosticMessage::DuplicateModuleFunction {
                    function: function.clone(),
                    module: module.clone(),
                },
                None => DiagnosticMessage::DuplicateFunction {
                    function: function.clone(),
                },
            };
            self.fault(DiagnosticCode::DuplicateFunction, &slot, message);
            return None;
        }
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
                    DiagnosticMessage::ModuleNotAllowed,
                );
                None
            }
            (Scope::Project, None) => {
                self.report(
                    DiagnosticCode::ModuleRequired,
                    &join(path, "module"),
                    node.at,
                    DiagnosticMessage::ModuleRequired,
                );
                None
            }
            (Scope::Project, Some(slot)) => {
                let module = self.string(&slot)?;
                let Some(problem) = module_path_problem(&module) else {
                    return Some(module);
                };
                self.fault(DiagnosticCode::InvalidModulePath, &slot, problem(module));
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
                DiagnosticMessage::InvalidFunction { function },
            );
            return None;
        }
        if BUILTIN_NAMES.contains(&function.as_str()) {
            self.fault(
                DiagnosticCode::BuiltinName,
                &slot,
                DiagnosticMessage::BuiltinName {
                    function: function.clone(),
                },
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
                DiagnosticMessage::FieldsNotList { found: slot.found },
            );
            return None;
        };
        if elements.is_empty() {
            self.fault(
                DiagnosticCode::InvalidValue,
                &slot,
                DiagnosticMessage::NoFields,
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
                    DiagnosticMessage::FieldNotTable {
                        found: ValueType::of_value(value),
                    },
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
                DiagnosticMessage::DuplicateArg { arg },
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
                DiagnosticMessage::UnknownKind { kind: name },
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
                        DiagnosticMessage::DefaultNotOption { value },
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
                    DiagnosticMessage::MaxBelowMin {
                        min: min.to_string(),
                        max: max.to_string(),
                    },
                );
            }
        }
        if let Some((step, slot)) = &step {
            if *step <= 0.0 {
                self.fault(
                    DiagnosticCode::InvalidValue,
                    slot,
                    DiagnosticMessage::StepNotPositive,
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
                DiagnosticMessage::OptionsNotList { found: slot.found },
            );
            return None;
        };
        if elements.is_empty() {
            self.fault(
                DiagnosticCode::InvalidValue,
                &slot,
                DiagnosticMessage::NoOptions,
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
                        found: ValueType::of_value(value),
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
                            DiagnosticMessage::OptionNotStringOrTable { found: entry.found },
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
                    DiagnosticMessage::DuplicateOption {
                        value: option.value,
                    },
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
                DiagnosticMessage::NotArg {
                    key: slot.key.to_owned(),
                },
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
                DiagnosticMessage::MissingKey {
                    key: key.to_owned(),
                },
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
            let message = match kind {
                Some(kind) if KIND_KEYS.contains(&key) => DiagnosticMessage::KeyNotForKind {
                    key: key.to_owned(),
                    kind: kind.to_owned(),
                },
                _ => DiagnosticMessage::UnknownKey {
                    key: key.to_owned(),
                },
            };
            self.report(DiagnosticCode::UnknownKey, &join(path, key), at, message);
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
            DiagnosticMessage::Blank {
                key: slot.key.to_owned(),
            },
        );
        None
    }

    fn number(&mut self, slot: &Slot<'_>) -> Option<f64> {
        let number = self.cast(
            slot,
            |key, found| DiagnosticMessage::NotNumber { key, found },
            |value| match value {
                Value::Integer(integer) => Some(*integer.value() as f64),
                Value::Float(float) => Some(*float.value()),
                _ => None,
            },
        )?;
        if number.is_finite() {
            return Some(number);
        }
        self.fault(
            DiagnosticCode::InvalidValue,
            slot,
            DiagnosticMessage::NotFinite {
                key: slot.key.to_owned(),
            },
        );
        None
    }

    fn string(&mut self, slot: &Slot<'_>) -> Option<String> {
        self.cast(
            slot,
            |key, found| DiagnosticMessage::NotString { key, found },
            |value| value.as_str().map(str::to_owned),
        )
    }

    fn boolean(&mut self, slot: &Slot<'_>) -> Option<bool> {
        self.cast(
            slot,
            |key, found| DiagnosticMessage::NotBoolean { key, found },
            Value::as_bool,
        )
    }

    fn cast<T>(
        &mut self,
        slot: &Slot<'_>,
        expected: fn(String, ValueType) -> DiagnosticMessage,
        cast: impl FnOnce(&Value) -> Option<T>,
    ) -> Option<T> {
        let value = slot.value.and_then(cast);
        if value.is_none() {
            self.fault(
                DiagnosticCode::InvalidValue,
                slot,
                expected(slot.key.to_owned(), slot.found),
            );
        }
        value
    }
}
