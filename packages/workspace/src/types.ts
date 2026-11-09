import type { ReactNode } from "react";

export type Badge = number | string | boolean;

export interface ViewInfo {
  title: string;
  icon?: ReactNode;
  closable?: boolean;
  badge?: Badge;
  badgeLabel?: string;
  actions?: ReactNode;
  minWidth?: number;
  minHeight?: number;
}

export interface WorkspaceLabels {
  closeTab: (title: string) => string;
  closePanel: string;
  newTab: string;
  maximize: string;
  restore: string;
  resize: string;
  resizeSections?: string;
  collapseSection?: (title: string) => string;
  expandSection?: (title: string) => string;
  moveSection?: (title: string) => string;
}

export type TooltipSide = "top" | "bottom" | "left" | "right";

export interface TooltipOptions {
  side: TooltipSide;
  className?: string;
}

export type RenderTooltip = (label: string, trigger: ReactNode, options: TooltipOptions) => ReactNode;
