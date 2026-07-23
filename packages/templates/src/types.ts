import type { ComponentPropsWithRef, ComponentType, ReactNode } from "react";

// A structural subset of the host's richer manifest type; extra fields pass
// through untouched.
export interface TemplateInfo {
  id: string;
  name: string;
  description: string;
  category: string;
  engine: string;
  document_engine: "latex" | "typst" | "markdown" | "unknown";
  ats_profile: "friendly" | "design-forward" | null;
  default_color: string | null;
  license: { spdx?: string | null; author?: string | null } | null;
  has_preview: boolean;
  assets_ready: boolean;
  source: string;
}

export interface TemplatesHost {
  loadPreview(templateId: string): Promise<string | null>;
  ensureAssets(
    templateId: string,
    onProgress: (label: string, index: number, total: number) => void,
  ): Promise<void>;
  logError(scope: string, e: unknown): void;
}

export interface TemplatesKit {
  Input: ComponentType<ComponentPropsWithRef<"input">>;
  Button: ComponentType<{
    variant?: "default" | "secondary" | "outline" | "ghost" | "ghostPrimary" | "destructive" | "link";
    size?: "default" | "sm" | "lg" | "icon";
    onClick?: () => void;
    disabled?: boolean;
    className?: string;
    "aria-label"?: string;
    "data-testid"?: string;
    children?: ReactNode;
  }>;
  Tooltip: ComponentType<{ label: ReactNode; children: ReactNode }>;
  Select: ComponentType<{
    value: string;
    onValueChange: (value: string) => void;
    options: { value: string; label: string }[];
    className?: string;
    "aria-label"?: string;
    "data-testid"?: string;
  }>;
}
