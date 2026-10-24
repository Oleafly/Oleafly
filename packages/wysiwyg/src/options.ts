export interface MathRenderResult {
  status: "ready" | "error";
  html: string;
  message?: string;
}

export type MathRenderPort = (body: string, display: boolean) => MathRenderResult;

export type AssetUrlResolver = (path: string) => Promise<string | null>;

export type LinkHrefLocalizer = (href: string) => string | null;

/** Opens the project file a link's href points at; false when it points at none. */
export type LinkHrefOpener = (href: string) => boolean;

export interface WysiwygExtensionOptions {
  renderMath?: MathRenderPort;
  resolveAssetUrl?: AssetUrlResolver;
  localizeLinkHref?: LinkHrefLocalizer;
  openLinkHref?: LinkHrefOpener;
}
