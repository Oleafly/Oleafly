import { createServer, type Server } from "node:http";

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

export async function startPackFixtureServer() {
  const server: Server = createServer((req, res) => {
    const url = req.url || "";
    const send = (body: string, type = "application/json") => {
      res.writeHead(200, { "content-type": type });
      res.end(body);
    };
    if (url === "/catalog.json") return send(CATALOG);
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
