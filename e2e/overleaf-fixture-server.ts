import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { strToU8, zipSync } from "fflate";

const SESSION = "overleaf_session2=e2e-session";
const MARKER = "\uFFFD";

type FixtureProject = {
  id: string;
  name: string;
  owned: boolean;
  compiler: string;
  rootDocId: string;
  folder: { name?: string; docs: { _id: string; name: string }[]; folders: FixtureFolder[] };
  files: Record<string, string>;
};

type FixtureFolder = { name: string; docs: { _id: string; name: string }[]; folders: FixtureFolder[] };

export const OVERLEAF_FIXTURE_PROJECTS: FixtureProject[] = [
  {
    id: "e2e-thesis",
    name: "Fixture Thesis",
    owned: true,
    compiler: "xelatex",
    rootDocId: "doc-thesis-main",
    folder: {
      docs: [{ _id: "doc-notes", name: "notes.tex" }],
      folders: [{ name: "thesis", docs: [{ _id: "doc-thesis-main", name: "main.tex" }], folders: [] }],
    },
    files: {
      "thesis/main.tex": "\\documentclass{report}\n\\begin{document}\nFixture thesis body.\n\\end{document}\n",
      "notes.tex": "\\documentclass{article}\n\\begin{document}\nNotes.\n\\end{document}\n",
    },
  },
  {
    id: "e2e-paper",
    name: "Fixture Shared Paper",
    owned: false,
    compiler: "pdflatex",
    rootDocId: "doc-paper",
    folder: { docs: [{ _id: "doc-paper", name: "paper.tex" }], folders: [] },
    files: {
      "paper.tex": "\\documentclass{article}\n\\begin{document}\nFixture shared paper.\n\\end{document}\n",
    },
  },
];

export const OVERLEAF_FIXTURE_TEMPLATE = {
  page: "/latex/templates/e2e-lab-thesis/e2etpl",
  title: "Fixture Lab Thesis",
  author: "Fixture Lab",
  license: "Creative Commons CC BY 4.0",
  templateId: "4242",
  versionId: "777",
  files: {
    "thesis/main.tex":
      "\\documentclass{report}\n\\begin{document}\nFixture lab thesis template.\n\\end{document}\n",
    "thesis/LICENSE": "CC BY 4.0\n",
    "thesis/chapters/intro.tex": "\\chapter{Introduction}\n",
  } as Record<string, string>,
};

// A one-page PDF small enough to write by hand; pdf.js rebuilds the offsets.
const FIXTURE_PDF =
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
  "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
  "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 260]>>endobj\n" +
  "trailer<</Root 1 0 R>>\n%%EOF\n";

function templatePage(): string {
  const t = OVERLEAF_FIXTURE_TEMPLATE;
  const open = `/project/new/template/${t.versionId}?id=${t.templateId}&amp;latexEngine=pdflatex&amp;mainFile=thesis%2Fmain.tex&amp;templateName=Fixture+Lab+Thesis`;
  return `<!DOCTYPE html><html><head><title>${t.title}</title>
<meta name="og:title" content="${t.title}"></head><body>
<h1>${t.title}</h1>
<a class="btn btn-primary" href="${open}">Open as Template</a>
<a class="btn" href="${t.page}.pdf">View PDF</a>
<div class="template-detail"><div><b>Author:</b></div><div>${t.author}</div></div>
<div class="template-detail"><div><b>License:</b></div><div>${t.license}</div></div>
<div class="template-detail"><div><b>Abstract:</b></div><div><p>A thesis template for the fixture lab.</p></div></div>
</body></html>`;
}

