import { degrees, PDFDocument, PDFName, PDFNumber, StandardFonts } from "pdf-lib";
import { test, expect } from "../fixtures";
import {
  createBlankProject,
  expectDesktopShellAnchored,
  openProject,
} from "../helpers";

interface GeometryFixture {
  bytes: Uint8Array;
  expected: {
    firstMarker: ExpectedTextGeometry;
    rotatedMarker: ExpectedTextGeometry;
  };
}

interface ExpectedTextGeometry {
  baselineX: number;
  baselineY: number;
  advance: number;
  fontHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  rawX: number;
  rawY: number;
  rawPageWidth: number;
  rawPageHeight: number;
  angle: number;
  fontFamily: string;
  styleAscent: number | null;
  styleDescent: number | null;
  userUnit: number;
}

function expectCssSubpixel(
  actual: number,
  expected: number,
  context = "PDF CSS geometry",
): void {
  // WebKit exposes layout at 1/64 CSS-pixel increments, while TextLayer's
  // percentage positions are serialized to two decimal places.
  const delta = Math.abs(actual - expected);
  expect(
    delta,
    `${context}: expected ${expected}, received ${actual}, delta ${delta}`,
  ).toBeLessThanOrEqual(0.125);
}

async function expectedTextGeometry(
  bytes: Uint8Array,
  pageNumber: number,
  marker: string,
): Promise<ExpectedTextGeometry> {
  const { getDocument, Util } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = getDocument({ data: bytes.slice() });
  try {
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(pageNumber);
    try {
      const viewport = page.getViewport({ scale: 1 });
      const textContent = await page.getTextContent({
        includeMarkedContent: true,
        disableNormalization: true,
      });
      const item = textContent.items.find(
        (candidate) => "str" in candidate && candidate.str.includes(marker),
      );
      if (!item || !("str" in item)) {
        throw new Error(`Text item not found for ${marker}`);
      }
      const transform = Util.transform(viewport.transform, item.transform);
      const { pageWidth, pageHeight, pageX, pageY } = viewport.rawDims;
      const rawTransform = Util.transform(
        [1, 0, 0, -1, -pageX, pageY + pageHeight],
        item.transform,
      );
      const style = textContent.styles[item.fontName];
      let angle = Math.atan2(rawTransform[1], rawTransform[0]);
      if (style?.vertical) angle += Math.PI / 2;
      return {
        baselineX: transform[4],
        baselineY: transform[5],
        advance: item.width * viewport.scale * viewport.userUnit,
        fontHeight: item.height * viewport.scale * viewport.userUnit,
        viewportWidth: viewport.width,
        viewportHeight: viewport.height,
        rawX: rawTransform[4],
        rawY: rawTransform[5],
        rawPageWidth: pageWidth,
        rawPageHeight: pageHeight,
        angle,
        fontFamily: style?.fontFamily ?? "sans-serif",
        styleAscent: style?.ascent ?? null,
        styleDescent: style?.descent ?? null,
        userUnit: viewport.userUnit,
      };
    } finally {
      page.cleanup();
    }
  } finally {
    await loadingTask.destroy();
  }
}

async function expectedBrowserTextRect(
  page: Parameters<typeof openProject>[0],
  expected: ExpectedTextGeometry,
  scale: number,
  rotation: number,
  pageWidth: number,
  pageHeight: number,
): Promise<{ left: number; top: number; width: number; height: number }> {
  return page.evaluate<{
    left: number;
    top: number;
    width: number;
    height: number;
  }>(`(() => {
    const expected = ${JSON.stringify(expected)};
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas metrics unavailable');
    context.font = '30px ' + expected.fontFamily;
    const metrics = context.measureText('');
    const ascent = metrics.fontBoundingBoxAscent;
    const descent = Math.abs(metrics.fontBoundingBoxDescent);
    const ascentRatio = ascent
      ? ascent / (ascent + descent)
      : expected.styleAscent || (expected.styleDescent ? 1 + expected.styleDescent : 0.8);
    const rawFontHeight = expected.fontHeight / expected.userUnit;
    const fontAscent = rawFontHeight * ascentRatio;
    const rawLeft = expected.rawX + fontAscent * Math.sin(expected.angle);
    const rawTop = expected.rawY - fontAscent * Math.cos(expected.angle);
    const localWidth = ${rotation % 180 === 0 ? pageWidth : pageHeight};
    const localHeight = ${rotation % 180 === 0 ? pageHeight : pageWidth};
    const left = Number((100 * rawLeft / expected.rawPageWidth).toFixed(2)) / 100 * localWidth;
    const top = Number((100 * rawTop / expected.rawPageHeight).toFixed(2)) / 100 * localHeight;
    const totalScale = ${scale} * expected.userUnit;
    const width = expected.advance / expected.userUnit * totalScale;
    const height = rawFontHeight * totalScale;
    if (${rotation} === 90) {
      return {
        left: localHeight - top - height,
        top: left,
        width: height,
        height: width,
      };
    }
    return { left, top, width, height };
  })()`);
}

