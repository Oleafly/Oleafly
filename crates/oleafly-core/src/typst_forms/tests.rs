use super::*;
use serde_json::{json, Value as Json};

const PACKAGE: &str = include_str!(
    "../../../../test/fixtures/typst-forms/packages/local/acme-report/0.1.0/typst.toml"
);
const PROJECT: &str =
    include_str!("../../../../test/fixtures/typst-forms/project/oleafly-forms.toml");
const GOLDEN: &str = include_str!("../../../../test/fixtures/typst-forms/expected/catalog.json");
const SPEC: &str = "@local/acme-report:0.1.0";

fn text(origin: SourceOrigin, text: &str) -> SourceRead {
    SourceRead {
        origin,
        watch: None,
        text: SourceText::Text(text.into()),
    }
}

fn package(spec: &str) -> SourceOrigin {
    SourceOrigin::Package { spec: spec.into() }
}

fn fixture_catalog() -> FormCatalog {
    assemble_catalog(vec![
        text(SourceOrigin::ProjectFile, PROJECT),
        text(package(SPEC), PACKAGE),
    ])
}

macro_rules! bad {
    ($name:literal) => {
        include_str!(concat!(
            "../../../../test/fixtures/typst-forms/bad/",
            $name,
            ".toml"
        ))
    };
}

fn project(forms: &str) -> String {
    format!("[tool.oleafly]\nschema = 1\n\n{forms}")
}

/// Each diagnostic as (code, path, line).
fn found(diagnostics: &[FormDiagnostic]) -> Vec<(DiagnosticCode, &str, Option<u32>)> {
    diagnostics
        .iter()
        .map(|diagnostic| (diagnostic.code, diagnostic.path.as_str(), diagnostic.line))
        .collect()
}

fn functions(forms: &[FormDefinition]) -> Vec<&str> {
    forms.iter().map(|form| form.function.as_str()).collect()
}

#[test]
fn the_fixture_catalog_matches_the_golden() {
    let catalog = fixture_catalog();
    println!("{}", serde_json::to_string_pretty(&catalog).unwrap());
    let golden: Json = serde_json::from_str(GOLDEN).unwrap();
    let actual = serde_json::to_value(&catalog).unwrap();
    assert_eq!(actual["forms"], golden["forms"]);
    assert_eq!(actual["diagnostics"], golden["diagnostics"]);
    assert_eq!(actual["watch"], json!([]));
    assert!(actual["version"]
        .as_str()
        .is_some_and(|version| version.len() == 64));
    assert_eq!(actual.as_object().unwrap().len(), 4);
}

#[test]
fn bad_fixtures_report_without_panicking() {
    let (forms, diagnostics) = parse_project_forms(bad!("bom"));
    assert_eq!(functions(&forms), ["memo-header"]);
    assert!(diagnostics.is_empty(), "{diagnostics:?}");

    for scope in ["project", "package"] {
        let (forms, diagnostics) = match scope {
            "project" => parse_project_forms(bad!("deep-nesting")),
            _ => parse_package_forms(bad!("deep-nesting"), SPEC),
        };
        assert!(forms.is_empty());
        assert_eq!(
            found(&diagnostics),
            [(DiagnosticCode::ParseError, "", Some(3))],
            "{diagnostics:?}"
        );
    }

    let (forms, diagnostics) = parse_package_forms(bad!("duplicate-function"), SPEC);
    assert_eq!(forms.len(), 1);
    assert_eq!(forms[0].label, "First");
    assert_eq!(
        found(&diagnostics),
        [(
            DiagnosticCode::DuplicateFunction,
            "tool.oleafly.forms[1].function",
            Some(15)
        )]
    );

    let (forms, diagnostics) = parse_project_forms(bad!("schema-2"));
    assert!(forms.is_empty());
    assert_eq!(
        found(&diagnostics),
        [(
            DiagnosticCode::SchemaVersion,
            "tool.oleafly.schema",
            Some(2)
        )]
    );

    let (forms, diagnostics) = parse_project_forms(bad!("syntax-error"));
    assert!(forms.is_empty());
    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].code, DiagnosticCode::ParseError);
    assert_eq!(diagnostics[0].severity, Severity::Error);
    assert!(diagnostics[0].line.is_some_and(|line| line >= 6));
    assert!(diagnostics[0]
        .detail
        .starts_with("This is not valid TOML: "));

    let (forms, diagnostics) = parse_project_forms(bad!("unknown-kind"));
    assert_eq!(functions(&forms), ["memo-header"]);
    assert_eq!(
        found(&diagnostics),
        [(
            DiagnosticCode::UnknownKind,
            "tool.oleafly.forms[0].fields[0].kind",
            Some(7)
        )]
    );
}

