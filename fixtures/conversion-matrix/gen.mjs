// Regenerates the binary conversion-matrix fixtures. Run from the repo root:
//   node fixtures/conversion-matrix/gen.mjs
// Requires pandoc on PATH for the DOCX fixture (OMML math comes from pandoc).
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { strToU8, zipSync } from "fflate";
import * as XLSX from "xlsx";

const here = dirname(fileURLToPath(import.meta.url));
const out = (name) => join(here, name);

// 240x120 grayscale decay-curve PNG, generated once and embedded.
const DECAY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAPAAAABACAYAAAAbFePTAAAATklEQVR42u3QMQ0AMAgEQXCf7f8XARF5L2C1LFu2bNmypa3fZcuWLVu2bGWRbNmypa1dm7Zt29q1Zdu2bWvXlm3btnZt2bZt6wKeDQDkX1u6a9puAAAAAElFTkSuQmCC";

function makeLatexZip() {
  const entries = {
    "main.tex": strToU8(readFileSync(out("latex-paper/main.tex"))),
    "sections/method.tex": strToU8(readFileSync(out("latex-paper/sections/method.tex"))),
    "refs.bib": strToU8(readFileSync(out("latex-paper/refs.bib"))),
  };
  writeFileSync(out("latex-paper.zip"), zipSync(entries));
}

function makeXlsx() {
  const workbook = XLSX.utils.book_new();
  const data = [
    ["Name", "Note", "Extra", "Value"],
    ["Smith, Jane", "has, commas", "merged-right", 42],
    ["Doe", "unicode αβγ", "", 7],
    ["Special", "a&b%c$d#e_f", "", "=SUM(D2:D3)"],
  ];
  const sheet = XLSX.utils.aoa_to_sheet(data);
  // Formula with a cached result: sheet_to_csv must emit 49, not the text.
  sheet.D4 = { t: "n", f: "SUM(D2:D3)", v: 49 };
  // Merged cell B2:C2: value lives in the top-left, the rest read empty.
  sheet["!merges"] = [{ s: { r: 1, c: 1 }, e: { r: 1, c: 2 } }];
  XLSX.utils.book_append_sheet(workbook, sheet, "Runs");
  const bytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  writeFileSync(out("messy.xlsx"), bytes);
}

function makeDocx() {
  const tmp = join(here, ".docx-tmp");
  mkdirSync(tmp, { recursive: true });
  const tex = `\\documentclass{article}
\\usepackage{graphicx}
\\usepackage{booktabs}
\\begin{document}
\\section{OMML conversion fixture}
An inline equation $E = mc^2$ and a display one:
\\[
  \\int_0^\\infty e^{-\\lambda t}\\,dt = \\frac{1}{\\lambda}.
\\]
A footnote survives the trip\\footnote{Footnote text for the exporter.}.

\\begin{table}[htbp]
\\centering
\\begin{tabular}{lr}
\\toprule
Method & Score \\\\
\\midrule
Baseline & 0.71 \\\\
Ours & 0.94 \\\\
\\bottomrule
\\end{tabular}
\\caption{A table for the DOCX reader.}
\\end{table}

\\begin{figure}[htbp]
\\centering
\\includegraphics[width=0.3\\textwidth]{decay.png}
\\caption{An embedded image.}
\\end{figure}
\\end{document}
`;
  writeFileSync(join(tmp, "omml.tex"), tex);
  writeFileSync(
    join(tmp, "decay.png"),
    Buffer.from(DECAY_PNG_B64, "base64"),
  );
  execFileSync("pandoc", [join(tmp, "omml.tex"), "-o", out("docx-omml.docx")], {
    cwd: tmp,
    stdio: "inherit",
  });
  rmSync(tmp, { recursive: true, force: true });
}

async function makePdfs() {
  const text = await PDFDocument.create();
  const page = text.addPage([612, 792]);
  const bold = await text.embedFont(StandardFonts.HelveticaBold);
  const font = await text.embedFont(StandardFonts.Helvetica);
  page.drawText("Convergence of Iterated Maps", { x: 72, y: 740, size: 20, font: bold });
  page.drawText("1. Introduction", { x: 72, y: 700, size: 14, font: bold });
  page.drawText("We study the decay of the excess risk over time. The bound", { x: 72, y: 676, size: 11, font });
  page.drawText("epsilon(t) <= C exp(-lambda t) holds for every iterate t.", { x: 72, y: 660, size: 11, font });
  page.drawText("2. Results", { x: 72, y: 620, size: 14, font: bold });
  page.drawText("Table 1 summarizes accuracy across the five seeds we report.", { x: 72, y: 596, size: 11, font });
  writeFileSync(out("text-layer.pdf"), await text.save());

  const imageOnly = await PDFDocument.create();
  const scan = imageOnly.addPage([612, 792]);
  scan.drawRectangle({ x: 60, y: 480, width: 480, height: 200, color: rgb(0.9, 0.9, 0.9) });
  scan.drawRectangle({ x: 90, y: 510, width: 420, height: 12, color: rgb(0.1, 0.1, 0.1) });
  scan.drawRectangle({ x: 90, y: 540, width: 340, height: 12, color: rgb(0.2, 0.2, 0.2) });
  scan.drawRectangle({ x: 90, y: 570, width: 400, height: 12, color: rgb(0.15, 0.15, 0.15) });
  scan.drawRectangle({ x: 120, y: 120, width: 360, height: 240, color: rgb(0.85, 0.85, 0.85) });
  writeFileSync(out("image-only.pdf"), await imageOnly.save());
}

writeFileSync(out("decay.png"), Buffer.from(DECAY_PNG_B64, "base64"));
makeLatexZip();
makeXlsx();
makeDocx();
await makePdfs();
console.log("conversion-matrix fixtures regenerated");
