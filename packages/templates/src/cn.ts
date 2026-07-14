import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

// Package-local copy: templates must not import from the host app.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