#[test]
fn one_bad_form_drops_only_itself() {
    let text = project(
        r#"[[tool.oleafly.forms]]
module = "a.typ"
function = "first"
fields = [{ arg = "x", kind = "text", label = "X" }]

[[tool.oleafly.forms]]
module = "a.typ"
function = "second"
fields = [{ arg = "x", kind = "text" }, { arg = "y", kind = "toggle", label = "Y", default = "yes" }]

[[tool.oleafly.forms]]
module = "a.typ"
function = "third"
fields = [{ arg = "x", kind = "text", label = "X" }]
"#,
    );
    let (forms, diagnostics) = parse_project_forms(&text);
    assert_eq!(functions(&forms), ["first", "third"]);
    assert_eq!(
        found(&diagnostics),
        [
            (
                DiagnosticCode::MissingKey,
                "tool.oleafly.forms[1].fields[0].label",
                Some(12)
            ),
            (
                DiagnosticCode::InvalidValue,
                "tool.oleafly.forms[1].fields[1].default",
                Some(12)
            ),
        ]
    );
}

#[test]
fn duplicates_keep_the_first_form_and_report_the_rest() {
    let text = project(
        r#"[[tool.oleafly.forms]]
module = "a.typ"
function = "card"
label = "A card"
fields = [{ arg = "x", kind = "text", label = "X" }]

[[tool.oleafly.forms]]
module = "b.typ"
function = "card"
label = "B card"
fields = [{ arg = "x", kind = "text", label = "X" }]

[[tool.oleafly.forms]]
module = "a.typ"
function = "card"
label = "Another A card"
fields = [{ arg = "x", kind = "text", label = "X" }]
"#,
    );
    let (forms, diagnostics) = parse_project_forms(&text);
    let ids: Vec<&str> = forms.iter().map(|form| form.id.as_str()).collect();
    assert_eq!(ids, ["mod:a.typ#card", "mod:b.typ#card"]);
    assert_eq!(forms[0].label, "A card");
    assert_eq!(
        found(&diagnostics),
        [(
            DiagnosticCode::DuplicateFunction,
            "tool.oleafly.forms[2].function",
            Some(18)
        )]
    );
    assert!(diagnostics[0].detail.contains("card from a.typ"));
}

#[test]
fn two_fields_on_one_argument_drop_the_form() {
    let text = project(
        r#"[[tool.oleafly.forms]]
module = "a.typ"
function = "card"
fields = [
  { arg = 0, kind = "content", label = "Body" },
  { arg = "x", kind = "text", label = "X" },
  { arg = 0, kind = "text", label = "Again" },
]
"#,
    );
    let (forms, diagnostics) = parse_project_forms(&text);
    assert!(forms.is_empty());
    assert_eq!(
        found(&diagnostics),
        [(
            DiagnosticCode::DuplicateArg,
            "tool.oleafly.forms[0].fields[2].arg",
            Some(10)
        )]
    );
}

#[test]
fn a_missing_or_unsupported_schema_drops_the_source() {
    let form = r#"
[[tool.oleafly.forms]]
module = "a.typ"
function = "card"
fields = [{ arg = "x", kind = "text", label = "X" }]
"#;
    let cases = [
        (
            format!("[tool.oleafly]\nlabel = 1\n{form}"),
            DiagnosticCode::SchemaMissing,
            Some(1),
        ),
        (
            format!("[tool.oleafly]\nschema = 2\n{form}"),
            DiagnosticCode::SchemaVersion,
            Some(2),
        ),
        (
            format!("[tool.oleafly]\nschema = \"1\"\n{form}"),
            DiagnosticCode::SchemaVersion,
            Some(2),
        ),
        (
            form.replace("[[tool.oleafly.forms]]", "[[tool.other.forms]]"),
            DiagnosticCode::SchemaMissing,
            None,
        ),
        (String::new(), DiagnosticCode::SchemaMissing, None),
    ];
    for (text, code, line) in cases {
        let (forms, diagnostics) = parse_project_forms(&text);
        assert!(forms.is_empty(), "{text}");
        assert_eq!(
            found(&diagnostics),
            [(code, "tool.oleafly.schema", line)],
            "{text}"
        );
    }

    let (forms, diagnostics) = parse_package_forms(
        "[package]\nname = \"plain\"\nversion = \"1.0.0\"\nentrypoint = \"lib.typ\"\n",
        "@preview/plain:1.0.0",
    );
    assert!(forms.is_empty());
    assert!(diagnostics.is_empty(), "a package without forms is silent");
}

