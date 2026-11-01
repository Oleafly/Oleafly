import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { gzipSync } from "node:zlib";

export const PACK_FIXTURE_PORT = 38999;
const FIXTURE_BASE = `http://127.0.0.1:${PACK_FIXTURE_PORT}`;

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

const LETTER_JSON = JSON.stringify({
  id: "fixture-letter",
  name: "Fixture Letter",
  category: "Letters",
  description: "A one page letter used by the e2e pack fixture.",
  main_doc: "main.tex",
  engine: "xetex",
  license: { spdx: "MIT", author: "Oleafly", url: "" },
});

const LETTER_TEX = [
  "\\documentclass[11pt]{article}",
  "\\begin{document}",
  "Fixture letter body text.",
  "\\end{document}",
  "",
].join("\n");

const LETTER_NOTE = "Kept next to the letter to prove nested pack files install.\n";

export const CJK_TEMPLATE_ID = "fixture-kaist";
export const CJK_TEMPLATE_NAME = "KAIST (한국과학기술원)";

const CJK_DESCRIPTION = "A thesis template whose name mixes Latin and Korean, used by the e2e pack fixture.";

const CJK_JSON = JSON.stringify({
  id: CJK_TEMPLATE_ID,
  name: CJK_TEMPLATE_NAME,
  category: "Theses & Reports",
  description: CJK_DESCRIPTION,
  main_doc: "main.tex",
  engine: "xetex",
  license: { spdx: "CC0-1.0", author: "Oleafly", url: "" },
});

const CJK_TEX = [
  "\\documentclass[11pt]{article}",
  "\\title{Fixture Thesis}",
  "\\begin{document}",
  "\\maketitle",
  "Fixture thesis body text.",
  "\\end{document}",
  "",
].join("\n");

type FixtureFile = { body: string; type: string };

const PACK_FILES: Record<string, FixtureFile> = {
  "/packs/fixture-pack/fixture-article/template.json": { body: TEMPLATE_JSON, type: "application/json" },
  "/packs/fixture-pack/fixture-article/main.tex": { body: MAIN_TEX, type: "text/plain" },
  "/packs/fixture-pack/fixture-letter/template.json": { body: LETTER_JSON, type: "application/json" },
  "/packs/fixture-pack/fixture-letter/main.tex": { body: LETTER_TEX, type: "text/plain" },
  "/packs/fixture-pack/fixture-letter/assets/note%201.txt": { body: LETTER_NOTE, type: "text/plain" },
  [`/packs/fixture-pack/${CJK_TEMPLATE_ID}/template.json`]: { body: CJK_JSON, type: "application/json" },
  [`/packs/fixture-pack/${CJK_TEMPLATE_ID}/main.tex`]: { body: CJK_TEX, type: "text/plain" },
};

function packFile(name: string, path: string) {
  return { name, url: `${FIXTURE_BASE}${path}` };
}

function utf8Bytes(...bodies: string[]): number {
  return bodies.reduce((sum, body) => sum + Buffer.byteLength(body, "utf8"), 0);
}

export const MANY_PACK_ID = "fixture-universities";
export const MANY_PACK_SIZE = 600;
const MANY_PACK_PATH = `/packs/${MANY_PACK_ID}`;
const LONG_NAME_EVERY = 40;

type Institution = readonly [name: string, country: string];

type NameFamily = {
  languages: readonly string[];
  institutions: readonly Institution[];
  title: (institution: string, serial: string, index: number) => string;
};

const EMOJI = ["🎓", "📚", "🧪", "📝", "🌏"];