async function makeGeometryFixture(): Promise<GeometryFixture> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const first = document.addPage([612, 792]);
  first.drawText("Cross-span start ", { x: 72, y: 700, size: 16, font });
  first.drawText("continues here", { x: 202, y: 700, size: 16, font });
  first.drawText("and reaches another line", { x: 72, y: 670, size: 16, font });
  first.drawText("GEOMETRY PAGE ONE", { x: 72, y: 620, size: 13, font });

  const second = document.addPage([420, 600]);
  second.setRotation(degrees(90));
  second.node.set(PDFName.of("UserUnit"), PDFNumber.of(1.5));
  second.drawText("ROTATED USER UNIT PAGE", { x: 48, y: 520, size: 14, font });
  const bytes = await document.save({ useObjectStreams: false });
  return {
    bytes,
    expected: {
      firstMarker: await expectedTextGeometry(bytes, 1, "GEOMETRY PAGE ONE"),
      rotatedMarker: await expectedTextGeometry(bytes, 2, "ROTATED USER UNIT PAGE"),
    },
  };
}

async function makeSwitchFixture(marker: string, pageCount: number): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (let pageNumber = 0; pageNumber < pageCount; pageNumber++) {
    const page = document.addPage([612, 792]);
    page.drawText(`${marker} PAGE ${pageNumber + 1}`, { x: 72, y: 720, size: 15, font });
    for (let line = 0; line < 40; line++) {
      page.drawText(`${marker} deterministic line ${line + 1}`, {
        x: 72,
        y: 690 - line * 14,
        size: 9,
        font,
      });
    }
  }
  return document.save({ useObjectStreams: false });
}

function setPreviewPdfExpression(bytes: Uint8Array): string {
  const base64 = Buffer.from(bytes).toString("base64");
  return `Promise.all([
    import("/src/store/compile.ts"),
    import("/src/store/files.ts"),
    import("/src/store/project-analysis.ts"),
    import("/src/lib/compile-checkpoint.ts"),
  ]).then(async ([{ useCompileStore }, { useFilesStore }, { useProjectAnalysisStore }, checkpoint]) => {
    const binary = atob(${JSON.stringify(base64)});
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    // Activating a project publishes a null project id while the language
    // service swaps runtimes, which resets this store. A readiness check made
    // before this point can therefore be stale by the time the fixture lands,
    // so wait for analysis to name the open project rather than failing the
    // run on that window. The checkpoint below still refuses to install
    // against a project that analysis has not claimed.
    let files = useFilesStore.getState();
    let analysis = useProjectAnalysisStore.getState().snapshot;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (files.projectId && analysis.identity.projectId === files.projectId) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
      files = useFilesStore.getState();
      analysis = useProjectAnalysisStore.getState().snapshot;
    }
    if (!files.projectId || analysis.identity.projectId !== files.projectId) {
      throw new Error("Current project analysis is unavailable for the PDF fixture");
    }
    const previous = useCompileStore.getState().lastCompileCheckpoint;
    // Invalidate any open-project compile that is still between saveActive()
    // and its first status update. Without this, that late compile can replace
    // the deterministic fixture after it has been installed.
    useCompileStore.getState().reset();
    const verified = checkpoint.createCompileSuccessCheckpoint({
      projectId: files.projectId,
      mainDocument: files.mainDoc || "main.tex",
      projectRevision: analysis.identity.projectRevision,
      requestGeneration: (previous?.requestGeneration ?? 0) + 1,
      outputKind: "standard",
      producerId: "e2e-pdf-fixture",
      outputRevision: (previous?.outputRevision ?? 0) + 1,
      outputId: checkpoint.fingerprintCompileOutput(bytes),
      previousCompletedAt: previous?.completedAt ?? null,
    });
    useCompileStore.setState({
      pdfBytes: bytes,
      status: "success",
      phase: "idle",
      lastCompiledAt: verified.completedAt,
      lastCompileCheckpoint: verified,
    });
    return true;
  })`;
}

