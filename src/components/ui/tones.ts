import { avatarHue } from "@/components/ui/avatar";

export interface Tone {
  icon: string;
  text: string;
  tint: string;
  hover: string;
  dot: string;
}

export const TONES = {
  rose: {
    icon: "text-rose-600 dark:text-rose-400",
    text: "text-rose-700 dark:text-rose-300",
    tint: "bg-rose-500/10",
    hover: "hover:bg-rose-500/20 focus-visible:bg-rose-500/20",
    dot: "bg-rose-500",
  },
  orange: {
    icon: "text-orange-600 dark:text-orange-400",
    text: "text-orange-700 dark:text-orange-300",
    tint: "bg-orange-500/10",
    hover: "hover:bg-orange-500/20 focus-visible:bg-orange-500/20",
    dot: "bg-orange-500",
  },
  amber: {
    icon: "text-amber-600 dark:text-amber-400",
    text: "text-amber-700 dark:text-amber-300",
    tint: "bg-amber-500/10",
    hover: "hover:bg-amber-500/20 focus-visible:bg-amber-500/20",
    dot: "bg-amber-500",
  },
  lime: {
    icon: "text-lime-600 dark:text-lime-400",
    text: "text-lime-700 dark:text-lime-300",
    tint: "bg-lime-500/10",
    hover: "hover:bg-lime-500/20 focus-visible:bg-lime-500/20",
    dot: "bg-lime-500",
  },
  emerald: {
    icon: "text-emerald-600 dark:text-emerald-400",
    text: "text-emerald-700 dark:text-emerald-300",
    tint: "bg-emerald-500/10",
    hover: "hover:bg-emerald-500/20 focus-visible:bg-emerald-500/20",
    dot: "bg-emerald-500",
  },
  teal: {
    icon: "text-teal-600 dark:text-teal-400",
    text: "text-teal-700 dark:text-teal-300",
    tint: "bg-teal-500/10",
    hover: "hover:bg-teal-500/20 focus-visible:bg-teal-500/20",
    dot: "bg-teal-500",
  },
  cyan: {
    icon: "text-cyan-600 dark:text-cyan-400",
    text: "text-cyan-700 dark:text-cyan-300",
    tint: "bg-cyan-500/10",
    hover: "hover:bg-cyan-500/20 focus-visible:bg-cyan-500/20",
    dot: "bg-cyan-500",
  },
  sky: {
    icon: "text-sky-600 dark:text-sky-400",
    text: "text-sky-700 dark:text-sky-300",
    tint: "bg-sky-500/10",
    hover: "hover:bg-sky-500/20 focus-visible:bg-sky-500/20",
    dot: "bg-sky-500",
  },
  blue: {
    icon: "text-blue-600 dark:text-blue-400",
    text: "text-blue-700 dark:text-blue-300",
    tint: "bg-blue-500/10",
    hover: "hover:bg-blue-500/20 focus-visible:bg-blue-500/20",
    dot: "bg-blue-500",
  },
  indigo: {
    icon: "text-indigo-600 dark:text-indigo-400",
    text: "text-indigo-700 dark:text-indigo-300",
    tint: "bg-indigo-500/10",
    hover: "hover:bg-indigo-500/20 focus-visible:bg-indigo-500/20",
    dot: "bg-indigo-500",
  },
  violet: {
    icon: "text-violet-600 dark:text-violet-400",
    text: "text-violet-700 dark:text-violet-300",
    tint: "bg-violet-500/10",
    hover: "hover:bg-violet-500/20 focus-visible:bg-violet-500/20",
    dot: "bg-violet-500",
  },
  pink: {
    icon: "text-pink-600 dark:text-pink-400",
    text: "text-pink-700 dark:text-pink-300",
    tint: "bg-pink-500/10",
    hover: "hover:bg-pink-500/20 focus-visible:bg-pink-500/20",
    dot: "bg-pink-500",
  },
  slate: {
    icon: "text-slate-600 dark:text-slate-400",
    text: "text-slate-700 dark:text-slate-300",
    tint: "bg-slate-500/10",
    hover: "hover:bg-slate-500/20 focus-visible:bg-slate-500/20",
    dot: "bg-slate-500",
  },
} as const satisfies Record<string, Tone>;

export const NAME_TONES: readonly Tone[] = [
  TONES.rose,
  TONES.orange,
  TONES.amber,
  TONES.lime,
  TONES.emerald,
  TONES.teal,
  TONES.cyan,
  TONES.sky,
  TONES.blue,
  TONES.indigo,
  TONES.violet,
  TONES.pink,
];

export function nameTone(name: string): Tone {
  return NAME_TONES[Math.floor((avatarHue(name) * NAME_TONES.length) / 360)];
}
