import { Loader2, type LucideProps } from "lucide-react";
import { cn } from "@/lib/utils";

const SPINNER_SIZES = {
  xs: "size-3",
  sm: "size-3.5",
  md: "size-4",
  lg: "size-5",
  xl: "size-6",
} as const;

export type SpinnerSize = keyof typeof SPINNER_SIZES;

export type SpinnerProps = Omit<LucideProps, "size" | "ref"> & {
  size?: SpinnerSize;
};

export function Spinner({ size = "md", className, ...props }: Readonly<SpinnerProps>) {
  return (
    <Loader2
      {...props}
      className={cn("shrink-0 animate-spin motion-reduce:animate-none", SPINNER_SIZES[size], className)}
    />
  );
}
