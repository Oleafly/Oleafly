import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ModalShell } from "@/components/ui/modal-shell";
import { i18n, loadNamespace } from "@/i18n";
import { logError } from "@/lib/log";
import type {
  CollabErrorCode,
  CollabProjectSummary,
  CollabServer,
} from "@/lib/tauri";
import {
  collabLinkPreview,
  collabOpenLink,
  collabShareInfo,
} from "@/lib/tauri-collab";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { AddServerDialog } from "../AddServerDialog";
import { collabErrorCode, collabErrorMessage, collabErrorText } from "../errors";
import { useCollabStore } from "../store";
import { useAddServerRequest } from "./add-server-request";
import { linkKey, parseAppLink, sameServer, type AppLink } from "./app-link";
import { JoinLinkDialog } from "./JoinLinkDialog";
import { JoinProgress, type JoinTarget } from "./JoinProgress";
import { openLinkedComment } from "./open-comment";

const DUPLICATE_WINDOW_MS = 5_000;
const READY_POLL_MS = 250;
const BUSY_DELAY_MS = 300;
const MODAL_OPEN = '[aria-modal="true"], [role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]';

type Notice =
  | { kind: "off" }
  | { kind: "malformed" }
  | { kind: "noAccess" }
  | { kind: "error"; code: CollabErrorCode; text: string };
type Step =
  | { kind: "idle" }
  | { kind: "notice"; notice: Notice }
  | { kind: "server"; url: string; baseline: readonly CollabServer[] }
  | { kind: "join"; server: CollabServer; project: CollabProjectSummary };
type OpenLink = Extract<AppLink, { kind: "openProject" }>;
type Reached = { localId: string } | { preview: CollabProjectSummary } | { code: CollabErrorCode; text: string };

function refused(error: unknown): { code: CollabErrorCode; text: string } {
  return { code: collabErrorCode(error), text: collabErrorText(error) };
}

function modalOpen(): boolean {
  return document.querySelector(MODAL_OPEN) !== null;
}

