import { expect, test, type Page } from "@playwright/test";

const BASE_URL = process.env.OLEAFLY_BROWSER_TEST_URL ?? "http://localhost:1420";

type Exported =
  | { path: string | null; text: string | null; png: { width: number; height: number; darkPixels: number } | null }
  | { error: string };

type ExportedLabels = { role: string | null; labels: string[][]; bold: number; subscripts: number };

type Harness = {
  exportMermaid(source: string): Promise<Exported>;
  exportedLabels(source: string): Promise<ExportedLabels>;
  onScreenForeignObjects(source: string): Promise<number>;
};

const MARKUP = /<\/?[a-z][^<>]*>|&(?:#\d+|#x[\da-f]+|[a-z][a-z\d]*);/i;

const INLINE_HTML_FLOWCHART = [
  "flowchart TD",
  '  subgraph S["<b>Lab</b> notes"]',
  '    A["<b>Water</b> is H<sub>2</sub>O"] --> B["quote #quot;hi#quot; and done&nbsp;now #35;1"]',
  "  end",
].join("\n");

const JOURNEY = [
  "journey",
  "  title Checkout",
  "  section Buy",
  "    Choose shipping option: 3: Me",
  "    Receive confirmation email: 5: Me",
].join("\n");

const SUBGRAPH_FLOWCHART = [
  "flowchart TD",
  "  subgraph S1[First stage]",
  "    a1[Collect data] --> a2[Clean data]",
  "  end",
  "  subgraph S2[Second stage]",
  "    b1[Train] --> b2[Evaluate]",
  "  end",
  "  a2 --> b1",
].join("\n");

const DIAGRAMS: Record<string, string> = {
  "a class diagram": [
    "classDiagram",
    "  class Animal {",
    "    <<abstract>>",
    "    +String name",
    "    +makeSound() void",
    "  }",
    "  Animal <|-- Dog",
    "  Dog : +fetch() bool",
  ].join("\n"),
  "a state diagram": [
    "stateDiagram-v2",
    "  [*] --> Draft",
    "  Draft --> Review: submit<br/>for review",
    "  state Accepted {",
    "    [*] --> Published",
    "  }",
    "  Review --> Accepted",
    "  Accepted --> [*]",
  ].join("\n"),
  "an entity relationship diagram": [
    "erDiagram",
    "  AUTHOR ||--o{ PAPER : writes",
    "  PAPER {",
    "    string doi PK",
    "    string title",
    "  }",
  ].join("\n"),
  "a mindmap": ["mindmap", "  root((Thesis))", "    Background", "      Prior work", "    Methods"].join("\n"),
  "a flowchart with subgraphs": SUBGRAPH_FLOWCHART,
  "a flowchart with line breaks": 'flowchart LR\n  A["Line one<br/>line two"] --> B[Middle] --> C["Tom &amp; Jerry"]',
  "a user journey": ["journey", "  title Working day", "  section Morning", "    Make tea: 5: Me"].join("\n"),
  "a flowchart that asks for HTML labels": [
    "---",
    "config:",
    "  htmlLabels: true",
    "  flowchart:",
    "    htmlLabels: true",
    "---",
    "flowchart TD",
    "  subgraph G[Group]",
    "    A[One<br/>two] --> B[Three]",
    "  end",
  ].join("\n"),
  "a flowchart with inline HTML and entity codes": INLINE_HTML_FLOWCHART,
  "a class diagram with an unreadable init directive": [
    "%%{init: {theme: dark}}%%",
    "classDiagram",
    "  class Animal",
    "  Animal <|-- Dog",
  ].join("\n"),
};

async function openHarness(page: Page) {
  await page.goto(`${BASE_URL}/e2e/mermaid-export-harness.html`);
  await expect(page.locator("body")).toHaveAttribute("data-fixture-state", "mounted");
}

test.describe("Mermaid to LaTeX image fallback", () => {
  for (const [name, source] of Object.entries(DIAGRAMS)) {
    test(`exports ${name} as a PNG`, async ({ page }) => {
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await openHarness(page);

      const result = await page.evaluate((text) => (window as unknown as Harness).exportMermaid(text), source);

      expect(result).not.toHaveProperty("error");
      expect(result).toMatchObject({ path: "assets/diagram.png" });
      if ("error" in result) return;
      expect(result.text).toContain("\\includegraphics[width=\\linewidth]{assets/diagram.png}");
      expect(result.png).not.toBeNull();
      expect(result.png?.width).toBeGreaterThan(100);
      expect(result.png?.height).toBeGreaterThan(60);
      expect(result.png?.darkPixels).toBeGreaterThan(200);
      expect(pageErrors).toEqual([]);
    });
  }

  test("writes inline HTML and entity codes in labels as formatted text", async ({ page }) => {
    await openHarness(page);
    const exported = await page.evaluate(
      (text) => (window as unknown as Harness).exportedLabels(text),
      INLINE_HTML_FLOWCHART,
    );

    const labels = exported.labels.map((rows) => rows.join(" "));
    expect(labels.filter((label) => MARKUP.test(label))).toEqual([]);
    expect(labels).toContain("Lab notes");
    expect(labels).toContain("Water is H2O");
    expect(labels.join(" ")).toContain('quote "hi" and done\u00a0now #1');
    expect(exported.bold).toBeGreaterThanOrEqual(2);
    expect(exported.subscripts).toBe(1);
  });

  test("wraps long journey tasks inside their boxes", async ({ page }) => {
    await openHarness(page);
    const exported = await page.evaluate((text) => (window as unknown as Harness).exportedLabels(text), JOURNEY);

    const task = exported.labels.find((rows) => rows.join(" ") === "Choose shipping option");
    expect(task?.length).toBeGreaterThan(1);
  });

  test("exports a diagram at the 50,000-character limit instead of Mermaid's size error", async ({ page }) => {
    await openHarness(page);
    const tail = '\n  "A" : 1\n  "B" : 2';
    const source = `pie title ${"t".repeat(50_000 - "pie title ".length - tail.length)}${tail}`;
    expect(source).toHaveLength(50_000);

    const exported = await page.evaluate((text) => (window as unknown as Harness).exportedLabels(text), source);

    expect(exported.role).toBe("pie");
  });

  test("keeps HTML labels in the on-screen render of a diagram that was exported", async ({ page }) => {
    await openHarness(page);
    const exported = await page.evaluate(
      (text) => (window as unknown as Harness).exportMermaid(text),
      SUBGRAPH_FLOWCHART,
    );
    expect(exported).toMatchObject({ path: "assets/diagram.png" });

    const foreignObjects = await page.evaluate(
      (text) => (window as unknown as Harness).onScreenForeignObjects(text),
      SUBGRAPH_FLOWCHART,
    );
    expect(foreignObjects).toBeGreaterThan(0);
  });
});
