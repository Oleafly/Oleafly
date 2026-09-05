import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { gzipSync } from "node:zlib";

// Serves a template-pack catalog and a ccfddl-style deadlines aggregate on the
// fixed port scripts/e2e.sh points OLEAFLY_PACKS_BASE_URL /
// OLEAFLY_DEADLINES_URL at. The Rust process fetches these, so the port must
// be known before the app starts.
export const PACK_FIXTURE_PORT = 38999;

const TEMPLATE_JSON = JSON.stringify({
  id: "fixture-article",
  name: "Fixture Article",
  category: "Journals & Conferences",
  description: "A tiny article used by the e2e pack fixture.",
  main_doc: "main.tex",
  engine: "xetex",
  license: { spdx: "CC0-1.0", author: "Oleafly", url: "" },
});

const MAIN_TEX = [
  "\\documentclass[11pt]{article}",
  "\\title{Fixture Article}",
  "\\begin{document}",
  "\\maketitle",
  "Pack fixture body text.",
  "\\end{document}",
  "",
].join("\n");

const CATALOG = JSON.stringify([
  {
    id: "fixture-pack",
    label: "Fixture pack",
    description: "One tiny template for e2e.",
    category: "Journals & Conferences",
    approx_bytes: MAIN_TEX.length + TEMPLATE_JSON.length,
    count: 1,
    license_summary: "CC0-1.0",
    files: [
      {
        name: "fixture-article/template.json",
        url: `http://127.0.0.1:${PACK_FIXTURE_PORT}/packs/fixture-pack/fixture-article/template.json`,
      },
      {
        name: "fixture-article/main.tex",
        url: `http://127.0.0.1:${PACK_FIXTURE_PORT}/packs/fixture-pack/fixture-article/main.tex`,
      },
    ],
  },
]);

const ALLCONF_YML = `
- title: AAAI
  description: AAAI Conference on Artificial Intelligence
  sub: AI
  rank: { ccf: A, core: A* }
  confs:
    - year: 2033
      id: aaai33
      link: https://aaai.org/
      timeline: [{ abstract_deadline: "2032-08-08 23:59:59", deadline: "2032-08-15 23:59:59" }]
      timezone: AoE
      date: Jan 2033
      place: Somewhere
- title: ICSE
  description: International Conference on Software Engineering
  sub: SE
  rank: { ccf: A }
  confs:
    - year: 2033
      id: icse33
      link: https://conf.researchr.org/
      timeline: [{ deadline: "2032-03-01 23:59:59" }]
      timezone: UTC-12
      date: May 2033
      place: Elsewhere
`;

export const SKILL_FIXTURE_ID = "fixture-shelf";
export const SKILL_FIXTURE_VERSION = "1.0.0";
export const SKILL_FIXTURE_MARKER = "FIXTURESHELFMARKER75";

const SKILL_FIXTURE_FILES: Record<string, string> = {
  "SKILL.md": [
    "---",
    `name: ${SKILL_FIXTURE_ID}`,
    "description: A tiny domain shelf skill the e2e fixture server publishes, used to prove the download and install path.",
    "license: MIT",
    "metadata:",
    `  version: "${SKILL_FIXTURE_VERSION}"`,
    '  skill-author: "Oleafly e2e"',
    "  oleafly:",
    "    phase: research",
    "---",
    "",
    `Only the end to end suite loads this skill. ${SKILL_FIXTURE_MARKER}`,
    "",
    "Read references/notes.md when you need the rest of it.",
    "",
  ].join("\n"),
  "references/notes.md": `# Fixture notes\n\nNothing here matters outside the suite. ${SKILL_FIXTURE_MARKER}\n`,
};

function ustarHeader(name: string, size: number, typeflag: "0" | "5"): Buffer {
  const header = Buffer.alloc(512, 0);
  header.write(name, 0, 100, "utf8");
  header.write(`${typeflag === "5" ? "0000755" : "0000644"}\0`, 100, 8, "utf8");
  header.write("0000000\0", 108, 8, "utf8");
  header.write("0000000\0", 116, 8, "utf8");
  header.write(`${size.toString(8).padStart(11, "0")}\0`, 124, 12, "utf8");
  header.write("00000000000\0", 136, 12, "utf8");
  header.write("        ", 148, 8, "utf8");
  header.write(typeflag, 156, 1, "utf8");
  header.write("ustar\0", 257, 6, "utf8");
  header.write("00", 263, 2, "utf8");
  header.write("oleafly", 265, 32, "utf8");
  header.write("oleafly", 297, 32, "utf8");
  header.write("0000000\0", 329, 8, "utf8");
  header.write("0000000\0", 337, 8, "utf8");
  let checksum = 0;
  for (let i = 0; i < 512; i++) checksum += header[i];
  header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8, "utf8");
  return header;
}

