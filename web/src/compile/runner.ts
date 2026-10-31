import {
  type BrowserEngine,
  type CompileOutput,
  type CompilePort,
  type CompileSources,
  CompileStopped,
  type CompileTarget,
  createBrowserCompilePort,
  type SyncTexIndex,
  type SyncTexOpener,
} from "@oleafly/compile-port";
import type { WebApi } from "../api";
import type { CollabOutputInfo } from "../protocol";
import { abilitiesFor } from "../roles";
import { patchCompile, useWeb } from "../store";
import { outputKey, sharedOutputs, shownLocal } from "./outputs";
import { readSources } from "./sources";
import { compileTargetOf } from "./target";

export interface CompileRunnerOptions {
  api: WebApi;
  projectId: string;
  engines?: () => Promise<readonly BrowserEngine[]>;
  openSyncTex?: SyncTexOpener;
  openText(path: string): string | null;
  setTimer?: (run: () => void, ms: number) => () => void;
  now?: () => number;
  autoDelayMs?: number;
  shareEveryMs?: number;
}

const AUTO_DELAY_MS = 1_200;
const SHARE_EVERY_MS = 60_000;

function defaultTimer(run: () => void, ms: number): () => void {
  const timer = setTimeout(run, ms);
  return () => clearTimeout(timer);
}

export class CompileRunner {
  private readonly options: CompileRunnerOptions;
  private readonly setTimer: (run: () => void, ms: number) => () => void;
  private readonly now: () => number;
  private port: CompilePort | null = null;
  private cancelAuto: (() => void) | null = null;
  private cancelShare: (() => void) | null = null;
  private sharing = false;
  private pendingShare: CompileOutput | null = null;
  private lastShareAt = Number.NEGATIVE_INFINITY;
  private sync: { key: string; index: Promise<SyncTexIndex | null> } | null = null;
  private reading: Map<string, string | null> | null = null;
  private compiled: Map<string, string | null> | null = null;
  private unsubscribe: (() => void) | null = null;
  private stopped = false;

  constructor(options: CompileRunnerOptions) {
    this.options = options;
    this.setTimer = options.setTimer ?? defaultTimer;
    this.now = options.now ?? Date.now;
  }

  async start(): Promise<void> {
    const engines = (await this.options.engines?.()) ?? [];
    if (this.stopped) return;
    const { api, projectId } = this.options;
    this.port = createBrowserCompilePort({
      engines,
      sources: async (signal) => {
        const read = await readSources(
          { api, projectId, files: () => useWeb.getState().files, openText: this.options.openText },
          signal,
        );
        const seen = new Map<string, string | null>();
        this.reading = seen;
        const recorded: CompileSources = {
          files: read.files,
          text(path) {
            if (!seen.has(path)) seen.set(path, read.text(path));
            return seen.get(path) ?? null;
          },
          bytes: (path) => read.bytes(path),
        };
        return recorded;
      },
      openSyncTex: this.options.openSyncTex ?? (async () => Promise.reject(new Error("SyncTeX is not available."))),
    });
    this.refreshReady();
    this.unsubscribe = useWeb.subscribe((state, previous) => {
      if (state.compileSettings !== previous.compileSettings || state.files !== previous.files) this.refreshReady();
      if (state.output !== previous.output) this.sharedChanged(state.output, previous.output);
    });
  }

  stop(): void {
    this.stopped = true;
    this.port?.stop();
    this.cancelAuto?.();
    this.cancelShare?.();
    this.unsubscribe?.();
    this.dropSyncIndex();
  }

  target(): CompileTarget | null {
    const state = useWeb.getState();
    return compileTargetOf(state.compileSettings, state.files);
  }

  async compile(): Promise<void> {
    this.cancelAuto?.();
    this.cancelAuto = null;
    const target = this.target();
    if (this.stopped || !this.port || !target || !this.port.supports(target)) return;
    patchCompile({ status: "running", error: null });
    try {
      const output = await this.port.compile(target);
      if (this.stopped) return;
      this.dropSyncIndex();
      this.compiled = this.reading;
      patchCompile({ status: output.ok ? "done" : "failed", output, finishedAt: this.now(), shown: "local" });
      if (output.pdf && this.mayShare()) this.queueShare(output);
    } catch (error) {
      if (this.stopped || error instanceof CompileStopped) return;
      patchCompile({ status: "failed", error: error instanceof Error ? error.message : String(error), shown: "local" });
    }
  }

