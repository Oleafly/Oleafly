import type { ComponentType, ReactNode } from "react";

/** The template fields the gallery reads (structural subset of the host's
 *  richer manifest type; extra fields pass through untouched). */
export interface TemplateInfo {
  id: string;
  name: string;
  description: string;
  category: string;
  engine: string;
  ats_profile: "friendly" | "design-forward" | null;
  default_color: string | null;
  license: { spdx?: string | null; author?: string | null } | null;
  has_preview: boolean;
  ready: boolean;
}

/** Services the gallery needs from the host app. */
export interface TemplatesHost {
  /** Page-1 preview as a data URI, or null when none exists. */
  loadPreview(templateId: string): Promise<string | null>;
  /** Download any missing fonts/packages for a template, reporting progress. */
  ensureAssets(
    templateId: string,
    onProgress: (label: string, index: number, total: number) => void,
  ): Promise<void>;
  logError(scope: string, e: unknown): void;
}

/** UI primitives injected by the host app (structural shadcn subsets). */
export interface TemplatesKit {
  Button: ComponentType<{
    variant?: "default" | "secondary" | "outline" | "ghost" | "destructive" | "link";
    size?: "default" | "sm" | "lg" | "icon";
    onClick?: () => void;
    disabled?: boolean;
    className?: string;
    "aria-label"?: string;
    children?: ReactNode;
  }>;
  Tooltip: ComponentType<{ label: ReactNode; children: ReactNode }>;
}