function padTo512(buffer: Buffer): Buffer {
  const remainder = buffer.length % 512;
  return remainder === 0 ? buffer : Buffer.concat([buffer, Buffer.alloc(512 - remainder, 0)]);
}

function buildSkillArchive(): Buffer {
  const paths = Object.keys(SKILL_FIXTURE_FILES).sort();
  const directories = new Set<string>();
  for (const path of paths) {
    const parts = path.split("/");
    let accumulated = "";
    for (let i = 0; i < parts.length - 1; i++) {
      accumulated = accumulated ? `${accumulated}/${parts[i]}` : parts[i];
      directories.add(accumulated);
    }
  }
  const chunks: Buffer[] = [ustarHeader(`${SKILL_FIXTURE_ID}/`, 0, "5")];
  for (const directory of [...directories].sort()) {
    chunks.push(ustarHeader(`${SKILL_FIXTURE_ID}/${directory}/`, 0, "5"));
  }
  for (const path of paths) {
    const content = Buffer.from(SKILL_FIXTURE_FILES[path], "utf8");
    chunks.push(ustarHeader(`${SKILL_FIXTURE_ID}/${path}`, content.length, "0"));
    chunks.push(padTo512(content));
  }
  chunks.push(Buffer.alloc(1024, 0));
  return gzipSync(Buffer.concat(chunks), { level: 9 });
}

const SKILL_ARCHIVE = buildSkillArchive();
const SKILL_ARCHIVE_PATH = `/downloads/skills/${SKILL_FIXTURE_ID}/${SKILL_FIXTURE_VERSION}/${SKILL_FIXTURE_ID}.tar.gz`;

const SKILLS_CATALOG = JSON.stringify({
  schemaVersion: 1,
  generatedAt: "2099-01-01T00:00:00Z",
  packs: [{ id: "shelf", version: SKILL_FIXTURE_VERSION, kind: "shelf" }],
  skills: [
    {
      id: SKILL_FIXTURE_ID,
      name: SKILL_FIXTURE_ID,
      description: "A tiny domain shelf skill for the e2e suite.",
      phase: "research",
      domain: "e2e",
      license: "MIT",
      version: SKILL_FIXTURE_VERSION,
      bytes: SKILL_ARCHIVE.length,
      files: Object.keys(SKILL_FIXTURE_FILES).length,
      sha256: createHash("sha256").update(SKILL_ARCHIVE).digest("hex"),
      url: `http://127.0.0.1:${PACK_FIXTURE_PORT}${SKILL_ARCHIVE_PATH}`,
      pack: "shelf",
    },
  ],
});

export async function startPackFixtureServer() {
  const server: Server = createServer((req, res) => {
    const url = req.url || "";
    const send = (body: string, type = "application/json") => {
      res.writeHead(200, { "content-type": type });
      res.end(body);
    };
    if (url === "/catalog.json") return send(CATALOG);
    if (url === "/catalogs/skills.json") return send(SKILLS_CATALOG);
    if (url === SKILL_ARCHIVE_PATH) {
      res.writeHead(200, {
        "content-type": "application/gzip",
        "content-length": String(SKILL_ARCHIVE.length),
      });
      res.end(SKILL_ARCHIVE);
      return;
    }
    if (url === "/allconf.yml") return send(ALLCONF_YML, "text/yaml");
    if (url === "/packs/fixture-pack/fixture-article/template.json") return send(TEMPLATE_JSON);
    if (url === "/packs/fixture-pack/fixture-article/main.tex") {
      return send(MAIN_TEX, "text/plain");
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(PACK_FIXTURE_PORT, "127.0.0.1", () => resolve());
  });
  return { close: () => new Promise<void>((r) => server.close(() => r())) };
}
