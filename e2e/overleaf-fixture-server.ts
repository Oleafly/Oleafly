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

export async function startOverleafFixtureServer(): Promise<{ base: string; close: () => Promise<void> }> {
  const polls = new Map<string, number>();
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
      const target = OVERLEAF_FIXTURE_PROJECTS.find((item) => item.id === download[1]);
      if (!target) {
        send(404, "missing");
        return;
      }
      const entries: Record<string, Uint8Array> = {};
      for (const [name, body] of Object.entries(target.files)) entries[name] = strToU8(body);
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
  };
}