#[test]
fn bom_and_crlf_files_parse_with_the_same_lines() {
    let crlf = PACKAGE.replace('\n', "\r\n");
    let bom = format!("\u{feff}{crlf}");
    for text in [crlf.as_str(), bom.as_str()] {
        let (forms, diagnostics) = parse_package_forms(text, SPEC);
        let (expected, _) = parse_package_forms(PACKAGE, SPEC);
        assert_eq!(forms, expected);
        assert_eq!(
            found(&diagnostics),
            [(
                DiagnosticCode::BuiltinName,
                "tool.oleafly.forms[4].function",
                Some(69)
            )]
        );
    }
}

#[test]
fn a_built_in_name_warns_and_keeps_the_form() {
    let text = project(
        r#"[[tool.oleafly.forms]]
module = "lib/figures.typ"
function = "figure"
fields = [{ arg = "caption", kind = "content", label = "Caption" }]
"#,
    );
    let (forms, diagnostics) = parse_project_forms(&text);
    assert_eq!(functions(&forms), ["figure"]);
    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].severity, Severity::Warning);
    assert_eq!(diagnostics[0].code, DiagnosticCode::BuiltinName);
    assert_eq!(
        diagnostics[0].detail,
        "\"figure\" is a built-in Typst name. Bare calls keep the built-in widget, so only qualified or renamed calls use this form."
    );
}

#[test]
fn module_paths_must_be_plain_project_paths() {
    let form = |module: &str| {
        project(&format!(
            "[[tool.oleafly.forms]]\n{module}function = \"card\"\nfields = [{{ arg = \"x\", kind = \"text\", label = \"X\" }}]\n"
        ))
    };
    for module in [
        r#""""#,
        r#""template\\memo.typ""#,
        r#""/template/memo.typ""#,
        r#""../memo.typ""#,
        r#""template/../memo.typ""#,
        r#""./memo.typ""#,
        r#""template//memo.typ""#,
        r#""template/""#,
    ] {
        let (forms, diagnostics) = parse_project_forms(&form(&format!("module = {module}\n")));
        assert!(forms.is_empty(), "{module}");
        assert_eq!(
            found(&diagnostics),
            [(
                DiagnosticCode::InvalidModulePath,
                "tool.oleafly.forms[0].module",
                Some(5)
            )],
            "{module}"
        );
    }
    let (_, diagnostics) = parse_project_forms(&form("module = 3\n"));
    assert_eq!(diagnostics[0].code, DiagnosticCode::InvalidValue);
    let (_, diagnostics) = parse_project_forms(&form(""));
    assert_eq!(
        found(&diagnostics),
        [(
            DiagnosticCode::ModuleRequired,
            "tool.oleafly.forms[0].module",
            Some(4)
        )]
    );
    let (forms, _) = parse_project_forms(&form("module = \"template/a b/memo.typ\"\n"));
    assert_eq!(forms[0].id, "mod:template/a b/memo.typ#card");

    let mut manifest = PACKAGE.to_owned();
    manifest = manifest.replacen(
        "function = \"cover-page\"",
        "module = \"lib.typ\"\nfunction = \"cover-page\"",
        1,
    );
    let (forms, diagnostics) = parse_package_forms(&manifest, SPEC);
    assert!(!functions(&forms).contains(&"cover-page"));
    assert_eq!(
        found(&diagnostics)[0],
        (
            DiagnosticCode::ModuleNotAllowed,
            "tool.oleafly.forms[0].module",
            Some(13)
        )
    );
}

