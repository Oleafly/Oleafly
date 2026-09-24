import { renderDiagram } from "/src/components/ui/mermaid-diagram";
import { runAdHocConverter } from "/src/features/ad-hoc-converters";
import { mermaidExportSource, standaloneMermaidSvg } from "/src/features/mermaid-export";
import { prepareHarnessI18n } from "./harness-i18n";

const SVG_NS = "http://www.w3.org/2000/svg";

async function inspectPng(base64: string) {
  const image = new Image();
  image.src = `data:image/png;base64,${base64}`;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas is unavailable");
  context.drawImage(image, 0, 0);
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  let darkPixels = 0;
  for (let index = 0; index < data.length; index += 4) {
    if (data[index] + data[index + 1] + data[index + 2] < 384) darkPixels += 1;
  }
  return { width: canvas.width, height: canvas.height, darkPixels };
}

async function exportMermaid(source: string) {
  try {
    const result = await runAdHocConverter("mermaid-to-latex", { text: source, file: null });
    const file = result.files[0];
    const png = file?.dataBase64 ? await inspectPng(file.dataBase64) : null;
    return { path: file?.path ?? null, text: result.text, png };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

async function exportedLabels(source: string) {
  const diagram = await renderDiagram(mermaidExportSource(source), "light");
  const root = new DOMParser().parseFromString(standaloneMermaidSvg(diagram, source).svg, "image/svg+xml")
    .documentElement;
  const labels = Array.from(root.getElementsByTagNameNS(SVG_NS, "text")).map((text) =>
    text.children.length > 0
      ? Array.from(text.children).map((row) => row.textContent ?? "")
      : [text.textContent ?? ""],
  );
  return {
    role: root.getAttribute("aria-roledescription"),
    labels,
    bold: root.querySelectorAll('tspan[font-weight="bold"]').length,
    subscripts: root.querySelectorAll('tspan[baseline-shift="sub"]').length,
  };
}

async function onScreenForeignObjects(source: string) {
  const svg = await renderDiagram(source, "light");
  return svg.getElementsByTagNameNS(SVG_NS, "foreignObject").length;
}

await prepareHarnessI18n();
Object.assign(window, { exportMermaid, exportedLabels, onScreenForeignObjects });
document.body.dataset.fixtureState = "mounted";
