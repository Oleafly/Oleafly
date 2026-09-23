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
  "iVBORw0KGgoAAAANSUhEUgAAAPAAAAB4CAAAAADp3SD7AAAB2ElEQVR42u3c25KCMBCE4X7/l85eu7ULk2Qmme6WGwWs4v8A8YCIYTYAMAMPPzDMwMMPDDPw8APDDDz8wDADO4nxcWMEhhl4+IFhBh5+YJiBXcT4864JGGbg4QeGGdhCjIcxBzDMwAZivIzrg2EGlhcjMEUdDDOwuBjBadpgmIGlxZiYqgyGGVhY/B9MVozpGbJgmIFVxQ8qTTEW52mCYQaWFD+TBMUvIj3xG0hOjO0HyIFhBlYTBzRa4ghGShyyKIljFCFxUKIjjkJkxGGHijjOEBFPKDTEMwgJ8ZRBQTxHEBBPCvjFswB68XQ/+xXWC/Xc4pV4avFSO7N4LZ1YvFjOe+ha7mYVr2eTijeqOXfrrWZG8V4yoXizmG+33u5lE+/nkm3kjFgqcUor00ZOKuUhp3WyiPMySTZyZiQFOTeRgJwd2J6cn9ecXBHXmlyT1phcFdaWXJeFnubSpo7k4qJ+5PKebnv2iZhW5kMlfcznMpqYjzZ0MJ8OuG6+sHRcRV9a8j3zxVV9B335CXVe3eCV4iy6y9uBY+pO73Nxgt3w81stu+tXMWXs3l+qAulwjjNCiXCu8/fANp32B3VYxEtct/FrkAe/+D9Xgss/w6PggE9C/4LFhx/KHbRWV1R2EgAAAABJRU5ErkJggg==";

const SOURCE_DATE = new Date("2026-09-12T02:52:25Z");
const ZIP_MTIME = new Date(2026, 8, 11, 19, 52, 24);

function makeLatexZip() {
  const entries = {
    "main.tex": strToU8(readFileSync(out("latex-paper/main.tex"))),
    "sections/method.tex": strToU8(readFileSync(out("latex-paper/sections/method.tex"))),
    "refs.bib": strToU8(readFileSync(out("latex-paper/refs.bib"))),
  };
  writeFileSync(out("latex-paper.zip"), zipSync(entries, { mtime: ZIP_MTIME }));
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
    env: { ...process.env, SOURCE_DATE_EPOCH: String(SOURCE_DATE.getTime() / 1000) },
    stdio: "inherit",
  });
  rmSync(tmp, { recursive: true, force: true });
}

async function savePdf(pdf, name) {
  pdf.setCreationDate(SOURCE_DATE);
  pdf.setModificationDate(SOURCE_DATE);
  writeFileSync(out(name), await pdf.save());
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
  await savePdf(text, "text-layer.pdf");

  const imageOnly = await PDFDocument.create();
  const scan = imageOnly.addPage([612, 792]);
  scan.drawRectangle({ x: 60, y: 480, width: 480, height: 200, color: rgb(0.9, 0.9, 0.9) });
  scan.drawRectangle({ x: 90, y: 510, width: 420, height: 12, color: rgb(0.1, 0.1, 0.1) });
  scan.drawRectangle({ x: 90, y: 540, width: 340, height: 12, color: rgb(0.2, 0.2, 0.2) });
  scan.drawRectangle({ x: 90, y: 570, width: 400, height: 12, color: rgb(0.15, 0.15, 0.15) });
  scan.drawRectangle({ x: 120, y: 120, width: 360, height: 240, color: rgb(0.85, 0.85, 0.85) });
  await savePdf(imageOnly, "image-only.pdf");
}

writeFileSync(out("decay.png"), Buffer.from(DECAY_PNG_B64, "base64"));
makeLatexZip();
makeXlsx();
makeDocx();
await makePdfs();
console.log("conversion-matrix fixtures regenerated");
