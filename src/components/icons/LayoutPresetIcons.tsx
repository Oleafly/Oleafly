import type { ComponentType, ReactNode, SVGProps } from "react";
import type { LayoutPreset } from "@/store/settings";

type IconProps = SVGProps<SVGSVGElement>;

const AI_PANE = "M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4z";
const AI_FULL = "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z";
const SPARKLE = "M12 7.5l1.35 3.15L16.5 12l-3.15 1.35L12 16.5l-1.35-3.15L7.5 12l3.15-1.35z";

function LayoutIcon({ className, children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      {...props}
    >
      {children}
      <rect x="3" y="3" width="18" height="18" rx="2" />
    </svg>
  );
}

function AiPane({ d = AI_PANE }: { d?: string }) {
  return <path d={d} fill="currentColor" stroke="none" opacity={0.28} />;
}

function Page({ d }: { d: string }) {
  return <path d={d} strokeWidth={1.5} />;
}

export function EditorPreviewAiLayoutIcon(props: IconProps) {
  return (
    <LayoutIcon {...props}>
      <AiPane />
      <path d="M9 3v18M15 3v18M5.5 8h1M5.5 12h1M5.5 16h1" />
    </LayoutIcon>
  );
}

export function EditorPreviewLayoutIcon(props: IconProps) {
  return (
    <LayoutIcon {...props}>
      <path d="M12 3v18M6 8h3M6 12h3M6 16h3" />
      <Page d="M14.5 7h2.5l2 2v8h-4.5z" />
    </LayoutIcon>
  );
}

export function EditorAiLayoutIcon(props: IconProps) {
  return (
    <LayoutIcon {...props}>
      <AiPane />
      <path d="M15 3v18M6 8h6M6 12h6M6 16h6" />
    </LayoutIcon>
  );
}

export function PreviewAiLayoutIcon(props: IconProps) {
  return (
    <LayoutIcon {...props}>
      <AiPane />
      <path d="M15 3v18" />
      <Page d="M6.5 7h3l2 2v8h-5z" />
    </LayoutIcon>
  );
}

export function EditorOnlyLayoutIcon(props: IconProps) {
  return (
    <LayoutIcon {...props}>
      <path d="M7 8h10M7 12h10M7 16h10" />
    </LayoutIcon>
  );
}

export function PreviewOnlyLayoutIcon(props: IconProps) {
  return (
    <LayoutIcon {...props}>
      <Page d="M8 6.5h6l2 2v9h-8z" />
    </LayoutIcon>
  );
}

export function AiOnlyLayoutIcon(props: IconProps) {
  return (
    <LayoutIcon {...props}>
      <AiPane d={AI_FULL} />
      <path d={SPARKLE} fill="currentColor" stroke="none" />
    </LayoutIcon>
  );
}

export const LAYOUT_PRESET_ICONS: Record<LayoutPreset, ComponentType<IconProps>> = {
  "editor-preview-ai": EditorPreviewAiLayoutIcon,
  "editor-preview": EditorPreviewLayoutIcon,
  "editor-ai": EditorAiLayoutIcon,
  "preview-ai": PreviewAiLayoutIcon,
  "editor-only": EditorOnlyLayoutIcon,
  "preview-only": PreviewOnlyLayoutIcon,
  "ai-only": AiOnlyLayoutIcon,
};
