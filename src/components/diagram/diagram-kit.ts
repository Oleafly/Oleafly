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

function useThemeMode(): "light" | "dark" {
  const { theme } = useTheme();
  return theme === "dark" ? "dark" : "light";
}

function usePrimaryColor(): string {
  return useSettingsStore((s) => s.accentColor);
}

export const KIT: Omit<DiagramKit, "t"> = {
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
