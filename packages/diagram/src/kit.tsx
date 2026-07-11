import { createContext, useContext, type ComponentType, type ReactNode } from "react";

/**
 * UI primitives the host app injects so this package never imports the app's
 * component library directly. The prop shapes are structural subsets of the
 * app's shadcn components, so the app can pass them through unchanged.
 */
export interface DiagramKit {
  Button: ComponentType<{
    variant?: "default" | "secondary" | "outline" | "ghost" | "destructive" | "link";
    size?: "default" | "sm" | "lg" | "icon";
    onClick?: () => void;
    disabled?: boolean;
    className?: string;
    children?: ReactNode;
  }>;
  Tooltip: ComponentType<{
    label: ReactNode;
    side?: "top" | "bottom" | "left" | "right";
    children: ReactNode;
  }>;
  Select: ComponentType<{
    value: string;
    onValueChange: (v: string) => void;
    children?: ReactNode;
  }>;
  SelectTrigger: ComponentType<{ className?: string; children?: ReactNode }>;
  SelectValue: ComponentType<{ placeholder?: string }>;
  SelectContent: ComponentType<{ className?: string; children?: ReactNode }>;
  SelectItem: ComponentType<{ value: string; className?: string; children?: ReactNode }>;
  toast: { success: (msg: string) => void; error: (msg: string) => void };
  /** Current app theme, used as the canvas default. Must be a valid hook. */
  useThemeMode: () => "light" | "dark";
}

export const DiagramKitContext = createContext<DiagramKit | null>(null);

export function useDiagramKit(): DiagramKit {
  const kit = useContext(DiagramKitContext);
  if (!kit) throw new Error("DiagramKitContext is missing. Wrap the diagram UI in a provider.");
  return kit;
}
