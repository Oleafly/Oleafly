export const PERSONA_COLORS = [
  { key: "sunset", css: "linear-gradient(135deg,#f59e0b,#ef4444)" },
  { key: "ocean", css: "linear-gradient(135deg,#0ea5e9,#2563eb)" },
  { key: "forest", css: "linear-gradient(135deg,#22c55e,#15803d)" },
  { key: "grape", css: "linear-gradient(135deg,#a855f7,#6d28d9)" },
  { key: "slate", css: "linear-gradient(135deg,#64748b,#334155)" },
] as const;

export type PersonaColorKey = (typeof PERSONA_COLORS)[number]["key"];

export function personaGradient(key: string): string {
  return (PERSONA_COLORS.find((c) => c.key === key) ?? PERSONA_COLORS[0]).css;
}
