import type { ReactNode } from "react";

const LABEL = "text-xs font-medium";

export function Field({ id, label, children }: Readonly<{ id?: string; label: string; children: ReactNode }>) {
  return (
    <div className="space-y-1.5">
      {id ? (
        <label htmlFor={id} className={LABEL}>
          {label}
        </label>
      ) : (
        <div className={LABEL}>{label}</div>
      )}
      {children}
    </div>
  );
}