function useCollabCatalog(): boolean {
  const [loaded, setLoaded] = useState(() => i18n.hasResourceBundle("en", "collab"));
  useEffect(() => {
    if (loaded) return;
    let active = true;
    loadNamespace("collab").then(
      () => {
        if (active) setLoaded(true);
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [loaded]);
  return loaded;
}

async function serversReady(): Promise<CollabErrorCode | null> {
  const collab = useCollabStore.getState();
  if (collab.status !== "ready") await collab.load();
  const after = useCollabStore.getState();
  return after.status === "failed" ? (after.loadError ?? "internal") : null;
}

function findServer(address: string): CollabServer | undefined {
  return useCollabStore.getState().servers.find((entry) => sameServer(entry.url, address));
}

// The library project that is this shared project on this computer, if any.
async function localCopyOf(server: CollabServer, sharedProjectId: string): Promise<string | null> {
  const shared = useFilesStore.getState().projects.filter((project) => project.shared);
  for (const project of shared) {
    let info: Awaited<ReturnType<typeof collabShareInfo>>;
    try {
      info = await collabShareInfo(project.id);
    } catch {
      continue;
    }
    if (info?.shared_project_id === sharedProjectId && info.server_id === server.server_id) return project.id;
  }
  return null;
}

async function reach(server: CollabServer, link: OpenLink, agreed: boolean): Promise<Reached> {
  if (agreed) {
    try {
      return { localId: await collabOpenLink(link.link) };
    } catch (error) {
      return refused(error);
    }
  }
  // A link can come from any web page. A project already on this computer
  // opens without asking, and anything that would download one, even for
  // someone who is already a member, is shown first for the person to decide.
  const local = await localCopyOf(server, link.project);
  if (local !== null) return { localId: local };
  try {
    return { preview: await collabLinkPreview(server.server_id, link.project) };
  } catch (error) {
    return refused(error);
  }
}

function openComment(link: OpenLink, localId: string): void {
  if (link.comment) void openLinkedComment(localId, link.comment);
}

function failureNotice(code: CollabErrorCode, text = collabErrorMessage(code)): Notice {
  return code === "not_found" ? { kind: "noAccess" } : { kind: "error", code, text };
}

async function openLocal(localId: string): Promise<void> {
  if (useFilesStore.getState().projectId === localId) return;
  await useFilesStore.getState().refreshProjects();
  await useFilesStore.getState().openProject(localId);
}

async function addServer(url: string): Promise<void> {
  await serversReady();
  const known = findServer(url);
  if (!known?.signed_in) useAddServerRequest.getState().ask(known?.url ?? url);
  useSettingsStore.getState().openSettingsAt("collaboration");
}

function LinkNotice({ notice, onClose }: Readonly<{ notice: Notice; onClose: () => void }>) {
  const { t } = useTranslation(["collab", "common"]);
  const textId = useId();
  const text = (() => {
    switch (notice.kind) {
      case "off":
        return t(($) => $.collab.links.turnedOff);
      case "malformed":
        return t(($) => $.collab.links.malformed);
      case "noAccess":
        return t(($) => $.collab.library.openLink.noAccess);
      case "error":
        return notice.text;
    }
  })();
  const openSetting = () => {
    onClose();
    useSettingsStore.getState().openSettingsAt("experimentation");
  };
  return (
    <ModalShell
      open
      onClose={onClose}
      closeLabel={t(($) => $.common.actions.close)}
      width="sm"
      labelledBy={textId}
      className="space-y-3 p-4"
      testId="collab-link-notice"
    >
      <div className="flex items-start gap-3">
        <p id={textId} className="min-w-0 flex-1 select-text text-sm">
          {text}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          aria-label={t(($) => $.common.actions.close)}
          onClick={onClose}
        >
          <X aria-hidden className="size-4" />
        </Button>
      </div>
      {notice.kind === "off" ? (
        <div className="flex justify-end">
          <Button type="button" size="sm" variant="outline" data-modal-initial-focus onClick={openSetting}>
            {t(($) => $.collab.links.openSettings)}
          </Button>
        </div>
      ) : null}
    </ModalShell>
  );
}

function OpeningStatus({ target, onCancel }: Readonly<{ target: JoinTarget; onCancel: () => void }>) {
  return (
    <div
      className="fixed bottom-4 left-1/2 z-[85] w-80 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-lg border bg-background px-3 py-2 text-foreground shadow-lg"
      data-testid="collab-link-opening"
    >
      <JoinProgress target={target} name={null} onCancel={onCancel} />
    </div>
  );
}

interface FlowUi {
  setStep: (step: Step) => void;
  setBusy: (busy: JoinTarget | null) => void;
  setPending: (count: number) => void;
}

function createFlow(ui: FlowUi) {
  const queue: AppLink[] = [];
  const seen = new Map<string, number>();
  // Links the person ended on purpose, by declining the join or stopping the
  // download. The same link pasted or opened again right after is meant, so
  // the window that drops a link the system delivers twice doesn't apply.
  const ended = new Set<string>();
  let serverWait: ((server: CollabServer | null) => void) | null = null;
  let joinWait: ((join: boolean) => void) | null = null;
  // Set when the person stops the download, so whatever answer comes back
  // for that link is dropped instead of opening the project or an error.
  let stopped = false;

  const show = (notice: Notice) => ui.setStep({ kind: "notice", notice });

  const answerJoin = (join: boolean) => {
    const resolve = joinWait;
    joinWait = null;
    ui.setStep({ kind: "idle" });
    resolve?.(join);
  };

  const askToJoin = (server: CollabServer, project: CollabProjectSummary) =>
    new Promise<boolean>((resolve) => {
      joinWait = resolve;
      ui.setStep({ kind: "join", server, project });
    });

  const settleServer = (server: CollabServer | null) => {
    const resolve = serverWait;
    serverWait = null;
    ui.setStep({ kind: "idle" });
    resolve?.(server);
  };

  const askForServer = (url: string) =>
    new Promise<CollabServer | null>((resolve) => {
      serverWait = resolve;
      ui.setStep({ kind: "server", url, baseline: useCollabStore.getState().servers });
    });

  const whileBusy = async <T,>(target: JoinTarget, work: () => Promise<T>): Promise<T> => {
    const timer = window.setTimeout(() => ui.setBusy(target), BUSY_DELAY_MS);
    try {
      return await work();
    } finally {
      window.clearTimeout(timer);
      ui.setBusy(null);
    }
  };

  const openProject = async (link: OpenLink): Promise<void> => {
    const failed = await serversReady();
    if (failed) return show({ kind: "error", code: failed, text: collabErrorMessage(failed) });
    let server = findServer(link.server) ?? (await askForServer(link.server));
    let asked = false;
    let agreed = false;
    while (server) {
      const current: CollabServer = server;
      stopped = false;
      const target = { serverId: current.server_id, sharedProjectId: link.project };
      const reached = await whileBusy(target, async () => {
        const outcome = await reach(current, link, agreed);
        if ("localId" in outcome && !stopped) await openLocal(outcome.localId);
        return outcome;
      });
      if (stopped || ("code" in reached && reached.code === "cancelled")) {
        ended.add(linkKey(link));
        return;
      }
      if ("localId" in reached) {
        openComment(link, reached.localId);
        return;
      }
      if ("preview" in reached) {
        agreed = await askToJoin(current, reached.preview);
        if (!agreed) {
          ended.add(linkKey(link));
          return;
        }
        continue;
      }
      if (!asked && reached.code === "unauthorized") {
        asked = true;
        server = await askForServer(current.url);
        continue;
      }
      return show(failureNotice(reached.code, reached.text));
    }
  };

  const run = async (link: AppLink): Promise<void> => {
    if (!useSettingsStore.getState().liveCollaboration) {
      const now = Date.now();
      for (const rest of queue.splice(0)) seen.set(linkKey(rest), now);
      ui.setPending(0);
      return show({ kind: "off" });
    }
    switch (link.kind) {
      case "malformed":
        return show({ kind: "malformed" });
      case "addServer":
        return addServer(link.url);
      case "openProject":
        return openProject(link);
    }
  };

  return {
    accept(links: readonly string[]) {
      const now = Date.now();
      for (const raw of links) {
        const link = parseAppLink(raw);
        const key = linkKey(link);
        const last = seen.get(key);
        if (last !== undefined && now - last < DUPLICATE_WINDOW_MS) continue;
        seen.set(key, Number.POSITIVE_INFINITY);
        queue.push(link);
      }
      ui.setPending(queue.length);
    },
    next(): Promise<void> | null {
      const link = queue.shift();
      if (!link) return null;
      ui.setPending(queue.length);
      return run(link)
        .catch((error: unknown) => logError("collab open link", error))
        .finally(() => {
          const key = linkKey(link);
          if (ended.delete(key)) seen.delete(key);
          else seen.set(key, Date.now());
        });
    },
    stop() {
      stopped = true;
    },
    serverChanged(servers: readonly CollabServer[], step: Step) {
      if (step.kind !== "server" || servers === step.baseline) return;
      const match = servers.find((entry) => entry.signed_in && sameServer(entry.url, step.url));
      if (match) settleServer(match);
    },
    settleServer,
    answerJoin,
  };
}

export function LinkIntake({
  links,
  onTaken,
}: Readonly<{ links: readonly string[]; onTaken: (count: number) => void }>) {
  const catalog = useCollabCatalog();
  const loaded = useFilesStore((state) => state.projectsLoaded && !state.loading);
  const servers = useCollabStore((state) => state.servers);
  const [pending, setPending] = useState(0);
  const [working, setWorking] = useState(false);
  const [busy, setBusy] = useState<JoinTarget | null>(null);
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const flow = useRef<ReturnType<typeof createFlow> | null>(null);
  flow.current ??= createFlow({ setStep, setBusy, setPending });
  const ingested = useRef<readonly string[] | null>(null);
  const waiting = pending > 0 && !working && step.kind === "idle";

  useEffect(() => {
    if (links.length === 0 || links === ingested.current) return;
    ingested.current = links;
    flow.current?.accept(links);
    onTaken(links.length);
  }, [links, onTaken]);

  useEffect(() => {
    flow.current?.serverChanged(servers, step);
  }, [servers, step]);

  useEffect(() => {
    if (!waiting || !catalog || !loaded) return;
    const start = () => {
      if (modalOpen()) return false;
      const started = flow.current?.next();
      if (!started) return false;
      setWorking(true);
      void started.finally(() => setWorking(false));
      return true;
    };
    if (start()) return;
    const timer = window.setInterval(() => {
      if (start()) window.clearInterval(timer);
    }, READY_POLL_MS);
    return () => window.clearInterval(timer);
  }, [waiting, catalog, loaded]);

  return (
    <>
      {step.kind === "notice" ? <LinkNotice notice={step.notice} onClose={() => setStep({ kind: "idle" })} /> : null}
      {step.kind === "server" ? (
        <AddServerDialog open initialUrl={step.url} onClose={() => flow.current?.settleServer(null)} />
      ) : null}
      {step.kind === "join" ? (
        <JoinLinkDialog
          server={step.server}
          project={step.project}
          onAnswer={(join) => flow.current?.answerJoin(join)}
        />
      ) : null}
      {busy ? <OpeningStatus target={busy} onCancel={() => flow.current?.stop()} /> : null}
    </>
  );
}
