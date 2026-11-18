import { useEffect, useMemo, useState } from "react";
import { AvatarStack } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { ACTIVITY_IDLE_MS } from "./comment-composer";
import { useCommentKit } from "./comment-kit";

export interface CommentPresence {
  id: string;
  name: string;
  imageUrl?: string | null;
}

export interface PresenceLabels {
  one: (name: string) => string;
  two: (first: string, second: string) => string;
  many: (count: number) => string;
}

export const PRESENCE_TTL_MS = ACTIVITY_IDLE_MS + 1_000;

function firstName(name: string): string {
  const words = name.trim().split(/\s+/u);
  return words.find((word) => !word.endsWith(".")) ?? words[0] ?? name;
}

export function presenceText(labels: PresenceLabels, names: readonly string[]): string {
  if (names.length === 1) return labels.one(names[0]);
  if (names.length !== 2) return labels.many(names.length);
  const [first, second] = names.map(firstName);
  return first === second ? labels.two(names[0].trim(), names[1].trim()) : labels.two(first, second);
}

export function useFresh<T>(items: readonly T[], at: (item: T) => number, ttl = PRESENCE_TTL_MS): T[] {
  const [now, setNow] = useState(() => Date.now());
  const fresh = useMemo(() => items.filter((item) => now - at(item) < ttl), [items, at, now, ttl]);
  useEffect(() => {
    const current = Date.now();
    if (fresh.some((item) => current - at(item) >= ttl)) {
      setNow(current);
      return;
    }
    if (fresh.length === 0) return;
    const next = Math.min(...fresh.map(at)) + ttl - current;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, next) + 50);
    return () => clearTimeout(timer);
  }, [fresh, at, ttl]);
  return fresh;
}

export function TypingLine({
  people,
  label,
  className,
}: Readonly<{ people: readonly CommentPresence[]; label: string; className?: string }>) {
  const kit = useCommentKit();
  if (people.length === 0) return null;
  return (
    <div role="status" className={cn("flex min-w-0 items-center gap-1.5 text-[0.6875rem] text-muted-foreground", className)}>
      <AvatarStack
        people={people.map((person) => ({ id: person.id, name: person.name, imageUrl: person.imageUrl, hue: kit.hue(person.id) }))}
        max={3}
        size="xs"
        className="shrink-0"
      />
      <span aria-hidden className="flex shrink-0 items-center gap-0.5">
        <span className="size-1 rounded-full bg-muted-foreground animate-pulse motion-reduce:animate-none" />
        <span className="size-1 rounded-full bg-muted-foreground animate-pulse [animation-delay:200ms] motion-reduce:animate-none" />
        <span className="size-1 rounded-full bg-muted-foreground animate-pulse [animation-delay:400ms] motion-reduce:animate-none" />
      </span>
      <span className="truncate">{label}</span>
    </div>
  );
}
