export type ConnectorCapability = "read" | "write" | "execute";
export type ConnectorAuthMode = "none" | "api-key";

export interface ConnectorManifest {
  id: string;
  name: string;
  capability: ConnectorCapability;
  auth: ConnectorAuthMode;
  docsUrl?: string;
  // Names of the AI tools this connector contributes, for display/debugging;
  // the tools themselves are defined and wired elsewhere (research-tools.ts).
  toolNames: string[];
}

const connectors = new Map<string, ConnectorManifest>();

export function registerConnector(manifest: ConnectorManifest): void {
  if (connectors.has(manifest.id)) {
    throw new Error(`Connector "${manifest.id}" is already registered.`);
  }
  connectors.set(manifest.id, manifest);
}

export function listConnectors(): ConnectorManifest[] {
  return Array.from(connectors.values());
}

export function getConnector(id: string): ConnectorManifest | undefined {
  return connectors.get(id);
}

// Internal helper for tests: registry state is module-level and persists across tests in the same file.
export function _clearRegistry(): void {
  connectors.clear();
}