const NAME_FAMILIES: readonly NameFamily[] = [
  {
    languages: ["en"],
    institutions: [
      ["Aalto University", "FI"],
      ["ETH Zurich", "CH"],
      ["University of Toronto", "CA"],
      ["Imperial College London", "GB"],
      ["Indian Institute of Science", "IN"],
    ],
    title: (institution, serial) => `${institution} Thesis ${serial}`,
  },
  {
    languages: ["zh"],
    institutions: [
      ["清华大学", "CN"],
      ["北京大学", "CN"],
      ["复旦大学", "CN"],
      ["浙江大学", "CN"],
      ["国立台湾大学", "TW"],
      ["香港大学", "HK"],
    ],
    title: (institution, serial) => `${institution}学位论文 ${serial}`,
  },
  {
    languages: ["ja"],
    institutions: [
      ["東京大学", "JP"],
      ["京都大学", "JP"],
      ["大阪大学", "JP"],
      ["早稲田大学", "JP"],
      ["慶應義塾大学", "JP"],
    ],
    title: (institution, serial) => `${institution} 卒業論文テンプレート ${serial}`,
  },
  {
    languages: ["ko"],
    institutions: [
      ["서울대학교", "KR"],
      ["연세대학교", "KR"],
      ["고려대학교", "KR"],
      ["한양대학교", "KR"],
    ],
    title: (institution, serial) => `${institution} 학위논문 ${serial}`,
  },
  {
    languages: ["en", "ko"],
    institutions: [
      ["KAIST (한국과학기술원)", "KR"],
      ["POSTECH (포항공과대학교)", "KR"],
      ["UNIST (울산과학기술원)", "KR"],
    ],
    title: (institution, serial) => `${institution} Report ${serial}`,
  },
  {
    languages: ["en", "zh"],
    institutions: [
      ["Peking University 北京大学", "CN"],
      ["Tsinghua University 清华大学", "CN"],
      ["Fudan University 复旦大学", "CN"],
    ],
    title: (institution, serial) => `${institution} Dissertation ${serial}`,
  },
  {
    languages: ["en", "ja", "ko"],
    institutions: [
      ["University of Tokyo 東京大学", "JP"],
      ["KAIST 카이스트", "KR"],
      ["Aalto University", "FI"],
      ["Kyoto University 京都大学", "JP"],
    ],
    title: (institution, serial, index) =>
      `${EMOJI[index % EMOJI.length]} ${institution} Lab Notes 실험 노트 ${serial}`,
  },
];

const LONG_TITLES: readonly ((institution: string, serial: string) => string)[] = [
  (institution, serial) =>
    `${institution} Graduate School of Engineering and Applied Sciences, Department of Computational Linguistics, Doctoral Dissertation Template ${serial}`,
  (institution, serial) =>
    `${institution} 大学院 工学系研究科 電気系工学専攻 博士論文テンプレート (Doctoral Dissertation Template with English and Japanese Abstracts, Revised 2026 Edition) ${serial}`,
  (institution, serial) =>
    `${institution} 研究生院 博士学位论文模板 (Doctoral Thesis Template with Chinese and English Abstracts, Table of Contents, Bibliography and Appendices) ${serial}`,
];

type ManyTemplate = {
  id: string;
  name: string;
  institution: string;
  country: string;
  languages: readonly string[];
  category: string;
  description: string;
  engine: string;
  mainDoc: string;
  manifest: string;
  source: string;
};

function manyTemplate(index: number): ManyTemplate {
  const serial = String(index).padStart(3, "0");
  const id = `uni-${String(index).padStart(4, "0")}`;
  const family = NAME_FAMILIES[(index - 1) % NAME_FAMILIES.length];
  const [institution, country] =
    family.institutions[Math.floor((index - 1) / NAME_FAMILIES.length) % family.institutions.length];
  const name =
    index % LONG_NAME_EVERY === 0
      ? LONG_TITLES[(index / LONG_NAME_EVERY) % LONG_TITLES.length](institution, serial)
      : family.title(institution, serial, index);
  const typst = index % 5 === 0;
  const mainDoc = typst ? "main.typ" : "main.tex";
  const engine = typst ? "typst" : "xetex";
  const category = index % 9 === 0 ? "Letters" : "Theses & Reports";
  const description = `Generated pack fixture template ${serial}.`;
  const manifest = JSON.stringify({
    id,
    name,
    category,
    description,
    main_doc: mainDoc,
    engine,
    license: { spdx: "CC0-1.0", author: "Oleafly e2e", url: "" },
  });
  const source = typst
    ? `= Fixture ${serial}\n\nGenerated fixture body text.\n`
    : `\\documentclass{article}\n\\begin{document}\nGenerated fixture ${serial}.\n\\end{document}\n`;
  return {
    id,
    name,
    institution,
    country,
    languages: family.languages,
    category,
    description,
    engine,
    mainDoc,
    manifest,
    source,
  };
}

export const MANY_PACK_TEMPLATES: readonly ManyTemplate[] = Array.from(
  { length: MANY_PACK_SIZE },
  (_, offset) => manyTemplate(offset + 1),
);

const MANY_PACK_FILES = new Map<string, FixtureFile>();
for (const template of MANY_PACK_TEMPLATES) {
  MANY_PACK_FILES.set(`${MANY_PACK_PATH}/${template.id}/template.json`, {
    body: template.manifest,
    type: "application/json",
  });
  MANY_PACK_FILES.set(`${MANY_PACK_PATH}/${template.id}/${template.mainDoc}`, {
    body: template.source,
    type: "text/plain",
  });
}