#[test]
fn every_schema_rule_has_a_diagnostic() {
    let cases: &[(&str, DiagnosticCode, &str)] = &[
        (
            r#"label = "X""#,
            DiagnosticCode::MissingKey,
            "tool.oleafly.forms[0].function",
        ),
        (
            r#"function = "acme.card""#,
            DiagnosticCode::InvalidFunction,
            "tool.oleafly.forms[0].function",
        ),
        (
            r#"function = "let""#,
            DiagnosticCode::InvalidFunction,
            "tool.oleafly.forms[0].function",
        ),
        (
            r#"function = "card"
label = "  ""#,
            DiagnosticCode::InvalidValue,
            "tool.oleafly.forms[0].label",
        ),
        (
            r#"function = "card"
fields = []"#,
            DiagnosticCode::InvalidValue,
            "tool.oleafly.forms[0].fields",
        ),
        (
            r#"function = "card"
fields = "title""#,
            DiagnosticCode::InvalidValue,
            "tool.oleafly.forms[0].fields",
        ),
        (
            r#"function = "card"
fields = [{ arg = -1, kind = "text", label = "X" }]"#,
            DiagnosticCode::InvalidArg,
            "tool.oleafly.forms[0].fields[0].arg",
        ),
        (
            r#"function = "card"
fields = [{ arg = "two words", kind = "text", label = "X" }]"#,
            DiagnosticCode::InvalidArg,
            "tool.oleafly.forms[0].fields[0].arg",
        ),
        (
            r#"function = "card"
summary = "title"
fields = [{ arg = "x", kind = "text", label = "X" }]"#,
            DiagnosticCode::InvalidArg,
            "tool.oleafly.forms[0].summary",
        ),
        (
            r#"function = "card"
fields = [{ arg = "x", label = "X" }]"#,
            DiagnosticCode::MissingKey,
            "tool.oleafly.forms[0].fields[0].kind",
        ),
        (
            r#"function = "card"
fields = [{ arg = "x", kind = "text", label = "X", required = "yes" }]"#,
            DiagnosticCode::InvalidValue,
            "tool.oleafly.forms[0].fields[0].required",
        ),
        (
            r#"function = "card"
fields = [{ arg = "x", kind = "choice", label = "X" }]"#,
            DiagnosticCode::MissingKey,
            "tool.oleafly.forms[0].fields[0].options",
        ),
        (
            r#"function = "card"
fields = [{ arg = "x", kind = "choice", label = "X", options = [] }]"#,
            DiagnosticCode::InvalidValue,
            "tool.oleafly.forms[0].fields[0].options",
        ),
        (
            r#"function = "card"
fields = [{ arg = "x", kind = "choice", label = "X", options = ["a", { value = "a", label = "A" }] }]"#,
            DiagnosticCode::InvalidValue,
            "tool.oleafly.forms[0].fields[0].options[1]",
        ),
        (
            r#"function = "card"
fields = [{ arg = "x", kind = "choice", label = "X", options = [1] }]"#,
            DiagnosticCode::InvalidValue,
            "tool.oleafly.forms[0].fields[0].options[0]",
        ),
        (
            r#"function = "card"
fields = [{ arg = "x", kind = "choice", label = "X", options = [{ value = "a" }] }]"#,
            DiagnosticCode::MissingKey,
            "tool.oleafly.forms[0].fields[0].options[0].label",
        ),
        (
            r#"function = "card"
fields = [{ arg = "x", kind = "choice", label = "X", options = ["a"], default = "b" }]"#,
            DiagnosticCode::InvalidValue,
            "tool.oleafly.forms[0].fields[0].default",
        ),
        (
            r#"function = "card"
fields = [{ arg = "x", kind = "number", label = "X", min = 5, max = 1 }]"#,
            DiagnosticCode::InvalidValue,
            "tool.oleafly.forms[0].fields[0].max",
        ),
        (
            r#"function = "card"
fields = [{ arg = "x", kind = "number", label = "X", step = 0 }]"#,
            DiagnosticCode::InvalidValue,
            "tool.oleafly.forms[0].fields[0].step",
        ),
        (
            r#"function = "card"
fields = [{ arg = "x", kind = "number", label = "X", max = inf }]"#,
            DiagnosticCode::InvalidValue,
            "tool.oleafly.forms[0].fields[0].max",
        ),
        (
            r#"function = "card"
fields = [{ arg = "x", kind = "number", label = "X", default = "3" }]"#,
            DiagnosticCode::InvalidValue,
            "tool.oleafly.forms[0].fields[0].default",
        ),
        (
            r#"function = "card"
fields = [{ arg = "x", kind = "date", label = "X" }]"#,
            DiagnosticCode::UnknownKind,
            "tool.oleafly.forms[0].fields[0].kind",
        ),
        (
            r#"function = "card"
fields = ["x"]"#,
            DiagnosticCode::InvalidValue,
            "tool.oleafly.forms[0].fields[0]",
        ),
    ];
    for (form, code, path) in cases {
        let text = format!("[tool.oleafly]\nschema = 1\n\n[[tool.oleafly.forms]]\n{form}\n");
        let (forms, diagnostics) = parse_package_forms(&text, SPEC);
        assert!(forms.is_empty(), "{form}");
        let diagnostic = diagnostics
            .iter()
            .find(|diagnostic| diagnostic.code == *code && diagnostic.path == *path)
            .unwrap_or_else(|| panic!("{form}: {diagnostics:#?}"));
        assert_eq!(diagnostic.severity, Severity::Error);
        assert!(diagnostic.line.is_some(), "{form}");
        assert!(diagnostic.detail.ends_with('.'), "{}", diagnostic.detail);
    }
}