  edited(): void {
    const compile = useWeb.getState().compile;
    if (this.stopped || !compile.ready || (compile.finishedAt === null && compile.status !== "running")) return;
    this.cancelAuto?.();
    this.cancelAuto = this.setTimer(() => {
      this.cancelAuto = null;
      void this.compile();
    }, this.options.autoDelayMs ?? AUTO_DELAY_MS);
  }

  compiledSource(path: string): string | null {
    if (!shownLocal(useWeb.getState()) || !this.compiled) return null;
    return this.compiled.get(path) ?? null;
  }

  syncIndex(): Promise<SyncTexIndex | null> {
    const state = useWeb.getState();
    const local = shownLocal(state);
    const shared = sharedOutputs(state.output);
    const onScreen = shared.pdf && state.compile.shownShared === outputKey(shared.pdf);
    const key = local
      ? `local:${state.compile.finishedAt}`
      : shared.pdf && shared.synctex && onScreen
        ? `shared:${outputKey(shared.pdf)}:${outputKey(shared.synctex)}`
        : null;
    if (!key || !this.port) return Promise.resolve(null);
    if (this.sync?.key !== key) {
      this.dropSyncIndex();
      const opening = local ? this.port.syncTex(local) : this.sharedIndex();
      this.sync = { key, index: opening.catch(() => null) };
    }
    return this.sync.index;
  }

  private async sharedIndex(): Promise<SyncTexIndex | null> {
    const { api, projectId, openSyncTex } = this.options;
    if (!openSyncTex) return null;
    const bytes = await api.output(projectId, "synctex");
    if (!bytes || this.stopped) return null;
    const paths = useWeb
      .getState()
      .files.filter((file) => file.kind === "text")
      .map((file) => file.path);
    return openSyncTex(bytes, paths);
  }

  dropSyncIndex(): void {
    const previous = this.sync;
    this.sync = null;
    void previous?.index.then((index) => index?.dispose());
  }

  private refreshReady(): void {
    const target = this.target();
    const ready = Boolean(target && this.port?.supports(target));
    if (useWeb.getState().compile.ready !== ready) patchCompile({ ready });
  }

  private mayShare(): boolean {
    const state = useWeb.getState();
    return abilitiesFor(state.role, state.features).share;
  }

  private sharedChanged(items: readonly CollabOutputInfo[], before: readonly CollabOutputInfo[]): void {
    const pdf = sharedOutputs(items).pdf;
    const key = outputKey(pdf);
    if (!pdf || key === outputKey(sharedOutputs(before).pdf)) return;
    const state = useWeb.getState();
    const ours = key === state.compile.sharedKey || (this.sharing && pdf.compiledBy === state.me?.accountId);
    if (!ours && state.compile.shown === "local") patchCompile({ shown: "shared" });
  }

  private queueShare(output: CompileOutput): void {
    this.pendingShare = output;
    if (this.sharing || this.cancelShare) return;
    const wait = this.lastShareAt + (this.options.shareEveryMs ?? SHARE_EVERY_MS) - this.now();
    if (wait > 0) {
      this.cancelShare = this.setTimer(() => {
        this.cancelShare = null;
        void this.share();
      }, wait);
      return;
    }
    void this.share();
  }

  private async share(): Promise<void> {
    const output = this.pendingShare;
    this.pendingShare = null;
    if (!output?.pdf || this.stopped || !this.mayShare()) return;
    const { api, projectId } = this.options;
    const main = output.target.mainDocument;
    this.sharing = true;
    this.lastShareAt = this.now();
    patchCompile({ share: "sharing" });
    try {
      const shared = await api.putOutput(projectId, "pdf", output.pdf, main);
      if (output.synctex) await api.putOutput(projectId, "synctex", output.synctex, main);
      if (!this.stopped) patchCompile({ share: "shared", sharedKey: outputKey(shared ?? undefined) });
    } catch {
      if (!this.stopped) patchCompile({ share: "failed" });
    } finally {
      this.sharing = false;
      if (this.pendingShare && !this.stopped) this.queueShare(this.pendingShare);
    }
  }
}
