#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const GENERATOR_VERSION = 2;
const CLASSIFICATIONS = [
  "translate",
  "structured-code-then-translate",
  "user-content",
  "third-party/raw-diagnostic",
  "developer-only",
  "channel-specific",
];

const scriptPath = fileURLToPath(import.meta.url);
const desktopRoot = resolve(process.env.OLEAFLY_DESKTOP_ROOT ?? join(dirname(scriptPath), ".."));
const outputRoot = join(desktopRoot, "docs", "localization");
const checkOnly = process.argv.includes("--check");
const printSummary = process.argv.includes("--print-summary");
const selfTestOnly = process.argv.includes("--self-test");
const errorCodeManifestPath = join(outputRoot, "error-code-manifest.json");

const repositories = [
  {
    id: "desktop",
    root: desktopRoot,
  },
];

const entries = [];
const rustBoundaries = [];
const scannedFiles = new Map(repositories.map((repository) => [repository.id, new Set()]));
const occurrenceCounts = new Map();

if (!existsSync(errorCodeManifestPath)) {
  throw new Error(
    `Missing reviewed error-code manifest: ${normalizePath(
      relative(desktopRoot, errorCodeManifestPath),
    )}`,
  );
}

const errorCodeManifestSource = readFileSync(errorCodeManifestPath, "utf8");
const errorCodeManifest = JSON.parse(errorCodeManifestSource);

function normalizePath(value) {
  return value.split(sep).join("/");
}

function repoPath(repository, absolutePath) {
  return normalizePath(relative(repository.root, absolutePath));
}

function sourceText(absolutePath, repository) {
  scannedFiles.get(repository.id).add(repoPath(repository, absolutePath));
  return readFileSync(absolutePath, "utf8");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function compactValue(value, limit = 480) {
  const normalized = String(value).replace(/\r\n/g, "\n").trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit)}… [${normalized.length} chars]`;
}

function lineAndColumn(text, offset) {
  const prefix = text.slice(0, offset);
  const line = prefix.split("\n").length;
  const lastBreak = prefix.lastIndexOf("\n");
  return {
    line,
    column: offset - lastBreak,
  };
}

function stableId(entry, ordinal) {
  return sha256(
    [
      entry.repository,
      entry.path,
      entry.kind,
      entry.context,
      entry.value,
      ordinal,
    ].join("\0"),
  ).slice(0, 16);
}

function addEntry(entry) {
  const identityValue = String(entry.value).replace(/\r\n/g, "\n").trim();
  if (!identityValue) return;
  const value = compactValue(identityValue);
  if (!CLASSIFICATIONS.includes(entry.classification)) {
    throw new Error(`Unknown classification: ${entry.classification}`);
  }
  const normalized = {
    repository: entry.repository,
    path: normalizePath(entry.path),
    line: entry.line,
    column: entry.column ?? 1,
    surface: entry.surface,
    kind: entry.kind,
    context: entry.context,
    classification: entry.classification,
    owner: entry.owner,
    planned_code: entry.planned_code ?? "",
    code_status: entry.code_status ?? "",
    review_basis: entry.review_basis ?? "deterministic-rule",
    value,
  };
  const occurrenceKey = [
    normalized.repository,
    normalized.path,
    normalized.kind,
    normalized.context,
    identityValue,
  ].join("\0");
  const ordinal = occurrenceCounts.get(occurrenceKey) ?? 0;
  occurrenceCounts.set(occurrenceKey, ordinal + 1);
  entries.push({
    id: stableId({ ...normalized, value: identityValue }, ordinal),
    ...normalized,
  });
}

function listFiles(root, predicate, ignoredDirectories = new Set()) {
  if (!existsSync(root)) return [];
  const files = [];
  const visit = (directory) => {
    for (const name of readdirSync(directory).sort()) {
      if (name === ".git" || name === "node_modules" || name === "target" || name === "dist") {
        continue;
      }
      if (ignoredDirectories.has(name)) continue;
      const absolutePath = join(directory, name);
      const stat = statSync(absolutePath);
      if (stat.isDirectory()) {
        visit(absolutePath);
      } else if (stat.isFile() && predicate(absolutePath)) {
        files.push(absolutePath);
      }
    }
  };
  visit(root);
  return files.sort();
}

function isTestPath(path) {
  return (
    /(?:^|\/)__tests__(?:\/|$)/.test(path) ||
    /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path) ||
    /\.stories\.[cm]?[jt]sx?$/.test(path)
  );
}

function desktopOwner(path) {
  if (path.startsWith("src/components/settings/") || path === "src/store/settings.ts") {
    return "desktop-settings";
  }
  if (path.startsWith("src/components/ai/") || path.startsWith("packages/ai")) {
    return "desktop-ai";
  }
  if (path.startsWith("src/components/tools/") || path.includes("research-tools")) {
    return "desktop-research-tools";
  }
  if (path.startsWith("src/components/editor/") || path.startsWith("packages/editor/")) {
    return "desktop-editor";
  }
  if (path.startsWith("packages/wysiwyg/")) return "desktop-wysiwyg";
  if (path.includes("/preview/") || path.startsWith("packages/preview/")) {
    return "desktop-preview";
  }
  if (path.includes("/preflight/") || path.startsWith("packages/preflight/")) {
    return "desktop-preflight";
  }
  if (path.includes("/diagram/") || path.startsWith("packages/diagram/")) {
    return "desktop-diagram";
  }
  if (path.includes("template") || path.startsWith("packages/templates/")) {
    return "desktop-templates";
  }
  if (path.startsWith("src/contributions/") || path.includes("/layout/")) {
    return "desktop-shell";
  }
  if (path.includes("/tours/") || path.includes("/tour/")) return "desktop-onboarding";
  return "desktop-core";
}

function desktopSurface(path) {
  const owner = desktopOwner(path);
  return owner.replace(/^desktop-/, "");
}

function propertyContext(node) {
  let current = node;
  for (let depth = 0; current.parent && depth < 5; depth += 1) {
    const parent = current.parent;
    if (ts.isPropertyAssignment(parent) && parent.initializer === current) {
      return `property:${parent.name.getText().replace(/^['"]|['"]$/g, "")}`;
    }
    if (ts.isJsxAttribute(parent)) {
      return `jsx-attribute:${parent.name.getText()}`;
    }
    current = parent;
  }
  return null;
}

function callContext(node) {
  const parent = node.parent;
  if (!parent || !ts.isCallExpression(parent)) return null;
  const index = parent.arguments.indexOf(node);
  const callee = parent.expression.getText();
  if (
    index === 1 &&
    /(?:^|\.)setAttribute$/.test(callee) &&
    ts.isStringLiteralLike(parent.arguments[0])
  ) {
    return `dom-attribute:${parent.arguments[0].text}`;
  }
  if (index === 1 && /^(?:btn|createButton)$/.test(callee)) {
    return "dom-attribute:title";
  }
  return `call:${callee}:arg${index}`;
}

function assignmentContext(node) {
  let current = node;
  for (let depth = 0; current.parent && depth < 8; depth += 1) {
    const parent = current.parent;
    if (
      ts.isBinaryExpression(parent) &&
      parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      parent.right === current &&
      ts.isPropertyAccessExpression(parent.left)
    ) {
      return `dom-property:${parent.left.name.text}`;
    }
    current = parent;
  }
  return null;
}

function nodeContext(node) {
  if (ts.isJsxText(node)) return "jsx-text";
  const property = propertyContext(node);
  if (property) return property;
  const call = callContext(node);
  if (call) return call;
  const assignment = assignmentContext(node);
  if (assignment) return assignment;
  const parent = node.parent;
  if (parent && ts.isVariableDeclaration(parent) && parent.initializer === node) {
    return `variable:${parent.name.getText()}`;
  }
  if (parent && ts.isLiteralTypeNode(parent)) return "type-literal";
  if (parent && ts.isCaseClause(parent)) return "case-label";
  if (parent && ts.isElementAccessExpression(parent)) return "element-key";
  let current = node.parent;
  for (let depth = 0; current && depth < 7; depth += 1) {
    if (ts.isJsxExpression(current)) return "jsx-expression";
    if (ts.isThrowStatement(current)) return "throw";
    current = current.parent;
  }
  return "literal";
}

