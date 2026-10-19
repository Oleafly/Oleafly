import { useEffect, useState } from "react";
import { imageToLatexAvailable } from "@/features/image-to-latex";
import { toolsImageReady } from "@/features/tools-ai/tools-choice";
import type { AppConfig } from "@/lib/tauri";

/** Whether the editor toolbar offers Image to LaTeX/Typst. Checked on mount
 * and again whenever the AI settings change. */
export function useToolsImageReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    let latest = 0;
    const check = (answer: Promise<boolean>) => {
      const id = ++latest;
      const apply = (value: boolean) => {
        if (active && id === latest) setReady(value);
      };
      void answer.then(apply, () => apply(false));
    };
    check(imageToLatexAvailable());
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<AppConfig | undefined>).detail;
      // The event carries the config just written; without it, read it again.
      check(detail ? Promise.resolve().then(() => toolsImageReady(detail)) : imageToLatexAvailable());
    };
    window.addEventListener("oleafly:ai-config-changed", onChange);
    return () => {
      active = false;
      window.removeEventListener("oleafly:ai-config-changed", onChange);
    };
  }, []);
  return ready;
}
