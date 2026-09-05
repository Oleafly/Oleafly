import { useRef, useState } from "react";
import { Download, RotateCcw, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useTheme, type Theme } from "@/lib/theme";
import {
  MAX_THEME_IMPORT_BYTES,
  THEME_TOKEN_NAMES,
  applyThemeCustomization,
  parseThemeCustomizationJson,
  readThemeCustomization,
  resetThemeCustomization,
  serializeThemeCustomization,
  writeThemeCustomization,
  type ThemeCustomization as ThemeCustomizationState,
  type ThemeTokenName,
} from "@/lib/theme-customization";

const TOKEN_LABELS: Record<ThemeTokenName, string> = {
  background: "Background",
  foreground: "Text",
  card: "Panel",
  "card-foreground": "Panel text",
  popover: "Popover",
  "popover-foreground": "Popover text",
  primary: "Primary",
  "primary-foreground": "Primary text",
  secondary: "Secondary",
  "secondary-foreground": "Secondary text",
  muted: "Muted",
  "muted-foreground": "Muted text",
  accent: "Accent",
  "accent-foreground": "Accent text",
  destructive: "Danger",
  "destructive-foreground": "Danger text",
  border: "Border",
  input: "Input border",
  ring: "Focus ring",
  sidebar: "Sidebar",
  "sidebar-foreground": "Sidebar text",
  "sidebar-border": "Sidebar border",
  "sidebar-accent": "Sidebar accent",
  "sidebar-accent-foreground": "Sidebar accent text",
};