#[test]
fn unknown_keys_warn_and_keep_the_form() {
    let text = r#"[tool.oleafly]
schema = 1
theme = "dark"

[[tool.oleafly.forms]]
function = "card"
lable = "Card"
fields = [
  { arg = "x", kind = "toggle", label = "X", multiline = true },
  { arg = 0, kind = "content", label = "Body", default = "Hello" },
]
"#;
    let (forms, diagnostics) = parse_package_forms(text, SPEC);
    assert_eq!(functions(&forms), ["card"]);
    assert_eq!(forms[0].label, "card");
    assert_eq!(forms[0].fields[1].kind, FieldKind::Content);
    assert_eq!(
        found(&diagnostics),
        [
            (DiagnosticCode::UnknownKey, "tool.oleafly.theme", Some(3)),
            (
                DiagnosticCode::UnknownKey,
                "tool.oleafly.forms[0].lable",
                Some(7)
            ),
            (
                DiagnosticCode::UnknownKey,
                "tool.oleafly.forms[0].fields[0].multiline",
                Some(9)
            ),
            (
                DiagnosticCode::UnknownKey,
                "tool.oleafly.forms[0].fields[1].default",
                Some(10)
            ),
        ]
    );
    assert!(diagnostics
        .iter()
        .all(|diagnostic| diagnostic.severity == Severity::Warning));
    assert_eq!(
        diagnostics[2].detail,
        "multiline does not apply to toggle fields, so it is ignored."
    );
}

#[test]
fn tables_may_be_written_inline_or_with_headers() {
    let text = r#"[tool.oleafly]
schema = 1
forms = [
  { function = "badge", fields = [{ arg = 0, kind = "choice", label = "State", options = ["a", "b"] }] },
]
"#;
    let (forms, diagnostics) = parse_package_forms(text, SPEC);
    assert!(diagnostics.is_empty(), "{diagnostics:?}");
    assert_eq!(forms[0].id, "pkg:@local/acme-report:0.1.0#badge");

    let text = r#"[tool.oleafly]
schema = 1

[[tool.oleafly.forms]]
function = "badge"

[[tool.oleafly.forms.fields]]
arg = 0
kind = "choice"
label = "State"

[[tool.oleafly.forms.fields.options]]
value = "a"
label = "A"

[[tool.oleafly.forms.fields.options]]
value = "b"
label = "B"
"#;
    let (forms, diagnostics) = parse_package_forms(text, SPEC);
    assert!(diagnostics.is_empty(), "{diagnostics:?}");
    assert_eq!(
        serde_json::to_value(&forms[0].fields[0].kind).unwrap(),
        json!({
            "type": "choice",
            "options": [{ "value": "a", "label": "A" }, { "value": "b", "label": "B" }],
            "default": null
        })
    );
}

#[test]
fn numbers_serialise_as_floats_and_absent_optionals_as_null() {
    let text = r#"[tool.oleafly]
schema = 1

[[tool.oleafly.forms]]
function = "gauge"
fields = [
  { arg = "level", kind = "number", label = "Level", min = 0, max = 10, step = 0.5, default = 3 },
  { arg = "done", kind = "toggle", label = "Done" },
]
"#;
    let (forms, diagnostics) = parse_package_forms(text, SPEC);
    assert!(diagnostics.is_empty(), "{diagnostics:?}");
    let fields = serde_json::to_value(&forms[0].fields).unwrap();
    assert_eq!(
        fields[0]["kind"],
        json!({ "type": "number", "integer": false, "min": 0.0, "max": 10.0, "step": 0.5, "default": 3.0 })
    );
    assert_eq!(
        serde_json::to_string(&fields[0]["kind"]["min"]).unwrap(),
        "0.0"
    );
    assert_eq!(
        fields[1]["kind"],
        json!({ "type": "toggle", "default": null })
    );
    assert_eq!(fields[1]["help"], Json::Null);
    assert_eq!(fields[1]["placeholder"], Json::Null);
}