async function openOrCreateE2eDoc(page: Parameters<typeof openProject>[0]): Promise<void> {
  await expect(
    page.locator('[data-testid="library"][data-projects-loaded="true"]'),
  ).toBeVisible({ timeout: 30_000 });
  const projectExists = await page.evaluate<boolean>(
    `!!document.querySelector('button[aria-label="Open E2E Doc"]')`,
  );
  if (projectExists) {
    await openProject(page, "E2E Doc");
  } else {
    await createBlankProject(page, "E2E Doc");
  }
}

async function waitForCurrentProjectAnalysis(
  page: Parameters<typeof openProject>[0],
): Promise<void> {
  await page.waitForFunction(
    `Promise.all([
      import("/src/store/files.ts"),
      import("/src/store/project-analysis.ts"),
    ]).then(([{ useFilesStore }, { useProjectAnalysisStore }]) => {
      const projectId = useFilesStore.getState().projectId;
      const identity = useProjectAnalysisStore.getState().snapshot.identity;
      return !!projectId && identity.projectId === projectId;
    })`,
    30_000,
  );
}

test("clicking the PDF jumps to the word in the source", async ({ tauriPage }) => {
  test.setTimeout(180_000); // cold text-layer render can be slow
  await openOrCreateE2eDoc(tauriPage);
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await expect(tauriPage.getByTestId("compile-status")).toHaveAttribute("data-severity", "ok", {
    timeout: 90_000,
  });
  const probe = await tauriPage
    .waitForFunction(
      `Array.from(document.querySelectorAll('.textLayer')).some(t => (t.textContent || '').includes('Introduction'))`,
      30_000,
    )
    .then(() => "ok")
    .catch(() => "timeout");
  if (probe !== "ok") {
    const dump = await tauriPage.evaluate<string>(
      `JSON.stringify({
        canvases: document.querySelectorAll('.pdf-canvas').length,
        layers: Array.from(document.querySelectorAll('.textLayer')).map(t => (t.textContent || '').length),
        wraps: document.querySelectorAll('[data-page]').length,
        chip: document.querySelector('[data-testid="compile-status"]')?.getAttribute('data-severity'),
      })`,
    );
    throw new Error(`textLayer never got content: ${dump}`);
  }

  const target = tauriPage.locator(".textLayer span").filter({ hasText: "Introduction" });
  await target.scrollIntoViewIfNeeded();
  await target.click();

  await expect
    .poll(
      () =>
        tauriPage.evaluate<string>(
          `import("/src/components/editor/cm/controller.ts").then(({ getEditorView }) => {
            const view = getEditorView();
            if (!view) return "";
            const selection = view.state.selection.main;
            return view.state.sliceDoc(selection.from, selection.to);
          })`,
        ),
      { timeout: 15_000 },
    )
    .toBe("Introduction");
  await expectDesktopShellAnchored(tauriPage);
});