function downloadTheme(customization: ThemeCustomizationState) {
  const blob = new Blob([serializeThemeCustomization(customization)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "oleafly-theme.json";
  link.click();
  URL.revokeObjectURL(url);
}

export function ThemeCustomization() {
  const { theme } = useTheme();
  const [customization, setCustomization] = useState<ThemeCustomizationState>(() => readThemeCustomization());
  const [editMode, setEditMode] = useState<Theme>(theme);
  const [tokenDrafts, setTokenDrafts] = useState<Record<Theme, Partial<Record<ThemeTokenName, string>>>>({ light: {}, dark: {} });
  const [radiusDraft, setRadiusDraft] = useState<string | null>(null);
  const [customCssDraft, setCustomCssDraft] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const tokens = customization[editMode];

  const save = (next: ThemeCustomizationState, notice?: string) => {
    const saved = writeThemeCustomization(next);
    setCustomization(saved);
    applyThemeCustomization(theme, saved);
    setMessage(notice ?? null);
  };

  const updateToken = (token: ThemeTokenName, value: string, reportError = false) => {
    setTokenDrafts((current) => ({ ...current, [editMode]: { ...current[editMode], [token]: value } }));
    const nextTokens = { ...tokens };
    if (value.trim()) nextTokens[token] = value.trim();
    else delete nextTokens[token];
    try {
      save({ ...customization, [editMode]: nextTokens });
    } catch (error) {
      if (reportError) setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const resetMode = () => {
    setTokenDrafts((current) => ({ ...current, [editMode]: {} }));
    save({ ...customization, [editMode]: {} }, `${editMode === "light" ? "Light" : "Dark"} tokens restored.`);
  };

  const resetAll = () => {
    const restored = resetThemeCustomization();
    setCustomization(restored);
    setTokenDrafts({ light: {}, dark: {} });
    setRadiusDraft(null);
    setCustomCssDraft(null);
    applyThemeCustomization(theme, restored);
    setMessage("Theme customization cleared.");
  };

  const importTheme = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_THEME_IMPORT_BYTES) {
      setMessage("Theme file is larger than 128 KiB.");
      return;
    }
    try {
      const imported = parseThemeCustomizationJson(await file.text());
      save(imported, "Theme imported and applied.");
      setTokenDrafts({ light: {}, dark: {} });
      setRadiusDraft(null);
      setCustomCssDraft(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (importInput.current) importInput.current.value = "";
    }
  };

  return (
    <section className="space-y-3 rounded-lg border bg-card p-3" aria-labelledby="theme-customization-heading">
      <div className="space-y-1">
        <h3 id="theme-customization-heading" className="text-sm font-medium">Theme customization</h3>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Change app color tokens for each mode. Changes are saved locally and take effect straight away.
        </p>
      </div>

      <fieldset className="flex flex-wrap items-center gap-2" aria-label="Theme mode to edit">
        {(["light", "dark"] as const).map((mode) => (
          <Button
            key={mode}
            type="button"
            size="xs"
            variant={editMode === mode ? "default" : "outline"}
            aria-pressed={editMode === mode}
            onClick={() => setEditMode(mode)}
          >
            {mode === "light" ? "Light mode" : "Dark mode"}
          </Button>
        ))}
        <Button type="button" size="xs" variant="ghost" onClick={resetMode}>
          <RotateCcw aria-hidden />
          Reset this mode
        </Button>
      </fieldset>

      <div className="grid gap-2 sm:grid-cols-2">
        {THEME_TOKEN_NAMES.map((token) => (
          <div key={token} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] items-center gap-2 text-xs">
            <span className="truncate text-muted-foreground" title={token}>{TOKEN_LABELS[token]}</span>
            <Input
              aria-label={`${TOKEN_LABELS[token]} token for ${editMode} mode`}
              value={tokenDrafts[editMode][token] ?? tokens[token] ?? ""}
              onChange={(event) => updateToken(token, event.target.value)}
              onBlur={(event) => updateToken(token, event.target.value, true)}
              placeholder="Default"
              className="h-8 font-mono text-[11px]"
            />
          </div>
        ))}
      </div>

      <div className="space-y-1 text-xs">
        <span className="font-medium">Corner radius</span>
        <span className="block text-muted-foreground">Use a value such as 8px, 0.5rem, or 1em. Leave it blank for the default.</span>
        <Input
          aria-label="Corner radius"
          value={radiusDraft ?? customization.radius ?? ""}
          onChange={(event) => {
            setRadiusDraft(event.target.value);
            try {
              save({ ...customization, radius: event.target.value || null });
            } catch {
              setMessage(null);
            }
          }}
          onBlur={(event) => {
            try {
              save({ ...customization, radius: event.target.value || null });
              setRadiusDraft(null);
            } catch (error) {
              setMessage(error instanceof Error ? error.message : String(error));
            }
          }}
          placeholder="0.625rem"
          className="h-8 max-w-44 font-mono text-[11px]"
        />
      </div>

      <div className="space-y-1 text-xs">
        <span className="font-medium">Scoped CSS declarations</span>
        <span className="block text-muted-foreground">Optional declarations apply only inside the app. Rules, imports, and URLs are blocked.</span>
        <Textarea
          aria-label="Scoped CSS declarations"
          value={customCssDraft ?? customization.customCss ?? ""}
          onChange={(event) => {
            setCustomCssDraft(event.target.value);
            try {
              save({ ...customization, customCss: event.target.value || null });
            } catch {
              setMessage(null);
            }
          }}
          onBlur={(event) => {
            try {
              save({ ...customization, customCss: event.target.value || null });
              setCustomCssDraft(null);
            } catch (error) {
              setMessage(error instanceof Error ? error.message : String(error));
            }
          }}
          placeholder="color: #202020; --oleafly-note: #f6d365"
          className="min-h-20 font-mono text-[11px]"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" size="xs" variant="outline" onClick={() => downloadTheme(customization)}>
          <Download aria-hidden />
          Export theme
        </Button>
        <Button type="button" size="xs" variant="outline" onClick={() => importInput.current?.click()}>
          <Upload aria-hidden />
          Import theme
        </Button>
        <Button type="button" size="xs" variant="ghost" onClick={resetAll}>
          <RotateCcw aria-hidden />
          Reset all
        </Button>
        <input
          ref={importInput}
          className="sr-only"
          type="file"
          accept="application/json,.json"
          aria-label="Import theme file"
          onChange={(event) => void importTheme(event.currentTarget.files?.[0])}
        />
      </div>
      {message ? <p role="status" className="text-xs text-muted-foreground">{message}</p> : null}
    </section>
  );
}
