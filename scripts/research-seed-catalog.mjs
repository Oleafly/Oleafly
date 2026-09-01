import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

/**
 * Reads the catalog straight out of the TypeScript source so the app and the
 * fixture tooling can never disagree about which projects exist.
 */
export function loadResearchSeedCatalog(repositoryRoot) {
  const catalogFile = join(repositoryRoot, "src", "developer", "research-seed-catalog.ts");
  const source = readFileSync(catalogFile, "utf8");
  const file = ts.createSourceFile(catalogFile, source, ts.ScriptTarget.ESNext, true);
  const declaration = file.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => [...statement.declarationList.declarations])
    .find((entry) => ts.isIdentifier(entry.name) && entry.name.text === "RESEARCH_SEED_PROJECTS");
  if (!declaration?.initializer) {
    throw new Error("Could not find RESEARCH_SEED_PROJECTS in the TypeScript catalog");
  }

  const readLiteral = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isNumericLiteral(node)) return Number(node.text);
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (node.kind === ts.SyntaxKind.NullKeyword) return null;
    if (ts.isArrayLiteralExpression(node)) return node.elements.map(readLiteral);
    if (ts.isAsExpression(node)) return readLiteral(node.expression);
    if (ts.isObjectLiteralExpression(node)) {
      return Object.fromEntries(
        node.properties.map((property) => {
          if (!ts.isPropertyAssignment(property)) {
            throw new Error(`Unsupported catalog property: ${property.getText(file)}`);
          }
          const key =
            ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
              ? property.name.text
              : null;
          if (!key) throw new Error(`Unsupported catalog key: ${property.name.getText(file)}`);
          return [key, readLiteral(property.initializer)];
        }),
      );
    }
    throw new Error(`Unsupported catalog value: ${node.getText(file)}`);
  };

  const catalog = readLiteral(declaration.initializer);
  if (!Array.isArray(catalog)) throw new Error("RESEARCH_SEED_PROJECTS must be an array");
  return catalog;
}

export function seedFixtureDir(repositoryRoot, project) {
  return join(repositoryRoot, "fixtures", "research-seeds", project.slug);
}

export function seedArchiveName(project) {
  return `${project.slug}.zip`;
}
