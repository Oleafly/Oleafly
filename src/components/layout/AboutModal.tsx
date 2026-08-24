import { useEffect, useState } from "react";
import {
  AtSign,
  BookOpen,
  Bug,
  ExternalLink,
  Github,
  MessageCircle,
  Star,
  X,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";
import { Button } from "@/components/ui/button";
import { LeafLogo } from "@/components/layout/LeafLogo";
import { UpdateChecker } from "@/components/layout/UpdateChecker";
import { appVersion } from "@/lib/tauri";
import { useModalAccessibility } from "@/components/ui/use-modal-accessibility";

const REPO = "https://github.com/Oleafly/Oleafly";
const DISCUSSIONS = `${REPO}/discussions`;
const ISSUES = `${REPO}/issues`;
const DOCS = "https://oleafly.com/docs/";
const X_URL = "https://x.com/OleaflyHQ";

const COMMUNITY_LINKS = [
  {
    label: "Discussions",
    description: "Ask questions and share ideas",
    url: DISCUSSIONS,
    icon: MessageCircle,
  },
  {
    label: "Issues",
    description: "Report a bug or request a feature",
    url: ISSUES,
    icon: Bug,
  },
  {
    label: "@OleaflyHQ",
    description: "Follow releases and development",
    url: X_URL,
    icon: AtSign,
  },
  {
    label: "Documentation",
    description: "Learn every part of Oleafly",
    url: DOCS,
    icon: BookOpen,
  },
] as const;

export function AboutModal({ open: isOpen, onClose }: { open: boolean; onClose: () => void }) {
  const [version, setVersion] = useState("");
  const { dialogRef, onBackdropMouseDown } = useModalAccessibility<HTMLDivElement>(isOpen, onClose);

  useEffect(() => {
    if (isOpen) void appVersion().then(setVersion).catch(() => setVersion(""));
  }, [isOpen]);

  if (!isOpen) return null;

  const ext = (url: string) => () => void open(url);

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/55 p-4 backdrop-blur-md">
      <button
        type="button"
        aria-label="Close About Oleafly"
        className="absolute inset-0"
        onMouseDown={onBackdropMouseDown}
      />
      <div
        role="dialog"
        ref={dialogRef}
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="about-title"
        className="relative max-h-[calc(100vh-2rem)] w-full max-w-lg overflow-y-auto rounded-2xl border bg-popover text-popover-foreground shadow-2xl"
      >
        <button
          type="button"
          data-modal-initial-focus
          onClick={onClose}
          className="absolute right-4 top-4 z-10 flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label="Close About dialog"
        >
          <X className="size-4" />
        </button>

        <section className="relative overflow-hidden px-6 pb-5 pt-6">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-36 bg-[radial-gradient(circle_at_top_left,color-mix(in_srgb,var(--primary)_15%,transparent),transparent_68%)]"
          />
          <div className="relative flex items-start gap-4 pr-8">
            <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl border bg-primary/10 shadow-sm">
              <LeafLogo className="size-9" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <h2 id="about-title" className="text-xl font-semibold">Oleafly</h2>
                {version && (
                  <span className="text-xs text-muted-foreground">Version {version}</span>
                )}
              </div>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                The open-source workspace for the whole paper. Write, compile, proofread,
                manage citations, review PDFs, track changes in Git, and work with the AI
                models you choose.
              </p>
            </div>
          </div>
          <div className="relative mt-4 flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={ext(REPO)}>
              <Star className="size-4" /> Star on GitHub
            </Button>
            <Button variant="secondary" size="sm" onClick={ext(REPO)}>
              <Github className="size-4" /> View source
            </Button>
            <UpdateChecker className="ml-auto" />
          </div>
        </section>

        <section className="border-t px-4 py-4">
          <p className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Connect with Oleafly
          </p>
          <div className="grid gap-1 sm:grid-cols-2">
            {COMMUNITY_LINKS.map(({ label, description, url, icon: Icon }) => (
              <button
                key={label}
                type="button"
                onClick={ext(url)}
                className="group flex min-w-0 items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-accent"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background/50 text-muted-foreground group-hover:text-foreground">
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{label}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {description}
                  </span>
                </span>
                <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
