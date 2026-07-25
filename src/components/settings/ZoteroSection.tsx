import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useZoteroConnectorStore } from "@/store/zotero-connector";

export function ZoteroSection() {
  const { connected, loading, connect, disconnect, refresh } = useZoteroConnectorStore();
  const [apiKey, setApiKey] = useState("");
  const [userId, setUserId] = useState("");

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div data-testid="zotero-section" className="space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">Zotero</h3>
          <p className="text-xs text-muted-foreground">
            Import citations and references from your Zotero library.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            To get a key: sign in at{" "}
            <a
              href="https://www.zotero.org"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              zotero.org
            </a>
            , open your{" "}
            <a
              href="https://www.zotero.org/settings/security#applications"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              API key page
            </a>
            {" "}to create a key, and copy your numeric user ID from the same page.
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
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="User ID"
            aria-label="Zotero user ID"
            className="w-28"
          />
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Zotero API key"
            aria-label="Zotero API key"
            className="max-w-xs"
          />
          <Button
            size="sm"
            disabled={loading || !apiKey.trim() || !userId.trim()}
            onClick={() => {
              void connect(userId.trim(), apiKey.trim()).then(() => {
                setApiKey("");
                setUserId("");
              });
            }}
          >
            Connect
          </Button>
        </div>
      )}
    </div>
  );
}