#[test]
fn sources_that_cannot_be_read_get_one_diagnostic_each() {
    let catalog = assemble_catalog(vec![
        SourceRead {
            origin: SourceOrigin::ProjectFile,
            watch: Some(PROJECT_FORMS_FILE.into()),
            text: SourceText::TooLarge(300_000),
        },
        SourceRead {
            origin: package("@preview/gone:1.0.0"),
            watch: None,
            text: SourceText::Missing,
        },
        SourceRead {
            origin: package("@preview/locked:1.0.0"),
            watch: Some("typst-packages/preview/locked/1.0.0/typst.toml".into()),
            text: SourceText::Unreadable("permission denied".into()),
        },
        SourceRead {
            origin: package("@preview/half"),
            watch: None,
            text: SourceText::InvalidSpec,
        },
    ]);
    assert!(catalog.forms.is_empty());
    assert_eq!(
        catalog.watch,
        [
            "oleafly-forms.toml",
            "typst-packages/preview/locked/1.0.0/typst.toml"
        ]
    );
    let summary: Vec<(&str, DiagnosticCode, &str, Option<u32>)> = catalog
        .diagnostics
        .iter()
        .map(|diagnostic| {
            (
                diagnostic.source.as_str(),
                diagnostic.code,
                diagnostic.path.as_str(),
                diagnostic.line,
            )
        })
        .collect();
    assert_eq!(
        summary,
        [
            ("oleafly-forms.toml", DiagnosticCode::FileTooLarge, "", None),
            (
                "@preview/locked:1.0.0",
                DiagnosticCode::Unreadable,
                "",
                None
            ),
            (
                "@preview/half",
                DiagnosticCode::InvalidPackageSpec,
                "",
                None
            ),
        ]
    );
    assert!(catalog.diagnostics[1].detail.contains("permission denied"));
    assert!(catalog
        .diagnostics
        .iter()
        .all(|diagnostic| diagnostic.severity == Severity::Error));
}

#[test]
fn the_version_follows_every_source() {
    let base = fixture_catalog().version;
    assert_eq!(base.len(), 64);
    assert_eq!(fixture_catalog().version, base);

    let edited = assemble_catalog(vec![
        text(
            SourceOrigin::ProjectFile,
            &PROJECT.replace("Subject", "Topic"),
        ),
        text(package(SPEC), PACKAGE),
    ]);
    assert_ne!(edited.version, base);

    let other_spec = assemble_catalog(vec![
        text(SourceOrigin::ProjectFile, PROJECT),
        text(package("@local/acme-report:0.2.0"), PACKAGE),
    ]);
    assert_ne!(other_spec.version, base);

    let watched = assemble_catalog(vec![
        SourceRead {
            watch: Some(PROJECT_FORMS_FILE.into()),
            ..text(SourceOrigin::ProjectFile, PROJECT)
        },
        text(package(SPEC), PACKAGE),
    ]);
    assert_ne!(watched.version, base);

    let missing = assemble_catalog(vec![SourceRead {
        origin: SourceOrigin::ProjectFile,
        watch: None,
        text: SourceText::Missing,
    }]);
    let empty = assemble_catalog(vec![text(SourceOrigin::ProjectFile, "")]);
    assert_ne!(missing.version, empty.version);
    assert_eq!(assemble_catalog(Vec::new()).version.len(), 64);
}