test("clicking after a non-collapsed PDF selection does not invoke inverse SyncTeX", async ({
  tauriPage,
}) => {
  test.setTimeout(180_000);
  await openOrCreateE2eDoc(tauriPage);
  await tauriPage.waitForFunction(
    `Array.from(document.querySelectorAll('.textLayer span')).some(
      (span) => span.textContent?.includes('Introduction')
    )`,
    30_000,
  );
  await tauriPage.evaluate(`import("/src/components/editor/cm/controller.ts").then(
    ({ getEditorView }) => {
      const view = getEditorView();
      if (!view) throw new Error("Editor is unavailable");
      view.dispatch({ selection: { anchor: 0 } });
      return true;
    }
  )`);
  await tauriPage.evaluate(`(() => {
    const span = Array.from(document.querySelectorAll('.textLayer span')).find(
      (candidate) => candidate.textContent?.includes('Introduction')
    );
    if (!(span instanceof HTMLElement)) throw new Error('Introduction span not found');
    const selection = document.getSelection();
    const range = document.createRange();
    range.selectNodeContents(span);
    selection?.removeAllRanges();
    selection?.addRange(range);
    span.click();
    return selection?.isCollapsed === false;
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 300));

  const editorSelection = await tauriPage.evaluate<{ from: number; to: number; text: string }>(
    `import("/src/components/editor/cm/controller.ts").then(({ getEditorView }) => {
      const view = getEditorView();
      if (!view) throw new Error("Editor is unavailable");
      const selection = view.state.selection.main;
      return {
        from: selection.from,
        to: selection.to,
        text: view.state.sliceDoc(selection.from, selection.to),
      };
    })`,
  );
  expect(editorSelection).toEqual({ from: 0, to: 0, text: "" });
});

test("PDF selection geometry is exact for mixed pages, rotation, UserUnit and transient zoom", async ({
  tauriPage,
}) => {
  test.setTimeout(180_000);
  await openOrCreateE2eDoc(tauriPage);
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  // Let the open-project compile settle before installing synthetic preview
  // bytes; otherwise its late result can legitimately replace this fixture.
  await tauriPage.waitForFunction(
    `import("/src/store/compile.ts").then(({ useCompileStore }) => {
      const state = useCompileStore.getState();
      return state.status === "success" && state.phase === "idle" && !!state.pdfBytes;
    })`,
    90_000,
  );
  await new Promise((resolve) => setTimeout(resolve, 300));
  await tauriPage.waitForFunction(
    `import("/src/store/compile.ts").then(({ useCompileStore }) =>
      useCompileStore.getState().status !== "compiling"
    )`,
    90_000,
  );
  await waitForCurrentProjectAnalysis(tauriPage);

  const fixture = await makeGeometryFixture();
  await tauriPage.evaluate(
    `(() => {
      Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 1.25 });
      return true;
    })()`,
  );
  await tauriPage.evaluate(setPreviewPdfExpression(fixture.bytes));
  try {
    await tauriPage.waitForFunction(
      `document.querySelector('[data-page="1"]')?.textContent?.includes('GEOMETRY PAGE ONE')`,
      30_000,
    );
  } catch (error) {
    const diagnostic = await tauriPage.evaluate<string>(`JSON.stringify((() => {
      const renderer = document.querySelector('[data-testid="pdf-renderer"]');
      const page = document.querySelector('[data-page="1"]');
      return {
        rendererState: renderer?.getAttribute('data-pdf-state'),
        rendererError: renderer?.getAttribute('data-pdf-error'),
        pageHtml: page?.innerHTML,
        pageStyle: page?.getAttribute('style'),
        pageText: page?.textContent,
        rasterScale: page?.getAttribute('data-pdf-raster-scale'),
        pageRect: page?.getBoundingClientRect().toJSON(),
        allPageText: Array.from(document.querySelectorAll('[data-page]')).map(
          (candidate) => candidate.textContent
        ),
      };
    })())`);
    const compileState = await tauriPage.evaluate<string>(
      `import("/src/store/compile.ts").then(({ useCompileStore }) => {
        const state = useCompileStore.getState();
        return JSON.stringify({
          status: state.status,
          phase: state.phase,
          byteLength: state.pdfBytes?.byteLength,
          lastCompiledAt: state.lastCompiledAt,
          log: state.log,
        });
      })`,
    );
    throw new Error(
      `${String(error)}; PDF page 1 diagnostic: ${diagnostic}; compile: ${compileState}`,
    );
  }

  await tauriPage.evaluate(`(() => {
    const trigger = document.querySelector('[aria-haspopup="menu"][aria-label^="Zoom "]');
    if (!(trigger instanceof HTMLElement)) throw new Error('Zoom menu trigger not found');
    trigger.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter',
      code: 'Enter',
    }));
    return true;
  })()`);
  await expect(tauriPage.getByRole("menu")).toBeVisible();
  await tauriPage.evaluate(`new Promise((resolve, reject) => {
    const item = Array.from(document.querySelectorAll('[role="menuitem"]')).find(
      (candidate) => candidate.textContent?.trim() === '100%'
    );
    if (!(item instanceof HTMLElement)) {
      reject(new Error('100% zoom menu item not found'));
      return;
    }
    item.click();
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  })`);
  // The bridge click changes the controlled zoom value but does not synthesize
  // Radix's pointer-up dismissal. Escape closes the popup and restores body
  // hit testing before the caret-at-point assertions below.
  await tauriPage.evaluate(`(() => {
    const menu = document.querySelector('[role="menu"]');
    menu?.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Escape',
      code: 'Escape',
    }));
    return true;
  })()`);
  await tauriPage.waitForFunction(
    `getComputedStyle(document.body).pointerEvents !== "none"`,
    5_000,
  );
  try {
    await tauriPage.waitForFunction(
      `(() => {
        const trigger = document.querySelector('[aria-label="Zoom 100 percent"]');
        const page = document.querySelector('[data-page="1"]');
        if (!(page instanceof HTMLElement) || !trigger) return false;
        const scaleFactor = Number(page.style.getPropertyValue('--scale-factor'));
        return Math.abs(scaleFactor - 1) <= Number.EPSILON
          && Math.abs(page.getBoundingClientRect().width - 612) <= 0.05;
      })()`,
      15_000,
    );
    await tauriPage.waitForFunction(
      `document.querySelector('[data-page="1"]')?.getAttribute('data-pdf-raster-scale') === "1"`,
      15_000,
    );
  } catch (error) {
    const diagnostic = await tauriPage.evaluate<string>(`JSON.stringify((() => {
      const trigger = document.querySelector('[aria-haspopup="menu"][aria-label^="Zoom "]');
      const page = document.querySelector('[data-page="1"]');
      return {
        triggerAriaLabel: trigger?.getAttribute('aria-label'),
        triggerText: trigger?.textContent,
        pageStyle: page?.getAttribute('style'),
        pageRect: page?.getBoundingClientRect().toJSON(),
        rasterScale: page?.getAttribute('data-pdf-raster-scale'),
        menuText: document.querySelector('[role="menu"]')?.textContent,
      };
    })())`);
    throw new Error(`${String(error)}; 100% zoom diagnostic: ${diagnostic}`);
  }

  // Inline when the toolbar fits, otherwise via the overflow menu's page
  // submenu. WebView2 lays the bar out wider than WebKit, so Windows collapses
  // at window sizes where Linux and macOS do not, and a direct click on the
  // inline control finds nothing there.
  const inlineNext = tauriPage.locator('[aria-label="Next page"]');
  if (await inlineNext.isVisible()) {
    await inlineNext.click();
  } else {
    await tauriPage.evaluate(
      `(() => {
        const trigger = document.querySelector('[aria-label="More preview controls"]');
        if (!(trigger instanceof HTMLElement)) return false;
        trigger.focus();
        trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        return true;
      })()`,
    );
    await tauriPage.waitForFunction(
      `[...document.querySelectorAll('[role="menuitem"]')].some(
        (el) => /^Page \\d+ of \\d+$/.test((el.textContent || "").trim()),
      )`,
      10_000,
    );
    await tauriPage.evaluate(
      `(() => {
        const trigger = [...document.querySelectorAll('[role="menuitem"]')].find(
          (el) => /^Page \\d+ of \\d+$/.test((el.textContent || "").trim()),
        );
        trigger?.click();
        return !!trigger;
      })()`,
    );
    await tauriPage.waitForFunction(
      `[...document.querySelectorAll('[role="menuitem"]')].some(
        (el) => (el.textContent || "").trim() === "Next page",
      )`,
      10_000,
    );
    await tauriPage.evaluate(
      `(() => {
        const item = [...document.querySelectorAll('[role="menuitem"]')].find(
          (el) => (el.textContent || "").trim() === "Next page",
        );
        item?.click();
        return !!item;
      })()`,
    );
    await tauriPage.evaluate(
      `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`,
    );
  }
  try {
    await tauriPage.waitForFunction(
      `document.querySelector('[data-page="2"]')?.textContent?.includes('ROTATED USER UNIT PAGE')`,
      30_000,
    );
  } catch (error) {
    const diagnostic = await tauriPage.evaluate<string>(`JSON.stringify((() => {
      const renderer = document.querySelector('[data-testid="pdf-renderer"]');
      const page = document.querySelector('[data-page="2"]');
      return {
        rendererState: renderer?.getAttribute('data-pdf-state'),
        rendererError: renderer?.getAttribute('data-pdf-error'),
        pageHtml: page?.innerHTML,
        pageStyle: page?.getAttribute('style'),
        pageText: page?.textContent,
        rasterScale: page?.getAttribute('data-pdf-raster-scale'),
        pageRect: page?.getBoundingClientRect().toJSON(),
        scrollRect: renderer?.parentElement?.getBoundingClientRect().toJSON(),
        scrollTop: renderer?.parentElement?.scrollTop,
      };
    })())`);
    throw new Error(`${String(error)}; PDF page 2 diagnostic: ${diagnostic}`);
  }

  type PageGeometry = {
    width: number;
    height: number;
    canvasWidth: number;
    canvasHeight: number;
    layerEdgeError: number;
    markerLeft: number;
    markerTop: number;
    markerRight: number;
    markerWidth: number;
    markerHeight: number;
    rasterScale: string;
    rotation: string;
    userUnit: string;
    roundX: string;
    roundY: string;
    markerScaleX: string;
    markerTransform: string;
    markerFontFamily: string;
    markerFontSize: string;
  };
  const inspectPages = `(() => {
    const inspect = (pageNumber, marker) => {
      const page = document.querySelector('[data-page="' + pageNumber + '"]');
      const canvas = page?.querySelector('.pdf-canvas');
      const layer = page?.querySelector('.textLayer');
      const span = Array.from(layer?.querySelectorAll('span') || []).find(
        (candidate) => (candidate.textContent || '').includes(marker)
      );
      if (!(page instanceof HTMLElement) || !(canvas instanceof HTMLCanvasElement) ||
          !(layer instanceof HTMLElement) || !(span instanceof HTMLElement)) {
        throw new Error('Missing geometry for page ' + pageNumber);
      }
      const pageRect = page.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      const layerRect = layer.getBoundingClientRect();
      const spanRect = span.getBoundingClientRect();
      const spanStyle = getComputedStyle(span);
      return {
        width: pageRect.width,
        height: pageRect.height,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        layerEdgeError: Math.max(
          Math.abs(layerRect.left - canvasRect.left),
          Math.abs(layerRect.top - canvasRect.top),
          Math.abs(layerRect.right - canvasRect.right),
          Math.abs(layerRect.bottom - canvasRect.bottom)
        ),
        markerLeft: spanRect.left - canvasRect.left,
        markerTop: spanRect.top - canvasRect.top,
        markerRight: spanRect.right - canvasRect.left,
        markerWidth: spanRect.width,
        markerHeight: spanRect.height,
        rasterScale: page.dataset.pdfRasterScale || '',
        rotation: page.dataset.pdfRotation || '',
        userUnit: page.dataset.pdfUserUnit || '',
        roundX: getComputedStyle(page).getPropertyValue('--scale-round-x').trim(),
        roundY: getComputedStyle(page).getPropertyValue('--scale-round-y').trim(),
        markerScaleX: span.style.getPropertyValue('--scale-x'),
        markerTransform: spanStyle.transform,
        markerFontFamily: spanStyle.fontFamily,
        markerFontSize: spanStyle.fontSize,
      };
    };
    return [
      inspect(1, 'GEOMETRY PAGE ONE'),
      inspect(2, 'ROTATED USER UNIT PAGE'),
    ];
  })()`;
  const baseline = await tauriPage.evaluate<PageGeometry[]>(inspectPages);

  expect(baseline[0].width).toBeCloseTo(612, 2);
  expect(baseline[0].height).toBeCloseTo(792, 2);
  expect(baseline[0].canvasWidth).toBe(765);
  expect(baseline[0].canvasHeight).toBe(990);
  expect(baseline[1].width).toBeCloseTo(900, 2);
  expect(baseline[1].height).toBeCloseTo(628, 2);
  expect(baseline[1].canvasWidth).toBe(1_125);
  expect(baseline[1].canvasHeight).toBe(785);
  expect(baseline[1].rotation).toBe("90");
  expect(baseline[1].userUnit).toBe("1.5");
  // These expectations come from pdf.js' PDF viewport multiplied by the text
  // item's transform, not from an earlier DOM measurement.
  const firstExpected = fixture.expected.firstMarker;
  const firstExpectedRect = await expectedBrowserTextRect(
    tauriPage,
    firstExpected,
    1,
    0,
    baseline[0].width,
    baseline[0].height,
  );
  expectCssSubpixel(baseline[0].markerLeft, firstExpected.baselineX);
  expectCssSubpixel(
    baseline[0].markerWidth,
    firstExpected.advance,
    `page 1 baseline marker width ${JSON.stringify(baseline[0])}`,
  );
  expectCssSubpixel(baseline[0].markerHeight, firstExpected.fontHeight);
  expectCssSubpixel(baseline[0].markerLeft, firstExpectedRect.left);
  expectCssSubpixel(baseline[0].markerTop, firstExpectedRect.top);
  expectCssSubpixel(baseline[0].markerWidth, firstExpectedRect.width);
  expectCssSubpixel(baseline[0].markerHeight, firstExpectedRect.height);
  const rotatedExpected = fixture.expected.rotatedMarker;
  const rotatedExpectedRect = await expectedBrowserTextRect(
    tauriPage,
    rotatedExpected,
    1,
    90,
    baseline[1].width,
    baseline[1].height,
  );
  // pdf.js intentionally rounds the CSS page down to the DPR denominator.
  // TextLayer emits percentage positions, so transform-space coordinates on
  // the rotated axis scale by the independently asserted 628/630 page ratio.
  const rotatedBaselineScaleY = 628 / rotatedExpected.viewportHeight;
  expectCssSubpixel(
    baseline[1].markerTop,
    rotatedExpected.baselineY * rotatedBaselineScaleY,
  );
  // Glyph dimensions use --total-scale-factor directly; only percentage
  // positions inherit the rounded page-axis ratio.
  expectCssSubpixel(
    baseline[1].markerHeight,
    rotatedExpected.advance,
    `page 2 baseline marker advance ${JSON.stringify(baseline[1])}`,
  );
  expectCssSubpixel(baseline[1].markerWidth, rotatedExpected.fontHeight);
  expectCssSubpixel(baseline[1].markerLeft, rotatedExpectedRect.left);
  expectCssSubpixel(baseline[1].markerTop, rotatedExpectedRect.top);
  expectCssSubpixel(baseline[1].markerWidth, rotatedExpectedRect.width);
  expectCssSubpixel(baseline[1].markerHeight, rotatedExpectedRect.height);
  for (const page of baseline) {
    expect(page.layerEdgeError).toBeLessThanOrEqual(0.05);
    expect(page.roundX).toBe("4px");
    expect(page.roundY).toBe("4px");
  }

  // A DOM hit test is only meaningful while the glyph is inside the viewport.
  // Scroll each mixed-geometry page into view, then ask WebKit for the caret at
  // the glyph's visual center. This verifies that pointer/caret coordinates
  // resolve to the same text item whose geometry was checked above.
  for (const [pageNumber, marker] of [
    [1, "GEOMETRY PAGE ONE"],
    [2, "ROTATED USER UNIT PAGE"],
  ] as const) {
    const hit = await tauriPage.evaluate<string>(`(async () => {
      const page = document.querySelector('[data-page="${pageNumber}"]');
      const span = Array.from(page?.querySelectorAll('.textLayer span') || []).find(
        (candidate) => candidate.textContent?.includes(${JSON.stringify(marker)})
      );
      if (!(page instanceof HTMLElement) || !(span instanceof HTMLElement)) {
        throw new Error('Missing marker for page ${pageNumber}');
      }
      span.scrollIntoView({ block: 'center', inline: 'center' });
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined)))
      );
      const rect = span.getBoundingClientRect();
      const range = document.caretRangeFromPoint?.(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2
      );
      return range?.startContainer.parentElement?.closest('.textLayer span')?.textContent || '';
    })()`);
    expect(hit).toContain(marker);
  }

  await tauriPage.evaluate(`(() => {
    const trigger = document.querySelector('[aria-haspopup="menu"][aria-label^="Zoom "]');
    if (!(trigger instanceof HTMLElement)) throw new Error('Zoom menu trigger not found');
    trigger.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter',
      code: 'Enter',
    }));
    return true;
  })()`);
  await expect(tauriPage.getByRole("menu")).toBeVisible();
  const transient = await tauriPage.evaluate<PageGeometry[]>(`(async () => {
    const item = Array.from(document.querySelectorAll('[role="menuitem"]')).find(
      (candidate) => candidate.textContent?.trim() === '200%'
    );
    if (!(item instanceof HTMLElement)) throw new Error('200% zoom item not found');
    item.click();
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    return ${inspectPages};
  })()`);

  expect(transient[0].rasterScale).toBe("1");
  expect(transient[1].rasterScale).toBe("1");
  expect(transient[0].width).toBeCloseTo(1_224, 2);
  expect(transient[0].height).toBeCloseTo(1_584, 2);
  expect(transient[1].width).toBeCloseTo(1_800, 2);
  expect(transient[1].height).toBeCloseTo(1_260, 2);
  for (let index = 0; index < transient.length; index++) {
    expect(transient[index].layerEdgeError).toBeLessThanOrEqual(0.05);
  }
  expectCssSubpixel(transient[0].markerLeft, firstExpected.baselineX * 2);
  expectCssSubpixel(
    transient[0].markerWidth,
    firstExpected.advance * 2,
    `page 1 transient marker width ${JSON.stringify(transient[0])}`,
  );
  const firstTransientRect = await expectedBrowserTextRect(
    tauriPage,
    firstExpected,
    2,
    0,
    transient[0].width,
    transient[0].height,
  );
  expectCssSubpixel(transient[0].markerLeft, firstTransientRect.left);
  expectCssSubpixel(transient[0].markerTop, firstTransientRect.top);
  expectCssSubpixel(transient[0].markerWidth, firstTransientRect.width);
  expectCssSubpixel(transient[0].markerHeight, firstTransientRect.height);
  const rotatedTransientScaleY = 1_260 / rotatedExpected.viewportHeight;
  expectCssSubpixel(
    transient[1].markerTop,
    rotatedExpected.baselineY * rotatedTransientScaleY,
  );
  expectCssSubpixel(
    transient[1].markerHeight,
    rotatedExpected.advance * 2,
    `page 2 transient marker advance ${JSON.stringify(transient[1])}`,
  );
  const rotatedTransientRect = await expectedBrowserTextRect(
    tauriPage,
    rotatedExpected,
    2,
    90,
    transient[1].width,
    transient[1].height,
  );
  expectCssSubpixel(transient[1].markerLeft, rotatedTransientRect.left);
  expectCssSubpixel(transient[1].markerTop, rotatedTransientRect.top);
  expectCssSubpixel(transient[1].markerWidth, rotatedTransientRect.width);
  expectCssSubpixel(transient[1].markerHeight, rotatedTransientRect.height);

  await tauriPage.waitForFunction(
    `document.querySelector('[data-page="1"]')?.dataset.pdfRasterScale === "2" &&
     document.querySelector('[data-page="2"]')?.dataset.pdfRasterScale === "2"`,
    30_000,
  );
  const crisp = await tauriPage.evaluate<PageGeometry[]>(inspectPages);
  expect(crisp[0].canvasWidth).toBe(1_530);
  expect(crisp[0].canvasHeight).toBe(1_980);
  expect(crisp[1].canvasWidth).toBe(2_250);
  expect(crisp[1].canvasHeight).toBe(1_575);
  for (let index = 0; index < crisp.length; index++) {
    expectCssSubpixel(crisp[index].markerLeft, transient[index].markerLeft);
    expectCssSubpixel(crisp[index].markerTop, transient[index].markerTop);
    expectCssSubpixel(crisp[index].markerWidth, transient[index].markerWidth);
    expectCssSubpixel(crisp[index].markerHeight, transient[index].markerHeight);
    expect(crisp[index].layerEdgeError).toBeLessThanOrEqual(0.05);
  }
});

test("superseded PDF work cannot restore stale text after a document switch", async ({
  tauriPage,
}) => {
  test.setTimeout(180_000);
  await openOrCreateE2eDoc(tauriPage);
  // A slow open-project compile must not replace the deterministic fixtures
  // while this test is measuring PDF lifecycle cancellation.
  await tauriPage.waitForFunction(
    `import("/src/store/compile.ts").then(({ useCompileStore }) => {
      const state = useCompileStore.getState();
      return state.status === "success" && state.phase === "idle" && !!state.pdfBytes;
    })`,
    90_000,
  );
  await new Promise((resolve) => setTimeout(resolve, 300));
  await tauriPage.waitForFunction(
    `import("/src/store/compile.ts").then(({ useCompileStore }) =>
      useCompileStore.getState().status !== "compiling"
    )`,
    90_000,
  );
  await waitForCurrentProjectAnalysis(tauriPage);
  const oldPdf = await makeSwitchFixture("STALE DOCUMENT", 12);
  const newPdf = await makeSwitchFixture("CURRENT DOCUMENT", 1);
  const oldExpression = setPreviewPdfExpression(oldPdf);
  const newExpression = setPreviewPdfExpression(newPdf);

  await tauriPage.evaluate(`(async () => {
    await ${oldExpression};
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    await ${newExpression};
    return true;
  })()`);
  try {
    await tauriPage.waitForFunction(
      `Array.from(document.querySelectorAll('.textLayer')).some(
        (layer) => layer.textContent?.includes('CURRENT DOCUMENT')
      )`,
      60_000,
    );
  } catch (error) {
    const diagnostic = await tauriPage.evaluate<string>(`JSON.stringify((() => {
      const renderer = document.querySelector('[data-testid="pdf-renderer"]');
      return {
        rendererState: renderer?.getAttribute('data-pdf-state'),
        rendererError: renderer?.getAttribute('data-pdf-error'),
        pageCount: document.querySelectorAll('[data-page]').length,
        textLayers: Array.from(document.querySelectorAll('.textLayer')).map(
          (layer) => layer.textContent || ''
        ),
      };
    })())`);
    throw new Error(`${String(error)}; switched PDF diagnostic: ${diagnostic}`);
  }
  await new Promise((resolve) => setTimeout(resolve, 500));

  const text = await tauriPage.evaluate<string>(
    `Array.from(document.querySelectorAll('.textLayer'))
      .map((layer) => layer.textContent || '')
      .join('\\n')`,
  );
  expect(text).toContain("CURRENT DOCUMENT");
  expect(text).not.toContain("STALE DOCUMENT");
});
