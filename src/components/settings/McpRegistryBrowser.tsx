import { useState, type FormEvent } from "react";
import { ChevronRight, Loader2, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  mcpRegistrySearch,
  type McpRegistryReview,
  type McpRegistrySearchResult,
  type McpServerConfig,
} from "@/lib/tauri";

type McpRegistryBrowserProps = {
  onReview: (config: McpServerConfig) => void;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function ReviewCard({ review, onReview }: { review: McpRegistryReview; onReview: (config: McpServerConfig) => void }) {
  const config = review.config;
  return (
    <div className="space-y-2 rounded-md border bg-background p-2.5 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{review.transport}</Badge>
        <span className="min-w-0 break-all font-mono text-[11px]">{review.commandOrUrl}</span>
      </div>
      {review.arguments.length > 0 ? <p className="break-all text-muted-foreground">Arguments: {review.arguments.join(" ")}</p> : null}
      {review.environmentVariableNames.length > 0 ? <p className="break-words text-muted-foreground">Environment: {review.environmentVariableNames.join(", ")}</p> : null}
      {review.unsupportedReason ? (
        <p role="status" className="text-destructive">{review.unsupportedReason}</p>
      ) : config ? (
        <Button type="button" size="xs" variant="outline" onClick={() => onReview(config)}>
          Review before adding
          <ChevronRight aria-hidden />
        </Button>
      ) : null}
    </div>
  );
}

export function McpRegistryBrowser({ onReview }: McpRegistryBrowserProps) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<McpRegistrySearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async (cursor?: string | null) => {
    const trimmed = query.trim();
    if (!trimmed) {
      setError("Enter a server name to search the official MCP registry.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const next = await mcpRegistrySearch({ query: trimmed, cursor: cursor ?? null });
      setResult((current) => cursor && current ? { ...next, servers: [...current.servers, ...next.servers] } : next);
    } catch (searchError) {
      setError(errorMessage(searchError));
    } finally {
      setLoading(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void search();
  };

  return (
    <section className="space-y-3 rounded-lg border bg-card p-3" aria-labelledby="mcp-registry-heading">
      <div className="space-y-1">
        <h3 id="mcp-registry-heading" className="text-sm font-medium">Official MCP registry</h3>
        <p className="text-xs leading-relaxed text-muted-foreground">Search public server metadata. Nothing is installed or started here. Review the command or URL before you add it.</p>
      </div>
      <form className="flex gap-2" onSubmit={submit}>
        <Input aria-label="Search the official MCP registry" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search server names" maxLength={256} />
        <Button type="submit" size="sm" disabled={loading}>
          {loading ? <Loader2 className="animate-spin" aria-hidden /> : <Search aria-hidden />}
          Search
        </Button>
      </form>
      {error ? <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p> : null}
      {result && result.servers.length === 0 ? <p role="status" className="text-xs text-muted-foreground">No matching registry entries were returned.</p> : null}
      {result?.warnings.length ? (
        <ul role="status" className="m-0 list-none space-y-1 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          {result.warnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      ) : null}
      {result?.servers.map((server) => (
        <article key={`${server.name}:${server.version}`} className="space-y-2 rounded-md border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="break-all text-sm font-medium">{server.name}</h4>
            <Badge variant="quiet">v{server.version}</Badge>
            {server.status ? <Badge variant="outline">{server.status}</Badge> : null}
          </div>
          {server.description ? <p className="text-xs leading-relaxed text-muted-foreground">{server.description}</p> : null}
          {server.reviews.length > 0 ? <div className="space-y-2">{server.reviews.map((review) => <ReviewCard key={review.label} review={review} onReview={onReview} />)}</div> : <p className="text-xs text-muted-foreground">This entry does not list a package or remote transport Oleafly can review.</p>}
        </article>
      ))}
      {result?.nextCursor ? <Button type="button" size="xs" variant="outline" disabled={loading} onClick={() => void search(result.nextCursor)}>{loading ? <Loader2 className="animate-spin" aria-hidden /> : null}Load more</Button> : null}
    </section>
  );
}