const MANY_INDEX = JSON.stringify({
  version: 2,
  id: MANY_PACK_ID,
  templates: MANY_PACK_TEMPLATES.map((template) => ({
    id: template.id,
    name: template.name,
    description: template.description,
    category: template.category,
    engine: template.engine,
    main_doc: template.mainDoc,
    license: { spdx: "CC0-1.0", label: "CC0-1.0" },
    bytes: utf8Bytes(template.manifest, template.source),
    files: [
      packFile(`${template.id}/${template.mainDoc}`, `${MANY_PACK_PATH}/${template.id}/${template.mainDoc}`),
      packFile(`${template.id}/template.json`, `${MANY_PACK_PATH}/${template.id}/template.json`),
    ],
    credit: { url: "https://github.com/Oleafly/template-packs", author: "Oleafly" },
    languages: template.languages,
    country: template.country,
    institution: template.institution,
  })),
});

const INDEX = JSON.stringify({
  version: 2,
  id: "fixture-pack",
  templates: [
    {
      id: "fixture-article",
      name: "Fixture Article",
      description: "A tiny article used by the e2e pack fixture.",
      category: "Journals & Conferences",
      engine: "xetex",
      main_doc: "main.tex",
      license: { spdx: "CC0-1.0", label: "CC0-1.0" },
      bytes: MAIN_TEX.length + TEMPLATE_JSON.length,
      files: [
        packFile("fixture-article/main.tex", "/packs/fixture-pack/fixture-article/main.tex"),
        packFile("fixture-article/template.json", "/packs/fixture-pack/fixture-article/template.json"),
      ],
      credit: { url: "https://github.com/Oleafly/template-packs", author: "Oleafly" },
    },
    {
      id: "fixture-letter",
      name: "Fixture Letter",
      description: "A one page letter used by the e2e pack fixture.",
      category: "Letters",
      engine: "xetex",
      main_doc: "main.tex",
      license: { spdx: null, label: "Unlicensed (no license stated)" },
      bytes: LETTER_TEX.length + LETTER_JSON.length + LETTER_NOTE.length,
      files: [
        packFile("fixture-letter/main.tex", "/packs/fixture-pack/fixture-letter/main.tex"),
        packFile("fixture-letter/assets/note 1.txt", "/packs/fixture-pack/fixture-letter/assets/note%201.txt"),
        packFile("fixture-letter/template.json", "/packs/fixture-pack/fixture-letter/template.json"),
      ],
    },
    {
      id: CJK_TEMPLATE_ID,
      name: CJK_TEMPLATE_NAME,
      description: CJK_DESCRIPTION,
      category: "Theses & Reports",
      engine: "xetex",
      main_doc: "main.tex",
      license: { spdx: "CC0-1.0", label: "CC0-1.0" },
      bytes: utf8Bytes(CJK_TEX, CJK_JSON),
      files: [
        packFile(`${CJK_TEMPLATE_ID}/main.tex`, `/packs/fixture-pack/${CJK_TEMPLATE_ID}/main.tex`),
        packFile(`${CJK_TEMPLATE_ID}/template.json`, `/packs/fixture-pack/${CJK_TEMPLATE_ID}/template.json`),
      ],
      credit: { url: "https://github.com/Oleafly/template-packs", author: "Oleafly" },
      languages: ["en", "ko"],
      country: "KR",
      institution: CJK_TEMPLATE_NAME,
    },
  ],
});

const CATALOG_V2 = JSON.stringify({
  version: 2,
  packs: [
    {
      id: "fixture-pack",
      label: "Fixture pack",
      description: "Three tiny templates for e2e.",
      category: "Journals & Conferences",
      group: "curated",
      count: 3,
      bytes: utf8Bytes(...Object.values(PACK_FILES).map((file) => file.body)),
      license_summary: "CC0-1.0, Unlicensed",
      index_url: `${FIXTURE_BASE}/indexes/fixture-pack.json`,
      covers: [],
    },
    {
      id: MANY_PACK_ID,
      label: "Fixture universities",
      description: `${MANY_PACK_SIZE} tiny university templates for e2e, named in Latin, Chinese, Japanese and Korean scripts.`,
      category: "Theses & Reports",
      group: "university",
      count: MANY_PACK_SIZE,
      bytes: utf8Bytes(...[...MANY_PACK_FILES.values()].map((file) => file.body)),
      license_summary: "CC0-1.0",
      index_url: `${FIXTURE_BASE}/indexes/${MANY_PACK_ID}.json`,
      covers: [],
    },
  ],
});

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
    if (url === "/catalog-v2.json") return send(CATALOG_V2);
    if (url === "/indexes/fixture-pack.json") return send(INDEX);
    if (url === `/indexes/${MANY_PACK_ID}.json`) return send(MANY_INDEX);
    const packFileBody = PACK_FILES[url] ?? MANY_PACK_FILES.get(url);
    if (packFileBody) return send(packFileBody.body, packFileBody.type);
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
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(PACK_FIXTURE_PORT, "127.0.0.1", () => resolve());
  });
  return { close: () => new Promise<void>((r) => server.close(() => r())) };
}
