import { test, expect } from "../fixtures";
import {
  createBlankProject,
  openProject,
  openRailTab,
  waitLong,
  type Page,
} from "../helpers";

// The native bridge cannot drive a real <input type="file"> file picker, so
// this exercises the same parse-by-extension + addCitations path the Import
// Reference Library dialog uses, through the DEV-only
// window.__importCitationFile hook (src/features/citation.ts).

const RIS = `TY  - JOUR
AU  - Smith, Jane
TI  - A RIS Import Paper
T2  - Journal of Things
PY  - 2021
DO  - 10.1000/e2e-ris
ER  -
`;

const ENDNOTE_XML = `<?xml version="1.0"?>
<xml>
<records>
<record>
  <ref-type name="Journal Article">17</ref-type>
  <contributors>
    <authors>
      <author>Doe, Jane</author>
    </authors>
  </contributors>
  <titles>
    <title>An EndNote Import Paper</title>
    <secondary-title>Journal of Notes</secondary-title>
  </titles>
  <dates>
    <year>2022</year>
  </dates>
  <electronic-resource-num>10.1000/e2e-endnote</electronic-resource-num>
</record>
</records>
</xml>
`;

async function importCitationFile(page: { evaluate<T>(e: string): Promise<T> }, name: string, text: string) {
  return page.evaluate<{ imported: number; duplicates: number; errors: string[] } | { error: string }>(
    `window.__importCitationFile(${JSON.stringify(name)}, ${JSON.stringify(text)})`,
  );
}

test("importing a RIS file adds a citation to the project's .bib, deduping a repeat import by DOI", async ({
  tauriPage,
}) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await openRailTab(tauriPage, "Research Assistant");

  const hookReady = await tauriPage.evaluate<boolean>(
    `typeof window.__importCitationFile === "function"`,
  );
  expect(hookReady, "__importCitationFile devtools hook must be present").toBe(true);

  const first = await importCitationFile(tauriPage, "refs.ris", RIS);
  expect("error" in first ? first.error : undefined).toBeUndefined();
  expect((first as { imported: number }).imported).toBe(1);

  const second = await importCitationFile(tauriPage, "refs.ris", RIS);
  expect((second as { imported: number; duplicates: number }).imported).toBe(0);
  expect((second as { imported: number; duplicates: number }).duplicates).toBe(1);
});

test("importing EndNote XML and BibTeX both land in the same library, RDF and unknown extensions are rejected", async ({
  tauriPage,
}) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await openRailTab(tauriPage, "Research Assistant");

  const endnoteResult = await importCitationFile(tauriPage, "refs.xml", ENDNOTE_XML);
  expect((endnoteResult as { imported: number }).imported).toBe(1);

  const bibResult = await importCitationFile(
    tauriPage,
    "refs.bib",
    `@article{e2ebib2023,\n  title = {A BibTeX Import Paper},\n  author = {Kim, Sam},\n  year = {2023}\n}\n`,
  );
  expect((bibResult as { imported: number }).imported).toBe(1);

  const unknown = await importCitationFile(tauriPage, "refs.txt", "not a citation file");
  expect((unknown as { error: string }).error).toContain("Unrecognized file type");

  const emptyRdf = await importCitationFile(tauriPage, "empty.rdf", "<rdf:RDF></rdf:RDF>");
  expect((emptyRdf as { error: string }).error).toBe("No references found in that file.");
});

async function sourceTreePaths(page: Page): Promise<string[]> {
  return page.evaluate<string[]>(
    `(() => {
      const tree = document.querySelector('[aria-label="Source tree"]');
      if (!tree) return [];
      return Array.from(tree.querySelectorAll('[role="treeitem"]'))
        .map((row) => row.dataset.path)
        .filter((path) => typeof path === "string");
    })()`,
  );
}

test("importing into a project with no bibliography refreshes the tree and the Citations tab", async ({
  tauriPage,
}) => {
  test.setTimeout(180_000);
  const name = `Citation Refresh ${Date.now()}`;
  await createBlankProject(tauriPage, name);
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 60_000 });
  await openRailTab(tauriPage, "Source Tree");

  expect(await sourceTreePaths(tauriPage)).not.toContain("references.bib");

  const result = await importCitationFile(tauriPage, "library.ris", RIS);
  expect("error" in result ? result.error : undefined).toBeUndefined();
  expect((result as { imported: number }).imported).toBe(1);

  await waitLong(
    tauriPage,
    `(() => {
      const tree = document.querySelector('[aria-label="Source tree"]');
      if (!tree) return false;
      return Array.from(tree.querySelectorAll('[role="treeitem"]'))
        .some((row) => row.dataset.path === "references.bib");
    })()`,
    20_000,
  );

  await openRailTab(tauriPage, "References & citations (Shift-F12)");
  await waitLong(
    tauriPage,
    `!!document.querySelector('[aria-label^="Citations, "]')`,
    30_000,
  );
});
