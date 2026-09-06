import { test, expect } from "../fixtures";
import { createBlankProject, openProject } from "../helpers";

test("view mode segmented control switches source/split/pdf", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await tauriPage.click('[aria-label="PDF View"]');
  await expect(tauriPage.locator('[aria-label="PDF View"]')).toHaveAttribute("aria-pressed", "true");
  await tauriPage.click('[aria-label="Source View"]');
  await expect(tauriPage.locator('[aria-label="Source View"]')).toHaveAttribute("aria-pressed", "true");
  await tauriPage.click('[aria-label="Split View"]');
  await expect(tauriPage.locator('[aria-label="Split View"]')).toHaveAttribute("aria-pressed", "true");
});

test("inline project rename commits and reverts", async ({ tauriPage }, testInfo) => {
  const projectName = `E2E Rename ${Date.now().toString(36)}`;
  const renamedProjectName = `${projectName} Renamed`;
  await createBlankProject(tauriPage, projectName);
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await tauriPage.click('[data-testid="project-title"]');
  await tauriPage.fill('[aria-label="Project name"]', renamedProjectName);
  await tauriPage.click('[aria-label="Save name"]');
  try {
    await expect(tauriPage.getByText(renamedProjectName)).toBeVisible({ timeout: 10_000 });
  } catch (error) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        tauriPage.evaluate(`import("/src/store/files.ts").then(({ useFilesStore }) => {
          const describe = (el) => {
            const rect = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            return {
              tag: el.tagName, testId: el.getAttribute('data-testid'), text: el.textContent.slice(0, 160),
              hidden: el.hidden, ariaHidden: el.getAttribute('aria-hidden'), inert: el.inert,
              display: style.display, visibility: style.visibility, opacity: style.opacity, overflow: style.overflow,
              rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            };
          };
          const matches = Array.from(document.querySelectorAll('*')).filter(el => {
            const text = el.children.length && el.querySelector('*:not(br):not(wbr)')
              ? Array.from(el.childNodes).filter(node => node.nodeType === 3).map(node => node.textContent).join('')
              : el.textContent;
            return text.includes(${JSON.stringify(renamedProjectName)});
          });
          const nodes = [...document.querySelectorAll('[data-testid="project-title"], [data-testid="project-title"] span'), ...matches.slice(0, 8)];
          return {
            viewport: { width: innerWidth, height: innerHeight }, projectName: useFilesStore.getState().projectName,
            matchCount: matches.length, firstMatch: matches[0] ? describe(matches[0]) : null,
            nodes: nodes.map(el => {
              const ancestors = [];
              for (let parent = el.parentElement; parent && ancestors.length < 10; parent = parent.parentElement) ancestors.push(describe(parent));
              return { ...describe(el), ancestors };
            }),
          };
        })`).then((data) => testInfo.attach("renamed-project-title-state", {
          body: JSON.stringify(data, null, 2), contentType: "application/json",
        })),
        new Promise<void>((resolve) => { timer = setTimeout(resolve, 1500); }),
      ]);
    } catch {
    } finally {
      clearTimeout(timer);
    }
    throw error;
  }
  await tauriPage.click('[data-testid="project-title"]');
  await tauriPage.fill('[aria-label="Project name"]', projectName);
  await tauriPage.click('[aria-label="Save name"]');
  await expect(tauriPage.getByText(projectName, { exact: true })).toBeVisible({ timeout: 10_000 });
});

test("export menu lists the document formats", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await tauriPage.focus('[aria-label="Export"]');
  await tauriPage.press('[aria-label="Export"]', "Enter");
  await expect(tauriPage.getByText("Export source (.zip)")).toBeVisible();
  await expect(tauriPage.getByText("Export as PDF")).toBeVisible();
  await expect(tauriPage.getByText("Export as Word (.docx)")).toBeVisible();
  await expect(tauriPage.getByText("Export as Markdown (.md)")).toBeVisible();
  // Close via the backdrop; actual exports open native save dialogs (manual).
  await tauriPage.press('[aria-label="Export"]', "Enter");
});

test("back to library and reopen", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await tauriPage.click('[title="Back to library"]');
  await expect(tauriPage.getByTestId("library")).toBeVisible();
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
});
