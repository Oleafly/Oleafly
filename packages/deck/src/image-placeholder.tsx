import type { CSSProperties, HTMLAttributes } from "react";

export type ImagePlaceholderProps = {
  hint: string;
  width?: number;
  height?: number;
  style?: CSSProperties;
  className?: string;
} & Omit<HTMLAttributes<HTMLDivElement>, "children" | "style" | "className">;

export function ImagePlaceholder({ hint, width, height, style, className, ...rest }: ImagePlaceholderProps) {
  return (
    <div
      {...rest}
      data-slide-placeholder={hint}
      role="img"
      aria-label={hint}
      className={className}
      style={{
        position: "relative",
        width: width ?? "100%",
        height: height ?? "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        border: "1px dashed rgba(120, 120, 130, 0.35)",
        borderRadius: 12,
        background: "rgba(120, 120, 130, 0.05)",
        color: "rgba(90, 90, 100, 0.7)",
        fontFamily: "system-ui, sans-serif",
        fontSize: 28,
        textAlign: "center",
        padding: 24,
        boxSizing: "border-box",
        overflow: "hidden",
        ...style,
      }}
    >
      {hint}
    </div>
  );
}
