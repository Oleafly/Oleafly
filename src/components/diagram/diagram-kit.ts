import type { DiagramKit } from "@oleafly/diagram";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ColorInput } from "@/components/ui/color-input";
import { ColorPicker } from "@/components/ui/color-picker";
import { Tooltip } from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSettingsStore } from "@/store/settings";
import { useTheme } from "@/lib/theme";
import { toast } from "@/lib/toast";

// Split out of DiagramComposer.tsx so lightweight consumers (the inline
// diagram-canvas view in Editor.tsx) don't have to eagerly pull in the full
// composer module (compile/save/AI-fix logic, @oleafly/diagram's index).
function useThemeMode(): "light" | "dark" {
  const { theme } = useTheme();
  return theme === "dark" ? "dark" : "light";
}

function usePrimaryColor(): string {
  return useSettingsStore((s) => s.accentColor);
}

export const KIT: DiagramKit = {
  Button,
  Input,
  Textarea,
  ColorInput,
  ColorPicker,
  Tooltip,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
  useThemeMode,
  usePrimaryColor,
};
