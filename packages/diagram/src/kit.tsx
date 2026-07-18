import {
  createContext,
  useContext,
  type ChangeEvent,
  type ComponentPropsWithRef,
  type ComponentType,
  type ReactNode,
} from "react";

// UI primitives the host app injects so this package never imports the app's
// component library directly. The prop shapes are structural subsets of the
// app's shadcn components, so the app can pass them through unchanged.
export interface DiagramKit {
  Input: ComponentType<ComponentPropsWithRef<"input">>;
  Textarea: ComponentType<ComponentPropsWithRef<"textarea">>;
  ColorInput: ComponentType<{
    value?: string;
    onChange: (event: ChangeEvent<HTMLInputElement>) => void;
    "aria-label"?: string;
    className?: string;
  }>;
  ColorPicker: ComponentType<{
    value: string;
    onChange: (value: string) => void;
    allowTransparent?: boolean;
    ariaLabel: string;
  }>;
  Button: ComponentType<{
    variant?: "default" | "secondary" | "outline" | "ghost" | "destructive" | "link";
    size?: "default" | "sm" | "lg" | "icon";
    onClick?: () => void;
    disabled?: boolean;
    className?: string;
    "data-testid"?: string;
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
  useThemeMode: () => "light" | "dark";
  usePrimaryColor: () => string;
}

export const DiagramKitContext = createContext<DiagramKit | null>(null);

export function useDiagramKit(): DiagramKit {
  const kit = useContext(DiagramKitContext);
  if (!kit) throw new Error("DiagramKitContext is missing. Wrap the diagram UI in a provider.");
  return kit;
}