function escapeAttribute(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function dashboard(): string {
  const projects = OVERLEAF_FIXTURE_PROJECTS.map((project) => ({
    id: project.id,
    name: project.name,
    accessLevel: project.owned ? "owner" : "readAndWrite",
    owner: project.owned
      ? { id: "e2e-user", firstName: "Fixture", lastName: "Author", email: "author@example.org" }
      : { id: "someone", firstName: "Grace", lastName: "Hopper", email: "grace@example.org" },
    lastUpdated: new Date().toISOString(),
    archived: false,
    trashed: false,
  }));
  const blob = escapeAttribute(JSON.stringify({ totalSize: projects.length, projects }));
  return `<!DOCTYPE html><html><head><title>Your Projects</title>
<meta name="ol-csrfToken" content="e2e-csrf">
<meta name="ol-user_id" content="e2e-user">
<meta name="ol-usersEmail" content="author@example.org">
<meta name="ol-prefetchedProjectsBlob" data-type="json" content="${blob}">
</head><body><h1>Your Projects</h1></body></html>`;
}

function frame(packet: string): string {
  return `${MARKER}${packet.length}${MARKER}${packet}`;
}

function joinReply(project: FixtureProject): string {
  const event = {
    name: "joinProjectResponse",
    args: [
      {
        publicId: "e2e",
        permissionsLevel: "owner",
        protocolVersion: 2,
        project: {
          _id: project.id,
          name: project.name,
          compiler: project.compiler,
          imageName: "texlive-full:2025.1",
          rootDoc_id: project.rootDocId,
          rootFolder: [{ _id: "root", name: "rootFolder", ...project.folder }],
        },
      },
    ],
  };
  return frame(`5:::${JSON.stringify(event)}`);
}

function signedIn(request: IncomingMessage): boolean {
  return (request.headers.cookie ?? "").includes(SESSION);
}

export async function startOverleafFixtureServer(): Promise<{
  base: string;
  close: () => Promise<void>;
  templateCopies: () => number;
}> {
  const polls = new Map<string, number>();
  const copies = new Map<string, Record<string, string>>();
  const handler = (request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const path = url.pathname;
    const send = (status: number, body: string | Uint8Array, headers: Record<string, string> = {}) => {
      response.writeHead(status, { "Content-Length": String(typeof body === "string" ? Buffer.byteLength(body) : body.length), ...headers });
      response.end(body);
    };
    if (path === "/login") {
      send(302, "", { Location: "/project", "Set-Cookie": `${SESSION}; Path=/; HttpOnly` });
      return;
    }
    if (path === "/project" || path === "/project/") {
      if (!signedIn(request)) {
        send(302, "", { Location: "/login" });
        return;
      }
      send(200, dashboard(), { "Content-Type": "text/html; charset=utf-8" });
      return;
    }
    if (path === OVERLEAF_FIXTURE_TEMPLATE.page) {
      send(200, templatePage(), { "Content-Type": "text/html; charset=utf-8" });
      return;
    }
    if (path === `${OVERLEAF_FIXTURE_TEMPLATE.page}.pdf`) {
      send(200, FIXTURE_PDF, { "Content-Type": "application/pdf" });
      return;
    }
    if (path === "/project/new/template" && request.method === "POST") {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        if (!signedIn(request)) {
          send(302, "", { Location: "/login" });
          return;
        }
        let body: Record<string, unknown> = {};
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
        } catch {
          body = {};
        }
        const t = OVERLEAF_FIXTURE_TEMPLATE;
        if (
          request.headers["x-csrf-token"] !== "e2e-csrf" ||
          body.templateId !== t.templateId ||
          body.templateVersionId !== t.versionId
        ) {
          send(400, "bad request");
          return;
        }
        const id = `e2e-from-template-${copies.size + 1}`;
        copies.set(id, t.files);
        send(302, "", { Location: `/project/${id}` });
      });
      return;
    }
    if (path === "/api/project") {
      send(404, "missing");
      return;
    }
    if (path === "/socket.io/socket.io.js") {
      send(200, "/* socket */", { "Set-Cookie": "GCLB=e2e-affinity; Path=/" });
      return;
    }
    const projectId = url.searchParams.get("projectId") ?? "";
    const project = OVERLEAF_FIXTURE_PROJECTS.find((item) => item.id === projectId);
    if (path === "/socket.io/1/" && project && signedIn(request)) {
      send(200, `sid-${project.id}:60:60:xhr-polling`);
      return;
    }
    const polling = path.match(/^\/socket\.io\/1\/xhr-polling\/sid-([A-Za-z0-9_-]+)$/);
    if (polling) {
      if (request.method === "POST") {
        request.resume();
        send(200, "1");
        return;
      }
      const target = OVERLEAF_FIXTURE_PROJECTS.find((item) => item.id === polling[1]);
      const count = (polls.get(polling[1]) ?? 0) + 1;
      polls.set(polling[1], count);
      if (!target) {
        send(200, frame("0::"));
        return;
      }
      send(200, count % 2 === 1 ? frame("1::") : joinReply(target));
      return;
    }
    const download = path.match(/^\/project\/([A-Za-z0-9_-]+)\/download\/zip$/);
    if (download && signedIn(request)) {
      const files =
        OVERLEAF_FIXTURE_PROJECTS.find((item) => item.id === download[1])?.files ??
        copies.get(download[1]);
      if (!files) {
        send(404, "missing");
        return;
      }
      const entries: Record<string, Uint8Array> = {};
      for (const [name, body] of Object.entries(files)) entries[name] = strToU8(body);
      send(200, zipSync(entries), { "Content-Type": "application/zip" });
      return;
    }
    send(404, "missing");
  };
  const server: Server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    templateCopies: () => copies.size,
  };
}
