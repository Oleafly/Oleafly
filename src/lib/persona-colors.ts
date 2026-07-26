export const PERSONA_COLORS = [
  { key: "sunset", label: "Sunset", css: "linear-gradient(135deg,#f59e0b,#ef4444)" },
  { key: "ocean", label: "Ocean", css: "linear-gradient(135deg,#0ea5e9,#2563eb)" },
  { key: "forest", label: "Forest", css: "linear-gradient(135deg,#22c55e,#15803d)" },
  { key: "grape", label: "Grape", css: "linear-gradient(135deg,#a855f7,#6d28d9)" },
  { key: "slate", label: "Slate", css: "linear-gradient(135deg,#64748b,#334155)" },
] as const;

export function personaGradient(key: string): string {
  return (PERSONA_COLORS.find((c) => c.key === key) ?? PERSONA_COLORS[0]).css;
}
