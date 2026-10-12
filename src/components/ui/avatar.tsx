import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type AvatarSize = "xs" | "sm" | "md";

export interface AvatarPerson {
  id: string;
  name: string;
  imageUrl?: string | null;
}

const BOX: Record<AvatarSize, string> = { xs: "size-4", sm: "size-5", md: "size-8" };
const TEXT: Record<AvatarSize, string> = {
  xs: "text-[0.5625rem]",
  sm: "text-[0.625rem]",
  md: "text-xs",
};
const ICON: Record<AvatarSize, string> = {
  xs: "[&_svg]:size-2.5",
  sm: "[&_svg]:size-3",
  md: "[&_svg]:size-4",
};
const LETTERS: Record<AvatarSize, number> = { xs: 1, sm: 2, md: 2 };
const OVERLAP: Record<AvatarSize, string> = { xs: "-ml-1", sm: "-ml-1.5", md: "-ml-2.5" };
const SEPARATOR: Record<AvatarSize, string> = {
  xs: "border border-background",
  sm: "border-2 border-background",
  md: "border-2 border-background",
};

export function avatarHue(seed: string): number {
  let hash = 0;
  for (const char of seed) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 360;
  }
  return hash;
}

function initials(name: string, letters: number): string {
  const words = name.trim().split(/\s+/u).filter(Boolean);
  const picked = words.length > 1 ? [words[0], words[words.length - 1]] : words;
  return picked
    .slice(0, letters)
    .map((word) => String.fromCodePoint(word.codePointAt(0) ?? 0))
    .join("")
    .toUpperCase();
}

export function Avatar({
  person,
  size = "sm",
  fallbackIcon,
  className,
}: Readonly<{
  person: AvatarPerson;
  size?: AvatarSize;
  fallbackIcon?: ReactNode;
  className?: string;
}>) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const imageUrl = person.imageUrl ?? null;
  if (imageUrl && imageUrl !== failedUrl) {
    return (
      <img
        data-slot="avatar"
        src={imageUrl}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setFailedUrl(imageUrl)}
        className={cn(BOX[size], "shrink-0 rounded-full object-cover", className)}
      />
    );
  }
  if (fallbackIcon) {
    return (
      <span
        data-slot="avatar"
        aria-hidden
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full bg-foreground text-background",
          BOX[size],
          ICON[size],
          className,
        )}
      >
        {fallbackIcon}
      </span>
    );
  }
  return (
    <span
      data-slot="avatar"
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-bold text-white",
        BOX[size],
        TEXT[size],
        className,
      )}
      style={{ backgroundColor: `hsl(${avatarHue(person.id)} 55% 45%)` }}
    >
      {initials(person.name, LETTERS[size])}
    </span>
  );
}

export function AvatarStack({
  people,
  max = 4,
  size = "sm",
  className,
  renderTip,
  renderMoreTip,
}: Readonly<{
  people: AvatarPerson[];
  max?: number;
  size?: AvatarSize;
  className?: string;
  renderTip?: (person: AvatarPerson) => ReactNode;
  renderMoreTip?: (hidden: AvatarPerson[]) => ReactNode;
}>) {
  const { t } = useTranslation(["common"]);
  const shown = people.slice(0, Math.max(0, max));
  const hidden = people.slice(shown.length);
  const more =
    hidden.length > 0 ? (
      <span
        data-slot="avatar-more"
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full bg-muted font-medium text-muted-foreground",
          BOX[size],
          TEXT[size],
          SEPARATOR[size],
          shown.length > 0 && !renderMoreTip && OVERLAP[size],
        )}
      >
        <span aria-hidden>{`+${hidden.length}`}</span>
        <span className="sr-only">{t(($) => $.common.avatar.more, { count: hidden.length })}</span>
        {renderMoreTip ? <span className="sr-only">{renderMoreTip(hidden)}</span> : null}
      </span>
    ) : null;
  return (
    <div data-slot="avatar-stack" className={cn("flex items-center", className)}>
      {shown.map((person, index) => {
        const overlap = cn("shrink-0 rounded-full", index > 0 && OVERLAP[size]);
        const content = (
          <>
            <Avatar person={person} size={size} className={SEPARATOR[size]} />
            <span className="sr-only">{renderTip ? renderTip(person) : person.name}</span>
          </>
        );
        return renderTip ? (
          <Tooltip key={person.id} label={renderTip(person)} className={overlap}>
            {content}
          </Tooltip>
        ) : (
          <span key={person.id} title={person.name} className={cn("flex", overlap)}>
            {content}
          </span>
        );
      })}
      {more && renderMoreTip ? (
        <Tooltip label={renderMoreTip(hidden)} className={cn("shrink-0 rounded-full", shown.length > 0 && OVERLAP[size])}>
          {more}
        </Tooltip>
      ) : (
        more
      )}
    </div>
  );
}
