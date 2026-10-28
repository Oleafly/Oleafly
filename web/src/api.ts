import {
  type CollabOutputInfo,
  type CollabProjectRole,
  parseFeatures,
  parseOutput,
  parseFile,
  parsePerson,
  parseRole,
  type WebFeatures,
  type WebFile,
  type WebPerson,
} from "./protocol";

export const API_BASE = "/web/api";
export const MAIN_FILE_HEADER = "X-Oleafly-Main-File";
export const SIGN_IN_PATH = "/web/sign-in";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export interface WebMe extends WebPerson {
  email: string | null;
}

export interface WebProjectSummary {
  projectId: string;
  title: string;
  owner: WebPerson | null;
  role: CollabProjectRole;
}

export interface WebProjectDetail {
  project: WebProjectSummary;
  role: CollabProjectRole;
  files: WebFile[];
  features: WebFeatures;
  people: WebPerson[];
}

export interface WebText {
  fileId: string;
  path: string;
  text: string;
}

export type OutputKind = "pdf" | "synctex";

export interface WebApi {
  me(): Promise<WebMe | null>;
  projects(): Promise<WebProjectSummary[]>;
  project(projectId: string): Promise<WebProjectDetail>;
  /** The text of every text file, for a compile. */
  texts(projectId: string, signal?: AbortSignal): Promise<WebText[]>;
  blob(projectId: string, hash: string): Promise<Blob>;
  output(projectId: string, kind: OutputKind): Promise<Uint8Array | null>;
  /** Shares a compiled output with the project; owners and editors only. */
  putOutput(projectId: string, kind: OutputKind, bytes: Uint8Array, mainFile: string): Promise<CollabOutputInfo | null>;
  signOut(): Promise<void>;
}

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function parseSummary(value: unknown): WebProjectSummary | null {
  const raw = record(value);
  const projectId = [raw.projectId, raw.project_id, raw.id].find((entry) => typeof entry === "string");
  if (typeof projectId !== "string" || projectId === "") return null;
  return {
    projectId,
    title: typeof raw.title === "string" ? raw.title : "",
    owner: parsePerson(raw.owner),
    role: parseRole(raw.role),
  };
}

export function parseMe(value: unknown): WebMe | null {
  const raw = record(value);
  const person = parsePerson(raw.account ?? raw.person ?? raw.user ?? raw);
  if (!person) return null;
  const source = record(raw.account ?? raw.person ?? raw.user ?? raw);
  return { ...person, email: typeof source.email === "string" ? source.email : null };
}

export function parseProjects(value: unknown): WebProjectSummary[] {
  const items = Array.isArray(value) ? value : record(value).projects;
  if (!Array.isArray(items)) return [];
  return items.map(parseSummary).filter((entry): entry is WebProjectSummary => entry !== null);
}

export function parseTexts(value: unknown): WebText[] {
  const items = record(value).files;
  if (!Array.isArray(items)) return [];
  return items.flatMap((item: unknown) => {
    const raw = record(item);
    const fileId = raw.fileId;
    const path = raw.path;
    const text = raw.text;
    return typeof fileId === "string" && typeof path === "string" && path !== "" && typeof text === "string"
      ? [{ fileId, path, text }]
      : [];
  });
}

export function parseProjectDetail(value: unknown, projectId: string): WebProjectDetail {
  const raw = record(value);
  const summary = parseSummary(raw.project) ?? { projectId, title: "", owner: null, role: "unknown" };
  const role = raw.role === undefined ? summary.role : parseRole(raw.role);
  const files = Array.isArray(raw.files) ? raw.files.map(parseFile).filter((file): file is WebFile => file !== null) : [];
  const peopleSource = Array.isArray(raw.people) ? raw.people : Array.isArray(raw.members) ? raw.members : [];
  const people = peopleSource
    .map((entry: unknown) => parsePerson(record(entry).person ?? entry))
    .filter((person): person is WebPerson => person !== null);
  return { project: { ...summary, role }, role, files, features: parseFeatures(raw.features), people };
}

async function failure(response: Response): Promise<ApiError> {
  let code = "server";
  let message = response.statusText;
  try {
    const body = record(await response.json());
    if (typeof body.code === "string") code = body.code;
    if (typeof body.message === "string") message = body.message;
  } catch {
    code = response.status === 401 ? "unauthorized" : code;
  }
  if (response.status === 401) code = "unauthorized";
  if (response.status === 403 && code === "server") code = "forbidden";
  if (response.status === 404 && code === "server") code = "not_found";
  return new ApiError(response.status, code, message);
}

export function createWebApi(fetcher: Fetcher = (input, init) => fetch(input, init)): WebApi {
  const get = async (path: string): Promise<Response> => {
    const response = await fetcher(`${API_BASE}${path}`, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw await failure(response);
    return response;
  };
  return {
    async me() {
      try {
        return parseMe(await (await get("/me")).json());
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    async projects() {
      return parseProjects(await (await get("/projects")).json());
    },
    async project(projectId) {
      return parseProjectDetail(await (await get(`/projects/${encodeURIComponent(projectId)}`)).json(), projectId);
    },
    async texts(projectId, signal) {
      const response = await fetcher(`${API_BASE}/projects/${encodeURIComponent(projectId)}/texts`, {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        signal,
      });
      if (!response.ok) throw await failure(response);
      return parseTexts(await response.json());
    },
    async blob(projectId, hash) {
      const response = await get(`/projects/${encodeURIComponent(projectId)}/blobs/${encodeURIComponent(hash)}`);
      return await response.blob();
    },
    async output(projectId, kind) {
      const response = await fetcher(`${API_BASE}/projects/${encodeURIComponent(projectId)}/output/${kind}`, {
        credentials: "same-origin",
      });
      if (response.status === 404) return null;
      if (!response.ok) throw await failure(response);
      return new Uint8Array(await response.arrayBuffer());
    },
    async putOutput(projectId, kind, bytes, mainFile) {
      const response = await fetcher(outputUrl(projectId, kind), {
        method: "PUT",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          [MAIN_FILE_HEADER]: encodeURIComponent(mainFile),
          "X-Requested-With": "oleafly-web",
        },
        body: new Blob([bytes as BlobPart], { type: kind === "pdf" ? "application/pdf" : "application/gzip" }),
      });
      if (!response.ok) throw await failure(response);
      return parseOutput(await response.json());
    },
    async signOut() {
      const response = await fetcher(`${API_BASE}/sign-out`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "X-Requested-With": "oleafly-web" },
      });
      if (!response.ok && response.status !== 401) throw await failure(response);
    },
  };
}

export function socketUrl(projectId: string, location: Pick<Location, "protocol" | "host"> = window.location): string {
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${location.host}/web/ws?project=${encodeURIComponent(projectId)}`;
}

export function outputUrl(projectId: string, kind: OutputKind): string {
  return `${API_BASE}/projects/${encodeURIComponent(projectId)}/output/${kind}`;
}
