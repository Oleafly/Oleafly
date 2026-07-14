import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

// Package-local copy so this package doesn't import the app's utils directly.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
