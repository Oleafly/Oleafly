import { cn } from "@/lib/utils";

export function LeafLogo({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 256 256"
      className={cn("block", className)}
      aria-hidden="true"
    >
      <path
        d="M196 20 C194 70 188 112 150 146 C123 170 84 172 62 198 C54 176 56 144 72 112 C90 76 124 48 196 20 Z"
        fill="#7CCB43"
      />
      <path
        d="M60 194 C50 212 46 232 46 250 L58 250 C58 228 62 210 70 188 Z"
        fill="#34B44A"
      />
      <path
        d="M74 178 C96 146 118 120 142 104"
        fill="none"
        stroke="#3DBB4E"
        strokeWidth="8"
        strokeLinecap="round"
      />
    </svg>
  );
}
