export interface MathRenderResult {
  status: "ready" | "error";
  html: string;
  message?: string;
}

export type MathRenderPort = (body: string, display: boolean) => MathRenderResult;

export type AssetUrlResolver = (path: string) => Promise<string | null>;

export interface WysiwygExtensionOptions {
  renderMath?: MathRenderPort;
  resolveAssetUrl?: AssetUrlResolver;
}
