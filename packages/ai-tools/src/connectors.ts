export type ConnectorCapability = "read" | "write" | "execute";
export type ConnectorAuthMode = "none" | "api-key";

export interface ConnectorManifest {
  id: string;
  name: string;
  capability: ConnectorCapability;
  auth: ConnectorAuthMode;
  docsUrl?: string;
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

export function _clearRegistry(): void {
  connectors.clear();
}