#[test]
fn package_manifests_must_be_toml_1_0_because_typst_reads_them() {
    // TOML 1.1 lets an inline table span lines and end with a comma. Typst
    // reads typst.toml as TOML 1.0 and refuses the package over either, but
    // it never reads oleafly-forms.toml.
    let cases = [
        (
            "fields = [\n  { arg = \"title\", kind = \"text\",\n    label = \"Heading\" },\n]\n",
            Some(7),
        ),
        (
            "fields = [{ arg = \"title\", kind = \"text\", label = \"Heading\", }]\n",
            Some(6),
        ),
    ];
    for (fields, line) in cases {
        let manifest = format!(
            "[tool.oleafly]\nschema = 1\n\n[[tool.oleafly.forms]]\nfunction = \"info-box\"\n{fields}"
        );
        let (forms, diagnostics) = parse_package_forms(&manifest, SPEC);
        assert!(forms.is_empty(), "{fields}");
        assert_eq!(
            found(&diagnostics),
            [(DiagnosticCode::ParseError, "", line)],
            "{fields}"
        );
        assert!(
            diagnostics[0].detail.starts_with(
                "Typst reads typst.toml as TOML 1.0, and this file is not valid TOML 1.0: "
            ),
            "{}",
            diagnostics[0].detail
        );

        let (forms, diagnostics) = parse_project_forms(&project(&format!(
            "[[tool.oleafly.forms]]\nmodule = \"lib.typ\"\nfunction = \"info-box\"\n{fields}"
        )));
        assert_eq!(functions(&forms), ["info-box"], "{fields}");
        assert!(diagnostics.is_empty(), "{diagnostics:?}");
    }
}

#[test]
fn identifiers_follow_the_typst_lexer() {
    // The virama in नमस्ते and a combining accent are XID_Continue but not
    // alphanumeric. A superscript digit is the other way round.
    for name in ["नमस्ते", "cafe\u{301}", "_draft", "info-box", "x1"] {
        assert!(is_identifier(name), "{name}");
    }
    for name in ["x²", "1x", "-x", "a.b", "a b", "", "let"] {
        assert!(!is_identifier(name), "{name}");
    }

    let text = "[tool.oleafly]\nschema = 1\n\n[[tool.oleafly.forms]]\nfunction = \"नमस्ते\"\nfields = [{ arg = \"cafe\u{301}\", kind = \"text\", label = \"Café\" }]\n\n[[tool.oleafly.forms]]\nfunction = \"x²\"\nfields = [{ arg = \"x\", kind = \"text\", label = \"X\" }]\n";
    let (forms, diagnostics) = parse_package_forms(text, SPEC);
    assert_eq!(functions(&forms), ["नमस्ते"]);
    assert_eq!(forms[0].fields[0].arg, ArgRef::Named("cafe\u{301}".into()));
    assert_eq!(
        found(&diagnostics),
        [(
            DiagnosticCode::InvalidFunction,
            "tool.oleafly.forms[1].function",
            Some(9)
        )]
    );
}

#[test]
fn a_dropped_form_does_not_claim_its_function() {
    let form = |module: &str, label: &str| {
        format!(
            "[[tool.oleafly.forms]]\n{module}function = \"info-box\"\nlabel = \"{label}\"\nfields = [{{ arg = \"title\", kind = \"text\", label = \"Heading\" }}]\n\n"
        )
    };
    for (scope, module) in [("package", ""), ("project", "module = \"lib.typ\"\n")] {
        let text = project(
            &[
                form(module, ""),
                form(module, "Info box"),
                form(module, "Third"),
            ]
            .concat(),
        );
        let (forms, diagnostics) = match scope {
            "package" => parse_package_forms(&text, SPEC),
            _ => parse_project_forms(&text),
        };
        assert_eq!(functions(&forms), ["info-box"], "{scope}");
        assert_eq!(forms[0].label, "Info box", "{scope}");
        let offset = u32::from(!module.is_empty());
        assert_eq!(
            found(&diagnostics),
            [
                (
                    DiagnosticCode::InvalidValue,
                    "tool.oleafly.forms[0].label",
                    Some(6 + offset)
                ),
                (
                    DiagnosticCode::DuplicateFunction,
                    "tool.oleafly.forms[2].function",
                    Some(15 + 3 * offset)
                ),
            ],
            "{scope}"
        );
    }
}

#[test]
fn a_package_module_points_to_the_package_manifest() {
    let text = project(
        r#"[[tool.oleafly.forms]]
module = "@preview/cetz:0.3.4"
function = "canvas"
fields = [{ arg = 0, kind = "content", label = "Body" }]
"#,
    );
    let (forms, diagnostics) = parse_project_forms(&text);
    assert!(forms.is_empty());
    assert_eq!(
        found(&diagnostics),
        [(
            DiagnosticCode::InvalidModulePath,
            "tool.oleafly.forms[0].module",
            Some(5)
        )]
    );
    assert_eq!(
        diagnostics[0].detail,
        "module \"@preview/cetz:0.3.4\" names a package. A package's forms go in that package's typst.toml."
    );
}
