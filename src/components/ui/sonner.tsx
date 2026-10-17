import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { Toaster as SonnerToaster, toast as sonnerToast } from "sonner";
import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import { TOAST_DURATION_MS, TOAST_LIMIT, useToastStore, type Toast } from "@/store/toast";
import { displayText } from "@/lib/display-path";

const TOASTER_STYLE = { "--width": "400px", fontFamily: "var(--font-sans)" } as CSSProperties;

function sonnerFor(kind: Toast["kind"]) {
  if (kind === "error") return sonnerToast.error;
  if (kind === "success") return sonnerToast.success;
  return sonnerToast.info;
}

function RepeatedTitle({ message, count }: Readonly<{ message: string; count: number }>) {
  const { t } = useTranslation(["common"]);
  return (
    <span>
      {message}
      <span className="ml-1.5 text-xs font-normal tabular-nums text-muted-foreground">
        {t(($) => $.common.toast.repeatCount, { count })}
      </span>
    </span>
  );
}

// Toasts often carry a saved file or an error that names a folder, so home
// paths in the message are shortened like every other displayed path.
function titleFor(toast: Toast) {
  const message = displayText(toast.message);
  return toast.count > 1 ? <RepeatedTitle message={message} count={toast.count} /> : message;
}

function actionFor(toast: Toast) {
  const action = toast.action;
  if (!action) return undefined;
  return {
    label: action.label,
    onClick: () => {
      useToastStore.getState().dismiss(toast.id);
      action.onClick();
    },
  };
}

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
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
      const show = sonnerFor(t.kind);
      show(titleFor(t), {
        id,
        duration: t.sticky ? Number.POSITIVE_INFINITY : TOAST_DURATION_MS,
        action: actionFor(t),
        onDismiss: () => useToastStore.getState().close(id),
        onAutoClose: () => useToastStore.getState().close(id),
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
      visibleToasts={TOAST_LIMIT}
      className="toaster group"
      style={TOASTER_STYLE}
      closeButton
      icons={{
        success: <CheckCircle2 className="size-4 text-emerald-500" />,
        error: <AlertCircle className="size-4 text-destructive" />,
        info: <Info className="size-4 text-sky-500" />,
      }}
      toastOptions={{
        classNames: {
          // Sonner draws focus as a ring of box-shadow. Show it as a border
          // colour change on the toast and a dimmed action instead.
          toast:
            "group toast group-[.toaster]:bg-popover group-[.toaster]:text-popover-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg group-[.toaster]:focus-visible:!border-ring group-[.toaster]:focus-visible:!shadow-lg",
          title: "select-text",
          description: "select-text group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:!bg-transparent group-[.toast]:!text-primary group-[.toast]:!p-0 group-[.toast]:font-medium group-[.toast]:underline group-[.toast]:underline-offset-4 group-[.toast]:hover:opacity-80 group-[.toast]:focus-visible:!shadow-none group-[.toast]:focus-visible:opacity-80",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          // Sonner pins the close button over the top start corner. Make it the
          // last flex item instead, so it sits inside the toast at the inline
          // end (left in RTL), centred by the toast's align-items, and the
          // message wraps before it rather than running under it.
          closeButton:
            "group-[.toast]:!static group-[.toast]:!order-last group-[.toast]:!shrink-0 group-[.toast]:!-me-1 group-[.toast]:!transform-none group-[.toast]:!rounded-md group-[.toast]:!border-transparent group-[.toast]:!bg-transparent group-[.toast]:!text-muted-foreground group-[.toast]:hover:!bg-accent group-[.toast]:hover:!text-foreground group-[.toast]:focus-visible:!bg-accent group-[.toast]:focus-visible:!text-foreground group-[.toast]:focus-visible:!shadow-none",
        },
      }}
    />
  );
}
