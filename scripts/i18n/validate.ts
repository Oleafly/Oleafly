import {
  validateCatalog,
  validateSourceCatalog,
  type CatalogIssue,
} from "../../packages/i18n-contract/src/catalog.ts";
import {
  listLocales,
  listNamespaces,
  readContext,
  readFlatCatalog,
  readGlossary,
  SOURCE_LOCALE,
} from "./lib/fs.ts";

const localeFlag = process.argv.indexOf("--locale");
const onlyLocale = localeFlag >= 0 ? process.argv[localeFlag + 1] : null;
const glossary = readGlossary();
const issues: CatalogIssue[] = [];
const namespaces = listNamespaces(SOURCE_LOCALE);
const sources = new Map(namespaces.map((ns) => [ns, readFlatCatalog(SOURCE_LOCALE, ns)]));

for (const [ns, source] of sources) {
  issues.push(...validateSourceCatalog(ns, SOURCE_LOCALE, source, {}));
  for (const key of readContext(ns).keys()) {
    if (!source.has(key)) {
      issues.push({ level: "error", locale: SOURCE_LOCALE, namespace: ns, key, message: "context entry has no source key" });
    }
  }
}

for (const locale of listLocales()) {
  if (locale === SOURCE_LOCALE || (onlyLocale && locale !== onlyLocale)) continue;
  const present = new Set(listNamespaces(locale));
  for (const [ns, source] of sources) {
    if (!present.has(ns)) {
      issues.push({ level: "error", locale, namespace: ns, key: "*", message: "namespace file is missing" });
      continue;
    }
    issues.push(...validateCatalog(ns, locale, source, readFlatCatalog(locale, ns), { doNotTranslate: glossary.doNotTranslate }));
  }
  for (const ns of present) {
    if (!sources.has(ns)) {
      issues.push({ level: "error", locale, namespace: ns, key: "*", message: "namespace has no English source" });
    }
  }
}

const errors = issues.filter((issue) => issue.level === "error");
const warnings = issues.filter((issue) => issue.level === "warning");
for (const issue of issues) {
  console.log(`${issue.level.toUpperCase()} ${issue.locale}/${issue.namespace} ${issue.key}: ${issue.message}`);
}
console.log(`i18n validate: ${errors.length} errors, ${warnings.length} warnings across ${namespaces.length} namespaces`);
process.exit(errors.length > 0 ? 1 : 0);