function isModuleSpecifier(node) {
  const parent = node.parent;
  return (
    (ts.isImportDeclaration(parent) && parent.moduleSpecifier === node) ||
    (ts.isExportDeclaration(parent) && parent.moduleSpecifier === node) ||
    (ts.isExternalModuleReference(parent) && parent.expression === node)
  );
}

function isPropertyNameLiteral(node) {
  const parent = node.parent;
  return (
    (ts.isPropertyAssignment(parent) && parent.name === node) ||
    (ts.isPropertySignature(parent) && parent.name === node) ||
    (ts.isMethodDeclaration(parent) && parent.name === node)
  );
}

function shouldSkipTsLiteral(value, node, context) {
  if (!value.trim()) return true;
  if (isModuleSpecifier(node) || isPropertyNameLiteral(node)) return true;
  if (
    /^jsx-attribute:(?:class|className|style|d|fill|stroke|viewBox|xmlns|transform|points)$/i.test(
      context,
    )
  ) {
    return true;
  }
  if (context === "jsx-expression" && looksLikeCssUtilityToken(value)) return true;
  if (/^[\s\d.,:+*/<>=|&!?()[\]{}#_-]+$/.test(value)) return true;
  return false;
}

const visibleContextPattern =
  /^(?:jsx-text|jsx-expression|jsx-attribute:(?:aria-label|aria-description|alt|title|placeholder|label|description|message|helpText|emptyText)|dom-attribute:(?:aria-label|aria-description|alt|title|placeholder)|dom-property:(?:textContent|innerText|title|placeholder|ariaLabel)|property:(?:label|name|title|description|desc|message|detail|placeholder|tooltip|hint|keywords|group|category|tags|caption|heading|helpText|summary|emptyText|content))$/i;
const developerContextPattern =
  /^(?:type-literal|case-label|element-key|jsx-attribute:(?:id|role|type|href|src|target|rel|class|className|data-[\w-]+)|dom-attribute:(?:id|role|class|className|data-[\w-]+)|property:(?:id|key|kind|type|route|path|url|href|class|className|color|errorColor|engine|format|provider|model|command|action|status|severity|lens|method|endpoint|storageKey))$/i;
const errorContextPattern =
  /(?:^throw$|^call:(?:toast\.(?:error|warning)|note|showError|setError|Error|TypeError):|^property:(?:error|errorMessage|diagnostic)$)/i;
const rawDiagnosticPattern =
  /(?:stderr|stdout|compiler|compile log|pandoc failed|raw diagnostic|response body|responseBody|String\((?:e|err|error)\)|error\.message)/i;

function looksLikeCssUtilityToken(value) {
  return (
    !/\s/.test(value) &&
    /^(?:[a-z-]+:)*-?(?:bg|text|border|ring|outline|shadow|fill|stroke|from|via|to|accent|caret|decoration|divide)-[a-z0-9_[\]./%:-]+$/i.test(
      value,
    )
  );
}

function looksLikeProtocolIdentity(value) {
  return (
    /^(?:https?:|file:|data:|blob:|ipc:|[./~]|[a-z]+:\/\/)/i.test(value) ||
    /^(?:[A-Za-z_][\w.-]*::)+[A-Za-z_][\w.-]*$/.test(value)
  );
}

function looksLikeRustCodeIdentity(value) {
  return (
    !/\s/.test(value) &&
    (/^_+[A-Za-z0-9][A-Za-z0-9_]*_*$/.test(value) ||
      /^[A-Za-z0-9][A-Za-z0-9_-]*(?:[./:][A-Za-z0-9][A-Za-z0-9_.-]*)+$/.test(value))
  );
}

function manifestTemplate(id) {
  const template = errorCodeManifest.fallback_templates?.find((item) => item.id === id);
  if (!template) throw new Error(`Error-code manifest lacks fallback template: ${id}`);
  return template;
}

function materializeManifestCode(templateId, variables) {
  const definition = manifestTemplate(templateId);
  const code = definition.template.replace(/\{([a-z_]+)\}/g, (_, name) => {
    const value = variables[name];
    if (!value) {
      throw new Error(`Missing ${name} for error-code template ${templateId}`);
    }
    return value;
  });
  return {
    planned_code: code,
    code_status: definition.status,
  };
}

function codeSegment(value) {
  return value
    .replace(/^desktop-/, "")
    .replace(/[^a-z0-9]+/gi, ".")
    .replace(/^\.+|\.+$/g, "")
    .toLowerCase();
}

function frontendFallbackCode(owner) {
  return materializeManifestCode("frontend-surface-fallback", {
    surface: codeSegment(owner) || "common",
  });
}

function rustModuleFallbackCode(module) {
  return materializeManifestCode("rust-module-fallback", {
    module: codeSegment(module) || "common",
  });
}

function rawDiagnosticCode(owner) {
  return materializeManifestCode("raw-diagnostic-wrapper", {
    surface: codeSegment(owner) || "common",
  });
}

function commandFallbackCode(module, command) {
  return materializeManifestCode("tauri-command-fallback", {
    module: codeSegment(module) || "common",
    command: codeSegment(command) || "operation",
  });
}

function classifyDesktopTs(path, value, context) {
  const owner = desktopOwner(path);
  const combined = `${context} ${value}`;
  if (/\\documentclass|\\begin\{document\}|^#(?:set|show)\s|^---\n|^#\s+\w/m.test(value)) {
    return {
      classification: "user-content",
      planned_code: "",
      review_basis: "manual-user-content-boundary",
    };
  }
  if (
    path === "src/lib/tool-catalog.ts" &&
    (/property:category/.test(context) ||
      /^(?:Convert|Validate|Tables|Research)$/.test(value))
  ) {
    return {
      classification: "structured-code-then-translate",
      planned_code: "tools.category_id",
      review_basis: "manual-display-value-identity-rule",
    };
  }
  if (/^property:group$/.test(context) && !path.startsWith("src/contributions/")) {
    return {
      classification: "developer-only",
      planned_code: "",
      review_basis: "deterministic-code-identity-rule",
    };
  }
  if (
    path === "packages/ai-core/src/providers.ts" &&
    /^(?:property:name|property:id|property:provider|property:model)$/.test(context)
  ) {
    return {
      classification: "developer-only",
      planned_code: "",
      review_basis: "manual-model-identity-rule",
    };
  }
  if (path.startsWith("packages/ai-tools/")) {
    return {
      classification: "developer-only",
      planned_code: "",
      review_basis: "manual-ai-protocol-boundary",
    };
  }
  if (
    /^(?:\/[a-z0-9][a-z0-9-]*|[⌘⇧⌥⌃↵]+)$/i.test(value) &&
    /property:hint/.test(context)
  ) {
    return {
      classification: "developer-only",
      planned_code: "",
      review_basis: "manual-command-identity-rule",
    };
  }
  if (
    /(?:system prompt|tool protocol|respond with|return only|you are an ai|prompt template)/i.test(
      combined,
    ) &&
    !errorContextPattern.test(context)
  ) {
    return {
      classification: "developer-only",
      planned_code: "",
      review_basis: "manual-ai-protocol-boundary",
    };
  }
  if (developerContextPattern.test(context)) {
    return {
      classification: "developer-only",
      planned_code: "",
      review_basis: "deterministic-code-identity-rule",
    };
  }
  if (looksLikeProtocolIdentity(value) || looksLikeCssUtilityToken(value)) {
    return {
      classification: "developer-only",
      planned_code: "",
      review_basis: looksLikeCssUtilityToken(value)
        ? "deterministic-style-token-rule"
        : "deterministic-protocol-rule",
    };
  }
  if (errorContextPattern.test(context)) {
    if (rawDiagnosticPattern.test(combined)) {
      return {
        classification: "third-party/raw-diagnostic",
        ...rawDiagnosticCode(owner),
        review_basis: "manual-raw-diagnostic-rule",
      };
    }
    return {
      classification: "structured-code-then-translate",
      ...frontendFallbackCode(owner),
      review_basis: "manual-error-surface-rule",
    };
  }
  if (visibleContextPattern.test(context)) {
    const reviewBasis = /aria-|alt|title|placeholder/i.test(context)
      ? "manual-accessibility-rule"
      : /keywords/i.test(context)
        ? "manual-search-keyword-rule"
        : path.includes("/tours/")
          ? "manual-tour-rule"
          : path.startsWith("src/contributions/")
            ? "manual-registry-rule"
            : path.includes("/settings/") || path === "src/store/settings.ts"
              ? "manual-settings-rule"
              : "deterministic-visible-copy-rule";
    return {
      classification: "translate",
      planned_code: "",
      review_basis: reviewBasis,
    };
  }
  if (/\s/.test(value) && /[A-Za-z]{2}/.test(value) && context === "jsx-expression") {
    return {
      classification: "translate",
      planned_code: "",
      review_basis: "deterministic-visible-copy-rule",
    };
  }
  return {
    classification: "developer-only",
    planned_code: "",
    review_basis: "heuristic-code-rule",
  };
}

function scriptKindFor(path) {
  if (path.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (path.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (path.endsWith(".js") || path.endsWith(".mjs")) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function scanTsFile(repository, absolutePath) {
  const path = repoPath(repository, absolutePath);
  const text = sourceText(absolutePath, repository);
  const source = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(path),
  );
  const owner = desktopOwner(path);
  const surface = desktopSurface(path);

  const recordLiteral = (node, value, kind) => {
    const context = nodeContext(node);
    if (shouldSkipTsLiteral(value, node, context)) return;
    const location = source.getLineAndCharacterOfPosition(node.getStart(source));
    const classification = classifyDesktopTs(path, value, context);
    addEntry({
      repository: repository.id,
      path,
      line: location.line + 1,
      column: location.character + 1,
      surface,
      kind,
      context,
      owner,
      value,
      ...classification,
    });
  };

  const recordRawErrorFlow = (node, expression) => {
    const location = source.getLineAndCharacterOfPosition(node.getStart(source));
    const diagnosticBoundary =
      /(?:packages\/(?:ai-tools|preview)\/|src\/components\/ErrorBoundary|src\/store\/compile|src\/features\/ask-ai-compile-errors|src\/lib\/(?:ai-context|log)|src\/components\/ai\/chat-parts)/.test(
        path,
      );
    const planned = diagnosticBoundary
      ? rawDiagnosticCode(owner)
      : frontendFallbackCode(owner);
    addEntry({
      repository: repository.id,
      path,
      line: location.line + 1,
      column: location.character + 1,
      surface,
      kind: "raw-error-flow",
      context: "dynamic-error-to-visible-string",
      classification: diagnosticBoundary
        ? "third-party/raw-diagnostic"
        : "structured-code-then-translate",
      owner,
      ...planned,
      review_basis: "manual-frontend-raw-error-rule",
      value: expression,
    });
  };

  const visit = (node) => {
    if (ts.isTemplateExpression(node)) {
      const value = node
        .getText(source)
        .replace(/\$\{[\s\S]*?\}/g, "{{expression}}")
        .replace(/^`|`$/g, "");
      recordLiteral(node, value, "template-expression");
      for (const span of node.templateSpans) visit(span.expression);
      return;
    }
    if (ts.isJsxText(node)) {
      recordLiteral(node, node.getText(source).replace(/\s+/g, " ").trim(), "jsx-text");
      return;
    }
    if (ts.isStringLiteralLike(node)) {
      recordLiteral(node, node.text, ts.isNoSubstitutionTemplateLiteral(node) ? "template" : "string");
      return;
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(source);
      if (
        callee === "String" &&
        node.arguments.length > 0 &&
        /(?:^|[.(])(?:e|err|error|retryError|searchError|providerError)(?:$|[.)])/i.test(
          node.arguments[0].getText(source),
        )
      ) {
        recordRawErrorFlow(node, node.getText(source));
      }
      if (
        /(?:^|\.)toLocale(?:String|DateString|TimeString)$/.test(callee) ||
        /^Intl\.(?:DateTimeFormat|RelativeTimeFormat|NumberFormat|ListFormat|PluralRules|DisplayNames)$/.test(
          callee,
        )
      ) {
        const location = source.getLineAndCharacterOfPosition(node.getStart(source));
        addEntry({
          repository: repository.id,
          path,
          line: location.line + 1,
          column: location.character + 1,
          surface,
          kind: "formatter-call",
          context: callee,
          classification: "translate",
          owner,
          planned_code: "",
          review_basis: "manual-formatter-rule",
          value: node.getText(source),
        });
      }
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === "message" &&
      /(?:^|[.(])(?:e|err|error|retryError|searchError|providerError)(?:$|[.)])/i.test(
        node.expression.getText(source),
      )
    ) {
      recordRawErrorFlow(node, node.getText(source));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

function quotedSegments(line) {
  const segments = [];
  const pattern = /(["'`])((?:\\.|(?!\1).)*)\1/g;
  let match;
  while ((match = pattern.exec(line))) {
    segments.push({
      value: match[2],
      offset: match.index,
      quote: match[1],
    });
  }
  return segments;
}

function parseFrontmatterLine(line) {
  const match = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
  if (!match) return null;
  let value = match[2].trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return { key: match[1], value };
}

function stripMarkdown(line) {
  return line
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<https?:[^>]+>/g, "")
    .replace(/<\/?[A-Za-z][^>]*>/g, " ")
    .replace(/^[\s#>*+-]+/, "")
    .replace(/[`_*~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function scanMarkdown(repository, absolutePath, options) {
  const path = repoPath(repository, absolutePath);
  const text = sourceText(absolutePath, repository);
  const lines = text.split("\n");
  const owner = options.owner(path);
  const surface = options.surface(path);
  let inFrontmatter = lines[0]?.trim() === "---";
  let frontmatterClosed = !inFrontmatter;
  let inFence = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (index > 0 && inFrontmatter && line.trim() === "---") {
      inFrontmatter = false;
      frontmatterClosed = true;
      continue;
    }
    if (inFrontmatter) {
      const field = parseFrontmatterLine(line);
      if (!field || !field.value) continue;
      const translatable = /^(?:title|description|summary|category|tags|seoTitle|seoDescription)$/i.test(
        field.key,
      );
      addEntry({
        repository: repository.id,
        path,
        line: index + 1,
        column: 1,
        surface,
        kind: "content-frontmatter",
        context: `frontmatter:${field.key}`,
        classification: translatable ? options.copyClassification : "developer-only",
        owner,
        planned_code: "",
        review_basis: translatable
          ? "manual-public-metadata-rule"
          : "deterministic-content-identity-rule",
        value: field.value,
      });
      continue;
    }
    if (!frontmatterClosed) continue;

    const fence = line.match(/^\s*```([\w-]*)/);
    if (fence) {
      if (!inFence) {
        addEntry({
          repository: repository.id,
          path,
          line: index + 1,
          column: 1,
          surface,
          kind: "content-code-block",
          context: `fenced-code:${fence[1] || "plain"}`,
          classification: "developer-only",
          owner,
          planned_code: "",
          review_basis: "manual-code-example-boundary",
          value: `<fenced code block: ${fence[1] || "plain"}>`,
        });
      }
      inFence = !inFence;
      continue;
    }
    if (inFence || !line.trim()) continue;

    const imagePattern = /!\[([^\]]+)\]\([^)]*\)/g;
    let image;
    while ((image = imagePattern.exec(line))) {
      addEntry({
        repository: repository.id,
        path,
        line: index + 1,
        column: image.index + 1,
        surface,
        kind: "content-image-alt",
        context: "markdown-image-alt",
        classification: options.copyClassification,
        owner,
        planned_code: "",
        review_basis: "manual-public-accessibility-rule",
        value: image[1],
      });
    }

    const prose = stripMarkdown(line);
    if (!/[A-Za-z]{2}/.test(prose) || /^(?:import|export)\b/.test(prose)) continue;
    addEntry({
      repository: repository.id,
      path,
      line: index + 1,
      column: 1,
      surface,
      kind: "content-prose",
      context: /^#{1,6}\s/.test(line) ? "markdown-heading" : "markdown-prose",
      classification: options.copyClassification,
      owner,
      planned_code: "",
      review_basis: "manual-content-file-rule",
      value: prose,
    });
  }
}

function scanCssContent(repository, absolutePath, classification, owner, surface) {
  const path = repoPath(repository, absolutePath);
  const text = sourceText(absolutePath, repository);
  const pattern = /\bcontent\s*:\s*(["'])((?:\\.|(?!\1).)+)\1/g;
  let match;
  while ((match = pattern.exec(text))) {
    const location = lineAndColumn(text, match.index);
    addEntry({
      repository: repository.id,
      path,
      line: location.line,
      column: location.column,
      surface,
      kind: "css-generated-content",
      context: "css:content",
      classification,
      owner,
      planned_code: "",
      review_basis: "manual-css-content-rule",
      value: match[2],
    });
  }
}

function jsonFieldClassification(repositoryId, path, key) {
  if (/deadlines(?:-seed|-extra)?\.json$/.test(path)) {
    return {
      classification: /^(?:name|title|full_name|location|city|country|place|conf_date|note)$/i.test(
        key,
      )
        ? "third-party/raw-diagnostic"
        : "developer-only",
      owner: "desktop-deadlines",
      surface: "deadlines-data",
      review_basis: "manual-third-party-data-rule",
    };
  }
  if (path.includes("template") || path.endsWith("catalog.json")) {
    const categoryIdentity = /^category$/i.test(key);
    const metadata = /^(?:name|label|description)$/i.test(key);
    const attribution = /^(?:author|spdx|license)$/i.test(key);
    return {
      classification: categoryIdentity
        ? "structured-code-then-translate"
        : metadata
          ? "channel-specific"
          : "developer-only",
      owner: "desktop-templates",
      surface: "template-metadata",
      review_basis: categoryIdentity
        ? "manual-display-value-identity-rule"
        : metadata
          ? "manual-template-metadata-rule"
          : attribution
            ? "manual-template-attribution-rule"
            : "deterministic-template-identity-rule",
      planned_code: categoryIdentity ? "templates.category_id" : "",
    };
  }
  if (path.endsWith("font-packs.json")) {
    const metadata = /^(?:name|label|description)$/i.test(key);
    return {
      classification: metadata ? "translate" : "developer-only",
      owner: "desktop-assets",
      surface: "asset-metadata",
      review_basis: metadata
        ? "manual-asset-metadata-rule"
        : "deterministic-asset-identity-rule",
    };
  }
  if (path.endsWith("tauri.conf.json")) {
    const channel = /^(?:productName|title|shortDescription|longDescription)$/i.test(key);
    return {
      classification: channel ? "channel-specific" : "developer-only",
      owner: "release-engineering",
      surface: "installer-metadata",
      review_basis: channel
        ? "manual-installer-metadata-rule"
        : "deterministic-installer-code-rule",
    };
  }
  return {
    classification: "developer-only",
    owner: `${repositoryId}-core`,
    surface: "data",
    review_basis: "heuristic-json-rule",
  };
}

function parseJsonStringOccurrences(text) {
  JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  const occurrences = [];
  let index = text.charCodeAt(0) === 0xfeff ? 1 : 0;

  const fail = (message) => {
    const location = lineAndColumn(text, index);
    throw new Error(`${message} at ${location.line}:${location.column}`);
  };
  const skipWhitespace = () => {
    while (index < text.length && /\s/.test(text[index])) index += 1;
  };
  const readString = () => {
    if (text[index] !== '"') fail("Expected JSON string");
    const start = index;
    index += 1;
    while (index < text.length) {
      if (text[index] === "\\") {
        index += 2;
        continue;
      }
      if (text[index] === '"') {
        index += 1;
        const raw = text.slice(start, index);
        return { offset: start, value: JSON.parse(raw) };
      }
      index += 1;
    }
    fail("Unterminated JSON string");
  };
  const skipPrimitive = () => {
    const start = index;
    while (index < text.length && !/[\s,\]}]/.test(text[index])) index += 1;
    if (index === start) fail("Expected JSON value");
  };

  const parseValue = (arrayKey = null) => {
    skipWhitespace();
    if (text[index] === "{") {
      parseObject();
      return;
    }
    if (text[index] === "[") {
      parseArray(arrayKey);
      return;
    }
    if (text[index] === '"') {
      const token = readString();
      occurrences.push({
        ...token,
        key: arrayKey ?? "$root",
        kind: arrayKey ? "json-array-string" : "json-string-value",
      });
      return;
    }
    skipPrimitive();
  };

  const parseObject = () => {
    index += 1;
    skipWhitespace();
    if (text[index] === "}") {
      index += 1;
      return;
    }
    while (index < text.length) {
      skipWhitespace();
      const key = readString();
      skipWhitespace();
      if (text[index] !== ":") fail("Expected colon after JSON key");
      index += 1;
      skipWhitespace();
      if (text[index] === '"') {
        const value = readString();
        occurrences.push({
          ...value,
          key: key.value,
          kind: "json-string-field",
        });
      } else if (text[index] === "[") {
        parseArray(key.value);
      } else {
        parseValue();
      }
      skipWhitespace();
      if (text[index] === "}") {
        index += 1;
        return;
      }
      if (text[index] !== ",") fail("Expected comma between JSON properties");
      index += 1;
    }
    fail("Unterminated JSON object");
  };

  const parseArray = (arrayKey) => {
    index += 1;
    skipWhitespace();
    if (text[index] === "]") {
      index += 1;
      return;
    }
    while (index < text.length) {
      parseValue(arrayKey);
      skipWhitespace();
      if (text[index] === "]") {
        index += 1;
        return;
      }
      if (text[index] !== ",") fail("Expected comma between JSON array values");
      index += 1;
    }
    fail("Unterminated JSON array");
  };

  parseValue();
  skipWhitespace();
  if (index !== text.length) fail("Unexpected content after JSON document");
  return occurrences;
}

function scanJson(repository, absolutePath) {
  const path = repoPath(repository, absolutePath);
  const text = sourceText(absolutePath, repository);
  for (const occurrence of parseJsonStringOccurrences(text)) {
    const result = jsonFieldClassification(repository.id, path, occurrence.key);
    const location = lineAndColumn(text, occurrence.offset);
    addEntry({
      repository: repository.id,
      path,
      line: location.line,
      column: location.column,
      kind: occurrence.kind,
      context: `json:${occurrence.key}`,
      value: occurrence.value,
      planned_code: result.planned_code ?? "",
      ...result,
    });
  }
}

function scanStarterSource(repository, absolutePath, owner, surface) {
  const path = repoPath(repository, absolutePath);
  const text = sourceText(absolutePath, repository);
  addEntry({
    repository: repository.id,
    path,
    line: 1,
    column: 1,
    surface,
    kind: "starter-document",
    context: `source:${extname(path).slice(1) || "text"}`,
    classification: "user-content",
    owner,
    planned_code: "",
    review_basis: "manual-starter-content-boundary",
    value: `<starter document content: ${Buffer.byteLength(text, "utf8")} bytes>`,
  });
}

function productionRustText(text) {
  const testModule = text.search(/^\s*#\[cfg\(test\)\]\s*$/m);
  return testModule >= 0 ? text.slice(0, testModule) : text;
}

function decodeRustCookedString(value) {
  let decoded = "";
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== "\\") {
      decoded += value[index];
      continue;
    }
    const escape = value[index + 1];
    if (escape === "\n" || (escape === "\r" && value[index + 2] === "\n")) {
      index += escape === "\r" ? 2 : 1;
      while (index + 1 < value.length && /[ \t\r\n]/.test(value[index + 1])) index += 1;
      continue;
    }
    if (escape === "x" && /^[0-9a-f]{2}$/i.test(value.slice(index + 2, index + 4))) {
      decoded += String.fromCharCode(Number.parseInt(value.slice(index + 2, index + 4), 16));
      index += 3;
      continue;
    }
    if (escape === "u" && value[index + 2] === "{") {
      const close = value.indexOf("}", index + 3);
      const hex = close >= 0 ? value.slice(index + 3, close).replaceAll("_", "") : "";
      if (/^[0-9a-f]{1,6}$/i.test(hex)) {
        decoded += String.fromCodePoint(Number.parseInt(hex, 16));
        index = close;
        continue;
      }
    }
    const simple = {
      "0": "\0",
      n: "\n",
      r: "\r",
      t: "\t",
      "\\": "\\",
      '"': '"',
      "'": "'",
    };
    decoded += Object.hasOwn(simple, escape) ? simple[escape] : escape ?? "\\";
    index += 1;
  }
  return decoded;
}

function rustStringSegments(text) {
  const segments = [];
  let index = 0;

  const atIdentifierBoundary = (offset) =>
    offset === 0 || !/[A-Za-z0-9_]/.test(text[offset - 1]);
  const skipLineComment = () => {
    const newline = text.indexOf("\n", index + 2);
    index = newline < 0 ? text.length : newline + 1;
  };
  const skipBlockComment = () => {
    const start = index;
    let depth = 1;
    index += 2;
    while (index < text.length && depth > 0) {
      if (text.startsWith("/*", index)) {
        depth += 1;
        index += 2;
      } else if (text.startsWith("*/", index)) {
        depth -= 1;
        index += 2;
      } else {
        index += 1;
      }
    }
    if (depth > 0) throw new Error(`Unterminated Rust block comment at offset ${start}`);
  };
  const skipCharacterLiteral = () => {
    const start = index;
    let cursor = index + 1;
    if (cursor >= text.length || text[cursor] === "\n") return false;
    if (text[cursor] === "\\") {
      cursor += text[cursor + 1] === "u" && text[cursor + 2] === "{"
        ? Math.max(2, text.indexOf("}", cursor + 3) - cursor + 1)
        : 2;
    } else {
      const codePoint = text.codePointAt(cursor);
      cursor += codePoint > 0xffff ? 2 : 1;
    }
    if (text[cursor] !== "'") return false;
    index = cursor + 1;
    return index > start;
  };
  const rawPrefix = () => {
    if (!atIdentifierBoundary(index)) return null;
    let cursor = index;
    let byte = false;
    if ((text[cursor] === "b" || text[cursor] === "c") && text[cursor + 1] === "r") {
      byte = true;
      cursor += 1;
    }
    if (text[cursor] !== "r") return null;
    cursor += 1;
    let hashes = 0;
    while (text[cursor] === "#") {
      hashes += 1;
      cursor += 1;
    }
    if (text[cursor] !== '"') return null;
    return { byte, hashes, quote: cursor };
  };
  const cookedPrefix = () => {
    if (text[index] === '"') return { byte: false, quote: index };
    if (
      atIdentifierBoundary(index) &&
      (text[index] === "b" || text[index] === "c") &&
      text[index + 1] === '"'
    ) {
      return { byte: true, quote: index + 1 };
    }
    return null;
  };

  while (index < text.length) {
    if (text.startsWith("//", index)) {
      skipLineComment();
      continue;
    }
    if (text.startsWith("/*", index)) {
      skipBlockComment();
      continue;
    }
    if (text[index] === "'" && skipCharacterLiteral()) continue;

    const raw = rawPrefix();
    if (raw) {
      const start = index;
      const contentStart = raw.quote + 1;
      const delimiter = `"${"#".repeat(raw.hashes)}`;
      const close = text.indexOf(delimiter, contentStart);
      if (close < 0) throw new Error(`Unterminated Rust raw string at offset ${start}`);
      segments.push({
        value: text.slice(contentStart, close),
        offset: start,
        end: close + delimiter.length,
        byte: raw.byte,
        raw: true,
      });
      index = close + delimiter.length;
      continue;
    }

    const cooked = cookedPrefix();
    if (cooked) {
      const start = index;
      let cursor = cooked.quote + 1;
      let closed = false;
      while (cursor < text.length) {
        if (text[cursor] === "\\") {
          cursor += 2;
          continue;
        }
        if (text[cursor] === '"') {
          const encoded = text.slice(cooked.quote + 1, cursor);
          segments.push({
            value: decodeRustCookedString(encoded),
            offset: start,
            end: cursor + 1,
            byte: cooked.byte,
            raw: false,
          });
          index = cursor + 1;
          closed = true;
          break;
        }
        cursor += 1;
      }
      if (!closed) throw new Error(`Unterminated Rust string at offset ${start}`);
      continue;
    }
    index += 1;
  }
  return segments;
}

function rustModule(path) {
  return path.replace(/^src-tauri\/src\//, "").replace(/\.rs$/, "").replace(/\//g, ".");
}

function rustClassification(path, text, segment) {
  const before = text.slice(Math.max(0, segment.offset - 240), segment.offset);
  const after = text.slice(segment.end, Math.min(text.length, segment.end + 160));
  const context = `${before} ${after}`;
  const module = rustModule(path);
  const owner = `desktop-rust-${module.replace(/\./g, "-")}`;

  if (
    /\\documentclass|\\begin\{document\}|#set\s|#show\s|^---\n|^#\s+\w/m.test(
      segment.value,
    )
  ) {
    return {
      classification: "user-content",
      context: "rust-starter-content",
      planned_code: "",
      review_basis: "manual-user-content-boundary",
      owner,
    };
  }
  if (segment.byte) {
    return {
      classification: "developer-only",
      context: "rust-byte-or-c-string",
      planned_code: "",
      review_basis: "deterministic-rust-byte-string-rule",
      owner,
    };
  }
  if (looksLikeProtocolIdentity(segment.value) || looksLikeRustCodeIdentity(segment.value)) {
    return {
      classification: "developer-only",
      context: "rust-code-or-protocol",
      planned_code: "",
      review_basis: "deterministic-rust-protocol-rule",
      owner,
    };
  }
  if (path.endsWith("/menu.rs") && /MenuItem|Submenu|CheckMenuItem/.test(context)) {
    return {
      classification: "translate",
      context: "native-menu-copy",
      planned_code: "",
      review_basis: "manual-native-menu-rule",
      owner,
    };
  }
  if (/eprintln!|println!|tracing::|debug!|warn!|expect\(/.test(context)) {
    return {
      classification: "developer-only",
      context: "rust-log-or-invariant",
      planned_code: "",
      review_basis: "manual-rust-log-rule",
      owner,
    };
  }
  if (/stderr|stdout|compile|pandoc|tectonic|typst|git\s|upstream|response/.test(context.toLowerCase())) {
    return {
      classification: "third-party/raw-diagnostic",
      context: "rust-raw-diagnostic",
      ...rawDiagnosticCode(owner),
      review_basis: "manual-rust-raw-diagnostic-rule",
      owner,
    };
  }
  if (/Err\(|map_err|ok_or|Error::new|return\s+Err/.test(context)) {
    return {
      classification: "structured-code-then-translate",
      context: "rust-string-error",
      ...rustModuleFallbackCode(module),
      review_basis: "manual-rust-error-rule",
      owner,
    };
  }
  return {
    classification: "developer-only",
    context: "rust-code-or-protocol",
    planned_code: "",
    review_basis: "heuristic-rust-code-rule",
    owner,
  };
}

function registeredTauriCommands(libText) {
  const handler = libText.match(/tauri::generate_handler!\[([\s\S]*?)\]\)/);
  if (!handler) return new Set();
  return new Set(
    [...handler[1].matchAll(/(?:^|,)\s*(?:[A-Za-z_]\w*::)*([A-Za-z_]\w*)\s*(?=,|$)/gm)].map(
      (match) => match[1],
    ),
  );
}

function extractRustBoundaries(repository, absolutePath, text, registered) {
  const path = repoPath(repository, absolutePath);
  const marker = /#\[tauri::command(?:\([^\]]*\))?\]/g;
  let match;
  while ((match = marker.exec(text))) {
    const tail = text.slice(match.index + match[0].length);
    const functionMatch = tail.match(
      /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)\s*\(/,
    );
    if (!functionMatch) continue;
    const command = functionMatch[1];
    const functionOffset = match.index + match[0].length + functionMatch.index;
    const openParen = text.indexOf("(", functionOffset);
    let depth = 0;
    let closeParen = -1;
    for (let index = openParen; index < text.length; index += 1) {
      if (text[index] === "(") depth += 1;
      if (text[index] === ")") {
        depth -= 1;
        if (depth === 0) {
          closeParen = index;
          break;
        }
      }
    }
    if (closeParen < 0) continue;
    const bodyOpen = text.indexOf("{", closeParen);
    if (bodyOpen < 0) continue;
    const returnSlice = text.slice(closeParen + 1, bodyOpen).replace(/\s+/g, " ").trim();
    const returnType = returnSlice.startsWith("->")
      ? returnSlice.slice(2).replace(/\s+where\s+.*$/, "").trim()
      : "()";
    const module = rustModule(path);
    const location = lineAndColumn(text, match.index);
    const rawStringResult = /^Result\s*</.test(returnType) && /,\s*String\s*>/.test(returnType);
    const rawPolicy =
      /compile|synctex|latex|pandoc|git_diff|git_show/.test(`${module}.${command}`)
        ? "Preserve exact tool detail and add localized framing"
        : /citation|literature|github|ollama|template_packs/.test(`${module}.${command}`)
          ? "Log upstream detail and show a localized service message"
          : "Log the raw cause with a trace ID and show localized product copy";
    const planned = rawStringResult ? commandFallbackCode(module, command) : {};
    rustBoundaries.push({
      repository: repository.id,
      path,
      line: location.line,
      command,
      registered: registered.has(command) ? "yes" : "no",
      return_type: returnType,
      raw_string_result: rawStringResult ? "yes" : "no",
      classification: rawStringResult ? "structured-code-then-translate" : "developer-only",
      owner: `desktop-rust-${module.replace(/\./g, "-")}`,
      planned_code: "",
      code_status: "",
      ...planned,
      raw_detail_policy: rawStringResult ? rawPolicy : "No string error contract detected",
    });
  }
}

function scanRust(repository, absolutePath, registered) {
  const path = repoPath(repository, absolutePath);
  const original = sourceText(absolutePath, repository);
  const text = productionRustText(original);
  extractRustBoundaries(repository, absolutePath, text, registered);
  for (const segment of rustStringSegments(text)) {
    if (!segment.value.trim() || !/[A-Za-z]{2}/.test(segment.value)) continue;
    const location = lineAndColumn(text, segment.offset);
    const result = rustClassification(path, text, segment);
    addEntry({
      repository: repository.id,
      path,
      line: location.line,
      column: location.column,
      surface: `rust-${rustModule(path)}`,
      kind: "rust-string",
      value: segment.value,
      ...result,
    });
  }
}

function scanReleaseWorkflow(repository, absolutePath) {
  const path = repoPath(repository, absolutePath);
  const text = sourceText(absolutePath, repository);
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    for (const segment of quotedSegments(line)) {
      if (!/[A-Za-z]{2}/.test(segment.value)) continue;
      const endUser =
        /releaseName/.test(line) || /Downloads:|installer below/.test(segment.value);
      addEntry({
        repository: repository.id,
        path,
        line: index + 1,
        column: segment.offset + 1,
        surface: "release-metadata",
        kind: "release-workflow-string",
        context: endUser ? "release-user-copy" : "release-automation",
        classification: endUser ? "channel-specific" : "developer-only",
        owner: "release-engineering",
        planned_code: "",
        review_basis: endUser
          ? "manual-release-channel-rule"
          : "deterministic-release-automation-rule",
        value: segment.value,
      });
    }
  }
}

function scanHtmlMetadata(repository, absolutePath) {
  const path = repoPath(repository, absolutePath);
  const text = sourceText(absolutePath, repository);
  const title = /<title>([\s\S]*?)<\/title>/i.exec(text);
  if (title) {
    const location = lineAndColumn(text, title.index);
    addEntry({
      repository: repository.id,
      path,
      line: location.line,
      column: location.column,
      surface: "desktop-shell-metadata",
      kind: "html-metadata",
      context: "html:title",
      classification: "channel-specific",
      owner: "release-engineering",
      planned_code: "",
      review_basis: "manual-installer-metadata-rule",
      value: title[1],
    });
  }
}

function scanDesktop(repository) {
  const tsFiles = [
    ...listFiles(join(repository.root, "src"), (path) => /\.[cm]?[jt]sx?$/.test(path)),
    ...listFiles(join(repository.root, "packages"), (path) => /\.[cm]?[jt]sx?$/.test(path)),
  ].filter((path) => !isTestPath(repoPath(repository, path)) && !path.endsWith(".d.ts"));
  for (const path of tsFiles) scanTsFile(repository, path);

  const cssFiles = [
    ...listFiles(join(repository.root, "src"), (path) => path.endsWith(".css")),
    ...listFiles(join(repository.root, "packages"), (path) => path.endsWith(".css")),
  ];
  for (const path of cssFiles) {
    const relativePath = repoPath(repository, path);
    scanCssContent(
      repository,
      path,
      "translate",
      desktopOwner(relativePath),
      desktopSurface(relativePath),
    );
  }

  const libText = readFileSync(join(repository.root, "src-tauri", "src", "lib.rs"), "utf8");
  const registered = registeredTauriCommands(libText);
  const rustFiles = listFiles(
    join(repository.root, "src-tauri", "src"),
    (path) => path.endsWith(".rs"),
  );
  for (const path of rustFiles) scanRust(repository, path, registered);

  const desktopJson = [
    join(repository.root, "src-tauri", "tauri.conf.json"),
    ...listFiles(
      join(repository.root, "src-tauri", "resources"),
      (path) => path.endsWith(".json"),
    ),
  ].filter(existsSync);
  for (const path of desktopJson) scanJson(repository, path);

  const bundledSources = listFiles(
    join(repository.root, "src-tauri", "resources", "templates"),
    (path) => /\.(?:tex|typ|md|bib)$/.test(path),
  );
  for (const path of bundledSources) {
    scanStarterSource(repository, path, "desktop-templates", "template-starter-content");
  }

  const changelog = join(repository.root, "CHANGELOG.md");
  if (existsSync(changelog)) {
    scanMarkdown(repository, changelog, {
      owner: () => "release-engineering",
      surface: () => "release-notes",
      copyClassification: "channel-specific",
    });
  }
  const releaseWorkflow = join(repository.root, ".github", "workflows", "release.yml");
  if (existsSync(releaseWorkflow)) scanReleaseWorkflow(repository, releaseWorkflow);
  const htmlEntry = join(repository.root, "index.html");
  if (existsSync(htmlEntry)) scanHtmlMetadata(repository, htmlEntry);
}

function countBy(rows, field) {
  return Object.fromEntries(
    [...rows.reduce((counts, row) => {
      const key = row[field] || "(none)";
      counts.set(key, (counts.get(key) ?? 0) + 1);
      return counts;
    }, new Map())].sort(([left], [right]) => left.localeCompare(right)),
  );
}

function fingerprint(repository) {
  const paths = [...scannedFiles.get(repository.id)].sort();
  const hash = createHash("sha256");
  for (const path of paths) {
    hash.update(path);
    hash.update("\0");
    hash.update(readFileSync(join(repository.root, path)));
    hash.update("\0");
  }
  return {
    files: paths.length,
    source_sha256: hash.digest("hex"),
  };
}

function tsvEscape(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/[\u0000-\u001f]/g, (control) => {
      if (control === "\t") return "\\t";
      if (control === "\r") return "\\r";
      if (control === "\n") return "\\n";
      return `\\u${control.charCodeAt(0).toString(16).padStart(4, "0")}`;
    });
}

function serializeTsv(rows, columns) {
  return `${columns.join("\t")}\n${rows
    .map((row) => columns.map((column) => tsvEscape(row[column])).join("\t"))
    .join("\n")}\n`;
}

function validateErrorCodeManifest() {
  assert.equal(errorCodeManifest.schema_version, 1);
  assert.equal(errorCodeManifest.scope, "desktop");
  const allowed = new Set(errorCodeManifest.allowed_statuses);
  assert(allowed.has("semantic"));
  const semanticCodes = errorCodeManifest.semantic_codes ?? [];
  const templates = errorCodeManifest.fallback_templates ?? [];
  assert.equal(new Set(semanticCodes.map((item) => item.code)).size, semanticCodes.length);
  assert.equal(new Set(templates.map((item) => item.id)).size, templates.length);
  for (const item of semanticCodes) {
    assert.equal(item.status, "semantic");
    assert.match(item.code, /^[a-z][a-z0-9_.]+$/);
  }
  for (const item of templates) {
    assert(allowed.has(item.status), `Unknown manifest status for ${item.id}`);
    assert.notEqual(item.status, "semantic");
    assert.equal(item.replacement_required, true);
    assert.match(item.template, /^[a-z][a-z0-9_.{}]+$/);
  }
}

function runParserUnitTests() {
  const jsonFixture =
    '{"outer":{"title":"Inline\\nTitle","license":{"spdx":"MIT","author":"Oleafly"}},"tags":["one","two"],"rows":[{"title":"Nested"}]}';
  const jsonRows = parseJsonStringOccurrences(jsonFixture);
  assert.deepEqual(
    jsonRows.map(({ key, kind, value }) => ({ key, kind, value })),
    [
      { key: "title", kind: "json-string-field", value: "Inline\nTitle" },
      { key: "spdx", kind: "json-string-field", value: "MIT" },
      { key: "author", kind: "json-string-field", value: "Oleafly" },
      { key: "tags", kind: "json-array-string", value: "one" },
      { key: "tags", kind: "json-array-string", value: "two" },
      { key: "title", kind: "json-string-field", value: "Nested" },
    ],
  );
  const author = jsonRows.find((row) => row.key === "author");
  assert.deepEqual(lineAndColumn(jsonFixture, author.offset), {
    line: 1,
    column: jsonFixture.indexOf('"Oleafly"') + 1,
  });

  const rustFixture = String.raw`
fn fixture() {
  let continued = "first\
      second";
  let raw = r##"raw " quote # content"##;
  let bytes = b"bytes\x20ok";
  let raw_bytes = br#"byte raw"#;
  // "ignored line comment"
  /* "ignored block comment" /* r#"ignored nested"# */ */
  intervening_call();
  let after = "after \"quote\"";
  let lifetime = 'a';
  let borrowed: &'static str = "lifetime safe";
}`;
  const rustRows = rustStringSegments(rustFixture);
  assert.deepEqual(
    rustRows.map((row) => row.value),
    [
      "firstsecond",
      'raw " quote # content',
      "bytes ok",
      "byte raw",
      'after "quote"',
      "lifetime safe",
    ],
  );
  assert.equal(rustRows.filter((row) => row.byte).length, 2);
  assert(rustRows.every((row) => !row.value.includes("intervening_call")));
  assert.equal(rustRows[0].offset, rustFixture.indexOf('"first'));

  const stableFixture = {
    repository: "desktop",
    path: "src/example.ts",
    line: 10,
    column: 4,
    kind: "string",
    context: "jsx-text",
    value: "Visible copy",
  };
  assert.equal(stableId(stableFixture, 0), stableId({ ...stableFixture, line: 40 }, 0));
  const everyC0 = Array.from({ length: 0x20 }, (_, code) => String.fromCharCode(code)).join("");
  assert.equal(
    [...tsvEscape(everyC0)].some((character) => character.charCodeAt(0) < 0x20),
    false,
  );

  assert.equal(
    classifyDesktopTs("packages/ai-core/src/providers.ts", "GPT-4o", "property:name")
      .classification,
    "developer-only",
  );
  assert.equal(
    classifyDesktopTs(
      "packages/diagram/src/DiagramCanvas.tsx",
      "Show compiled preview",
      "jsx-attribute:label",
    ).classification,
    "translate",
  );
  assert.equal(
    classifyDesktopTs("packages/editor/src/math-preview.ts", "var(--destructive)", "property:errorColor")
      .classification,
    "developer-only",
  );
  assert.equal(
    classifyDesktopTs(
      "packages/editor/src/search-panel.ts",
      "Find and replace",
      "dom-attribute:aria-label",
    ).classification,
    "translate",
  );
  assert.equal(
    classifyDesktopTs(
      "packages/preflight/src/pdf-rules.ts",
      "pdf-metadata-extraction-failed",
      "property:id",
    ).classification,
    "developer-only",
  );
  assert.equal(
    classifyDesktopTs(
      "packages/ai-tools/src/research-tools.ts",
      "query must not be empty",
      "property:error",
    ).classification,
    "developer-only",
  );
  const visibleError = classifyDesktopTs(
    "packages/diagram/src/DiagramComposer.tsx",
    "Could not save the diagram",
    "call:toast.error:arg0",
  );
  assert.equal(visibleError.classification, "structured-code-then-translate");
  assert.equal(visibleError.code_status, "fallback-surface");
  assert.doesNotMatch(visibleError.planned_code, /\.[0-9a-f]{6}$/);
}

function assertSourceRegressions(rows) {
  const matching = (path, value) =>
    rows.filter((row) => row.path === path && row.value === value);
  const expectClassification = (path, value, classification) => {
    const matches = matching(path, value);
    assert(matches.length > 0, `Missing regression occurrence: ${path} -> ${value}`);
    assert(
      matches.some((row) => row.classification === classification),
      `Expected ${classification}: ${path} -> ${value}`,
    );
  };
  const expectJsonPosition = (path, value) => {
    const matches = matching(path, value);
    assert.equal(matches.length, 1, `Expected one JSON occurrence: ${path} -> ${value}`);
    const text = readFileSync(join(desktopRoot, path), "utf8");
    const offset = text.indexOf(JSON.stringify(value));
    assert(offset >= 0, `Could not resolve JSON source token: ${path} -> ${value}`);
    const expected = lineAndColumn(text, offset);
    assert.equal(matches[0].line, expected.line);
    assert.equal(matches[0].column, expected.column);
  };

  expectClassification(
    "packages/ai-core/src/providers.ts",
    "GPT-4o",
    "developer-only",
  );
  expectClassification(
    "packages/diagram/src/DiagramCanvas.tsx",
    "Show compiled preview",
    "translate",
  );
  assert.equal(
    matching("packages/diagram/src/DiagramCanvas.tsx", "bg-white/15").length,
    0,
    "CSS utility token must not enter the inventory",
  );
  expectClassification(
    "packages/editor/src/math-preview.ts",
    "var(--destructive)",
    "developer-only",
  );
  expectClassification(
    "packages/editor/src/search-panel.ts",
    "Find and replace",
    "translate",
  );
  expectClassification(
    "packages/editor/src/search-panel.ts",
    "No results",
    "translate",
  );
  expectClassification(
    "packages/preflight/src/pdf-rules.ts",
    "pdf-metadata-extraction-failed",
    "developer-only",
  );
  expectClassification(
    "src-tauri/resources/deadlines-seed.json",
    "AAAI 2027",
    "third-party/raw-diagnostic",
  );
  expectClassification(
    "src-tauri/resources/deadlines-seed.json",
    "Montréal, Québec, Canada",
    "third-party/raw-diagnostic",
  );
  expectClassification(
    "src-tauri/resources/deadlines-extra.json",
    "SPIE Photonics West 2027",
    "third-party/raw-diagnostic",
  );
  expectClassification(
    "src-tauri/resources/templates/acm/template.json",
    "Association for Computing Machinery (acmart class)",
    "developer-only",
  );
  expectClassification(
    "src-tauri/resources/templates/acm/template.json",
    "LPPL-1.3c",
    "developer-only",
  );
  expectJsonPosition("src-tauri/resources/deadlines-seed.json", "AAAI 2027");
  expectJsonPosition(
    "src-tauri/resources/deadlines-extra.json",
    "SPIE Photonics West 2027",
  );
  expectJsonPosition(
    "src-tauri/resources/templates/acm/template.json",
    "Association for Computing Machinery (acmart class)",
  );
}

function validateInventory(rows, boundaries) {
  assert.equal(new Set(rows.map((row) => row.id)).size, rows.length, "Occurrence IDs must be unique");
  const allowedStatuses = new Set(errorCodeManifest.allowed_statuses);
  for (const row of rows) {
    if (row.planned_code.startsWith("errors.")) {
      assert(row.code_status, `Missing code status for ${row.path}:${row.line}`);
      assert(allowedStatuses.has(row.code_status), `Unknown code status: ${row.code_status}`);
      assert.doesNotMatch(
        row.planned_code,
        /\.[0-9a-f]{6}$/,
        `English-text hash remains in ${row.planned_code}`,
      );
    }
  }
  for (const boundary of boundaries) {
    if (boundary.raw_string_result === "yes") {
      assert.equal(boundary.code_status, "fallback-command");
    }
  }
  const commandFallbacks = boundaries.filter(
    (boundary) => boundary.registered === "yes" && boundary.raw_string_result === "yes",
  );
  assert.equal(
    new Set(commandFallbacks.map((boundary) => boundary.planned_code)).size,
    commandFallbacks.length,
    "Registered Tauri fallback codes must be unique",
  );
}

validateErrorCodeManifest();
runParserUnitTests();

for (const repository of repositories) {
  if (!existsSync(repository.root)) continue;
  if (repository.id === "desktop") scanDesktop(repository);
}

entries.sort(
  (left, right) =>
    left.repository.localeCompare(right.repository) ||
    left.path.localeCompare(right.path) ||
    left.line - right.line ||
    left.column - right.column ||
    left.kind.localeCompare(right.kind) ||
    left.id.localeCompare(right.id),
);
rustBoundaries.sort(
  (left, right) =>
    left.path.localeCompare(right.path) ||
    left.line - right.line ||
    left.command.localeCompare(right.command),
);

assertSourceRegressions(entries);
validateInventory(entries, rustBoundaries);

const availableRepositories = repositories.filter((repository) => existsSync(repository.root));
const missingRepositories = repositories
  .filter((repository) => !existsSync(repository.root))
  .map((repository) => ({
    repository: repository.id,
  }));
const registeredStringBoundaries = rustBoundaries.filter(
  (boundary) => boundary.registered === "yes" && boundary.raw_string_result === "yes",
);
const missingBoundaryCodes = registeredStringBoundaries.filter(
  (boundary) => !boundary.owner || !boundary.planned_code || !boundary.code_status,
);

const summary = {
  generator_version: GENERATOR_VERSION,
  artifact_policy: "regenerable-review-baseline",
  classifications: CLASSIFICATIONS,
  total_occurrences: entries.length,
  counts: {
    by_classification: countBy(entries, "classification"),
    by_repository: countBy(entries, "repository"),
    by_surface: countBy(entries, "surface"),
    by_kind: countBy(entries, "kind"),
    by_review_basis: countBy(entries, "review_basis"),
  },
  rust_error_boundaries: {
    total_tauri_commands: rustBoundaries.length,
    registered_commands: rustBoundaries.filter((boundary) => boundary.registered === "yes").length,
    registered_string_error_contracts: registeredStringBoundaries.length,
    registered_string_error_contracts_without_owner_or_code: missingBoundaryCodes.length,
  },
  repositories: availableRepositories.map((repository) => ({
    repository: repository.id,
    ...fingerprint(repository),
  })),
  error_code_manifest: {
    schema_version: errorCodeManifest.schema_version,
    review_status: errorCodeManifest.review_status,
    sha256: sha256(errorCodeManifestSource),
  },
  missing_repositories: missingRepositories,
};

const inventoryColumns = [
  "id",
  "repository",
  "path",
  "line",
  "column",
  "surface",
  "kind",
  "context",
  "classification",
  "owner",
  "planned_code",
  "code_status",
  "review_basis",
  "value",
];
const boundaryColumns = [
  "repository",
  "path",
  "line",
  "command",
  "registered",
  "return_type",
  "raw_string_result",
  "classification",
  "owner",
  "planned_code",
  "code_status",
  "raw_detail_policy",
];
const outputs = new Map([
  [
    join(outputRoot, "string-inventory.tsv"),
    serializeTsv(entries, inventoryColumns),
  ],
  [
    join(outputRoot, "rust-error-boundaries.tsv"),
    serializeTsv(rustBoundaries, boundaryColumns),
  ],
  [
    join(outputRoot, "string-inventory-summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
  ],
]);

function validateTsv(content, columns, label) {
  assert(!content.includes("\0"), `${label} contains a literal NUL`);
  for (const character of content) {
    const code = character.charCodeAt(0);
    assert(
      code >= 0x20 || character === "\t" || character === "\n",
      `${label} contains unescaped C0 control U+${code.toString(16).padStart(4, "0")}`,
    );
  }
  const lines = content.slice(0, -1).split("\n");
  assert.equal(lines[0], columns.join("\t"));
  for (let index = 1; index < lines.length; index += 1) {
    assert.equal(
      lines[index].split("\t").length,
      columns.length,
      `${label} row ${index + 1} has an invalid column count`,
    );
  }
}

validateTsv(outputs.get(join(outputRoot, "string-inventory.tsv")), inventoryColumns, "string inventory");
validateTsv(
  outputs.get(join(outputRoot, "rust-error-boundaries.tsv")),
  boundaryColumns,
  "Rust boundary inventory",
);

if (selfTestOnly) {
  console.log(
    `Localization inventory self-test passed: ${entries.length} occurrences, ${rustBoundaries.length} Tauri command boundaries`,
  );
} else if (checkOnly) {
  const mismatches = [];
  for (const [path, expected] of outputs) {
    if (!existsSync(path) || readFileSync(path, "utf8") !== expected) {
      mismatches.push(normalizePath(relative(desktopRoot, path)));
    }
  }
  if (mismatches.length) {
    console.error(`Localization inventory is stale: ${mismatches.join(", ")}`);
    process.exit(1);
  }
  if (missingBoundaryCodes.length) {
    console.error(
      `${missingBoundaryCodes.length} registered string error boundaries lack an owner or planned code`,
    );
    process.exit(1);
  }
  console.log(
    `Localization inventory is current: ${entries.length} occurrences, ${registeredStringBoundaries.length} registered string error contracts`,
  );
} else {
  mkdirSync(outputRoot, { recursive: true });
  for (const [path, content] of outputs) writeFileSync(path, content);
  console.log(
    `Wrote ${entries.length} occurrences and ${rustBoundaries.length} Tauri command boundaries to ${normalizePath(relative(desktopRoot, outputRoot))}`,
  );
}

if (printSummary) {
  console.log(JSON.stringify(summary, null, 2));
}
