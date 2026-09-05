import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { acpError, acpInstall, acpRegister, acpRegistrySearch, acpRemoveAgent, type AcpDefinition, type AcpRegistryEntry } from "@/lib/acp";
import { useAcpSessionsStore } from "@/store/acp-sessions";
import { useSettingsStore } from "@/store/settings";
import { useTerminalsStore } from "@/store/terminals";

const button = "rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50";
const example = JSON.stringify({ id: "my-agent", name: "My agent", version: "1.0.0", description: "An installed ACP agent.", distribution: { command: { executable: "/absolute/path/to/my-agent", args: ["--acp"] } } }, null, 2);

export function AcpAgentsTab({ projectId }: { projectId?: string | null }) {
  const catalog = useAcpSessionsStore((state) => state.catalog);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AcpRegistryEntry[]>([]);
  const [definition, setDefinition] = useState("");
  const [review, setReview] = useState<AcpDefinition | null>(null);

  useEffect(() => { void useAcpSessionsStore.getState().refreshCatalog().catch((value: unknown) => setError(acpError(value))); }, []);
  const action = async (key: string, work: () => Promise<void>) => {
    setBusy(key); setError(null); setNotice(null);
    try { await work(); } catch (value) { setError(acpError(value)); }
    finally { setBusy(null); }
  };
  const register = (json: string) => action("register", async () => {
    const registered = await acpRegister(json);
    await useAcpSessionsStore.getState().refreshCatalog();
    setReview(null);
    setNotice(`${registered.name} is registered. Registration does not install or launch it.`);
  });
  const openTerminal = () => {
    if (!projectId) return;
    const terminals = useTerminalsStore.getState();
    terminals.setProject(projectId);
    terminals.addTerminal();
    useSettingsStore.getState().setTerminalOpen(true);
    setNotice("The project terminal is open. Run the sign-in command shown for your agent, then reconnect the conversation.");
  };

  return <section className="space-y-5" aria-label="ACP agents">
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">CLI agents</h3>
      <p className="text-xs leading-relaxed text-muted-foreground">Connect a local agent through ACP. Each agent manages its own models, tools and sign-in. API provider settings are separate.</p>
      <p className="text-xs leading-relaxed text-muted-foreground">Use the official CLI account for sign-in. Oleafly does not import account tokens or estimate subscription quotas.</p>
      <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" type="button" className={button} disabled={!!busy} onClick={() => void action("preflight", () => useAcpSessionsStore.getState().refreshCatalog(true))}>Check installed agents</Button>
      {projectId && <Button variant="outline" size="sm" type="button" className={button} onClick={openTerminal}>Open sign-in terminal</Button>}</div>
    </div>
    {error && <p role="alert" className="rounded-md border border-destructive/40 p-2 text-xs text-destructive">{error}</p>}
    {notice && <p role="status" className="rounded-md border border-border p-2 text-xs">{notice}</p>}
    <div className="space-y-3">
      {catalog.map((agent) => <article key={agent.definition.id} className="space-y-2 rounded-lg border border-border p-3">
        <div className="flex items-center justify-between gap-2"><h4 className="text-sm font-medium">{agent.definition.name}</h4><span className="text-xs text-muted-foreground">{agent.installed ? agent.managed ? `Installed ${agent.installedVersion}` : "Found on PATH" : "Not installed"}</span></div>
        <p className="text-xs text-muted-foreground">Pinned version {agent.definition.version} · {agent.platform}</p>
        {agent.executable && <p className="break-all font-mono text-[11px] text-muted-foreground">{agent.executable}</p>}
        {agent.reason && <p className="text-xs text-muted-foreground">{agent.reason}</p>}
        {agent.taskUnavailableReason && <p className="text-xs text-muted-foreground">{agent.taskUnavailableReason}</p>}
        <p className="text-xs text-muted-foreground">{agent.signInHint}</p>
        <div className="flex flex-wrap gap-2">
          {(!agent.installed || !agent.managed) && <Button variant="outline" size="sm" type="button" className={button} disabled={!!busy || !agent.canInstall} onClick={() => setReview(agent.definition)}>Review installation</Button>}
          {!agent.definition.builtin && <Button variant="outline" size="sm" type="button" className={button} disabled={!!busy} onClick={() => void action(agent.definition.id, async () => { await acpRemoveAgent(agent.definition.id); await useAcpSessionsStore.getState().refreshCatalog(); setNotice("Agent definition removed. Installed files and saved conversations remain available."); })}>Remove definition</Button>}
        </div>
      </article>)}
    </div>
    {review && <fieldset className="space-y-3 rounded-lg border border-border bg-muted/30 p-3" aria-label="Review agent installation">
      <h4 className="text-sm font-medium">Install {review.name} {review.version}</h4>
      <p className="text-xs text-muted-foreground">This downloads the pinned distribution to Oleafly's local agent directory. The agent runs with your account when you start a conversation.</p>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all text-[11px]">{JSON.stringify(review.distribution, null, 2)}</pre>
      <div className="flex gap-2"><Button variant="outline" size="sm" type="button" className={button} disabled={!!busy} onClick={() => void action("install", async () => { if (!catalog.some((agent) => agent.definition.id === review.id)) await acpRegister(JSON.stringify(review)); await acpInstall(review.id); await useAcpSessionsStore.getState().refreshCatalog(true); setNotice(`${review.name} is installed. Sign in through its CLI before starting a conversation.`); setReview(null); })}>{busy === "install" ? "Installing…" : "Install pinned version"}</Button><Button variant="outline" size="sm" type="button" className={button} disabled={!!busy} onClick={() => setReview(null)}>Cancel</Button></div>
    </fieldset>}
    <form className="space-y-2 border-t border-border pt-4" onSubmit={(event) => { event.preventDefault(); void action("search", async () => setResults(await acpRegistrySearch(query))); }}>
      <label className="block text-sm font-medium" htmlFor="acp-registry-search">Find an ACP agent</label>
      <div className="flex gap-2"><Input id="acp-registry-search" className="min-w-0 flex-1 rounded-md border border-border bg-background p-2 text-xs" placeholder="Search the ACP registry" value={query} maxLength={200} onChange={(event) => setQuery(event.target.value)} /><Button variant="outline" size="sm" className={button} type="submit" disabled={!!busy}>{busy === "search" ? "Searching…" : "Search"}</Button></div>
      <p className="text-xs text-muted-foreground">Registry entries describe software from its publishers. Review the distribution before registering or installing it.</p>
    </form>
    {results.length > 0 && <div className="max-h-80 space-y-2 overflow-y-auto">{results.map((entry) => <article key={entry.id} className="space-y-2 rounded-md border border-border p-3">
      <h4 className="text-sm font-medium">{entry.name} <span className="font-normal text-muted-foreground">{entry.version}</span></h4>
      <p className="text-xs text-muted-foreground">{entry.description}</p>
      {entry.reason && <p className="text-xs text-muted-foreground">{entry.reason}</p>}
      {entry.definition && <details><summary className="cursor-pointer text-xs">Distribution</summary><pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all text-[11px]">{JSON.stringify(entry.definition.distribution, null, 2)}</pre></details>}
      <Button variant="outline" size="sm" type="button" className={button} disabled={!!busy || !entry.definition || catalog.some((agent) => agent.definition.id === entry.id)} onClick={() => { if (entry.definition) void register(JSON.stringify(entry.definition)); }}>{catalog.some((agent) => agent.definition.id === entry.id) ? "Registered" : "Register agent"}</Button>
    </article>)}</div>}
    <form className="space-y-2 border-t border-border pt-4" onSubmit={(event) => { event.preventDefault(); void register(definition); }}>
      <label className="block text-sm font-medium" htmlFor="acp-custom-definition">Register a custom agent</label>
      <p className="text-xs text-muted-foreground">Paste an agent definition with a pinned npm or uv package, a verified binary, or an installed executable. Keep passwords and API keys out of this JSON.</p>
      <textarea id="acp-custom-definition" className="min-h-40 w-full rounded-md border border-border bg-background p-2 font-mono text-xs" value={definition} maxLength={65536} placeholder={example} onChange={(event) => setDefinition(event.target.value)} />
      <div className="flex gap-2"><Button variant="outline" size="sm" type="submit" className={button} disabled={!!busy || !definition.trim()}>Register definition</Button><Button variant="outline" size="sm" type="button" className={button} onClick={() => setDefinition(example)}>Use example</Button></div>
    </form>
  </section>;
}
