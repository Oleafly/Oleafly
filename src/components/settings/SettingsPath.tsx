import { Fragment, type ReactNode } from "react";
import { pathParts, useDisplayPath } from "@/lib/display-path";
import "./settings-path.css";

function BlurredPath({
  children,
  focusable = true,
  className,
}: Readonly<{
  children: ReactNode;
  focusable?: boolean;
  className?: string;
}>) {
  return (
    <span
      data-settings-path=""
      tabIndex={focusable ? 0 : undefined} // NOSONAR - a focus stop so a keyboard user can show the blurred path
      className={className}
    >
      {children}
    </span>
  );
}

export function SettingsPath({
  path,
  focusable,
  className,
}: Readonly<{
  path: string;
  focusable?: boolean;
  className?: string;
}>) {
  const displayPath = useDisplayPath();
  return (
    <BlurredPath focusable={focusable} className={className}>
      {displayPath(path)}
    </BlurredPath>
  );
}

export function SettingsPathText({
  text,
  focusable,
}: Readonly<{
  text: string;
  focusable?: boolean;
}>) {
  const parts = pathParts(text);
  if (!parts.some((part) => part.path)) return <>{text}</>;
  let offset = 0;
  return (
    <>
      {parts.map((part) => {
        const key = offset;
        offset += part.text.length;
        return part.path ? (
          <BlurredPath key={key} focusable={focusable}>
            {part.text}
          </BlurredPath>
        ) : (
          <Fragment key={key}>{part.text}</Fragment>
        );
      })}
    </>
  );
}
