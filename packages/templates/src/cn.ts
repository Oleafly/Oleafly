import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Class-name joiner with Tailwind conflict resolution (package-local copy). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
