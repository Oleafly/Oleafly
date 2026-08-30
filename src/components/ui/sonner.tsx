import { useEffect, useRef, useState } from "react";
import { Toaster as SonnerToaster, toast as sonnerToast } from "sonner";
import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import { useOccludeNativeWebview } from "@/lib/native-webview-occlusion";
import { useToastStore, type Toast } from "@/store/toast";

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  useOccludeNativeWebview(toasts.length > 0);
  const seenRef = useRef(new Map<number, Toast>());
  // The Toaster mounts outside ThemeProvider in the main window, so follow the
  // root element's theme class instead of the React context.
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    document.documentElement.classList.contains("dark") ? "dark" : "light",
  );

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      setTheme(root.classList.contains("dark") ? "dark" : "light");
    });
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const current = new Map(toasts.map((t) => [t.id, t]));
    for (const [id, t] of current) {
      const prev = seenRef.current.get(id);
      if (prev === t) continue;
      const show =
        t.kind === "error"
          ? sonnerToast.error
          : t.kind === "success"
            ? sonnerToast.success
            : sonnerToast.info;
      show(t.message, {
        id,
        duration: t.sticky ? Number.POSITIVE_INFINITY : 5000,
        action: t.action ? { label: t.action.label, onClick: t.action.onClick } : undefined,
        onDismiss: () => useToastStore.getState().dismiss(id),
        onAutoClose: () => useToastStore.getState().dismiss(id),
      });
    }
    for (const id of seenRef.current.keys()) {
      if (!current.has(id)) sonnerToast.dismiss(id);
    }
    seenRef.current = current;
  }, [toasts]);

  return (
    <SonnerToaster
      position="bottom-right"
      theme={theme}
      className="toaster group"
      closeButton
      icons={{
        success: <CheckCircle2 className="size-4 text-emerald-500" />,
        error: <AlertCircle className="size-4 text-destructive" />,
        info: <Info className="size-4 text-sky-500" />,
      }}
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-popover group-[.toaster]:text-popover-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:!bg-transparent group-[.toast]:!text-primary group-[.toast]:!p-0 group-[.toast]:font-medium group-[.toast]:underline group-[.toast]:underline-offset-4 group-[.toast]:hover:opacity-80",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
    />
  );
}
