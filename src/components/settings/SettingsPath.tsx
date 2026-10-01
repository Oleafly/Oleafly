import { Fragment, type ReactNode } from "react";
import { pathParts, useDisplayPath } from "@/lib/display-path";
import "./settings-path.css";

/**
 * File and folder paths in Settings stay blurred, and hover or keyboard focus
 * shows them (the rules are in settings-path.css). The blur is visual only:
 * the text stays in the page for screen readers, and copy buttons keep the
 * real path. Nothing else in Settings, and nothing outside it, is blurred.
 */

/** Pass `focusable={false}` inside a button or link, which shows the path on focus. */
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
    <span data-settings-path="" tabIndex={focusable ? 0 : undefined} className={className}>
      {children}
    </span>
  );
}

/** One path from the backend, shown with the home folder as `~`. */
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

/** A message that may name paths: only the paths in it are blurred. */
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
