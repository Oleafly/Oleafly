import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAlphaXivConnectorStore } from "@/store/alphaxiv-connector";

export function AlphaXivSection() {
  const { connected, loading, connect, disconnect, refresh } = useAlphaXivConnectorStore();
  const [apiKey, setApiKey] = useState("");

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div data-testid="alphaxiv-section" className="space-y-2 border-b pb-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">alphaXiv</h3>
          <p className="text-xs text-muted-foreground">
            Literature search and paper analysis tools for the assistant.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            To get a key: sign in at{" "}
            <a
              href="https://www.alphaxiv.org"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              alphaxiv.org
            </a>
            , open your{" "}
            <a
              href="https://www.alphaxiv.org/@api-key"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              API key page
            </a>
            , generate a key (it starts with{" "}
            <code className="rounded bg-muted px-1 py-0.5">axv1_</code>), and paste it below.
          </p>
        </div>
        {connected && (
          <Button variant="outline" size="sm" onClick={() => void disconnect()} disabled={loading}>
            Disconnect
          </Button>
        )}
      </div>
      {!connected && (
        <div className="flex gap-2">
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="alphaXiv API key"
            aria-label="alphaXiv API key"
            className="max-w-xs"
          />
          <Button
            size="sm"
            disabled={loading || !apiKey.trim()}
            onClick={() => {
              void connect(apiKey.trim()).then(() => setApiKey(""));
            }}
          >
            Connect
          </Button>
        </div>
      )}
    </div>
  );
}
