export interface MathRenderResult {
  status: "ready" | "error";
  html: string;
  message?: string;
}

export type MathRenderPort = (body: string, display: boolean) => MathRenderResult;

export type AssetUnavailable = Readonly<{ reason: "outside" | "unreadable" }>;

export type AssetUrlResolver = (path: string) => Promise<string | null | AssetUnavailable>;

export type LinkHrefLocalizer = (href: string) => string | null;

export type LinkHrefOpener = (href: string) => boolean;

export interface WysiwygExtensionOptions {
  renderMath?: MathRenderPort;
  resolveAssetUrl?: AssetUrlResolver;
  localizeLinkHref?: LinkHrefLocalizer;
  openLinkHref?: LinkHrefOpener;
  markdownTyping?: boolean;
}
