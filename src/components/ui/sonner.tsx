import { useEffect, useRef } from "react";
import { Toaster as SonnerToaster, toast as sonnerToast } from "sonner";
import { useToastStore, type Toast } from "@/store/toast";

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const seenRef = useRef(new Map<number, Toast>());

  useEffect(() => {
    const current = new Map(toasts.map((t) => [t.id, t]));
    for (const [id, t] of current) {
      const prev = seenRef.current.get(id);
      if (prev && prev.message === t.message && prev.kind === t.kind) continue;
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
      className="toaster group"
      closeButton
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-popover group-[.toaster]:text-popover-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
    />
  );
}
