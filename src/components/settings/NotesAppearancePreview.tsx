import type { ReactNode } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Info } from "lucide-react";
import { useNotesAppearanceRef } from "@/hooks/use-notes-appearance";
import { FieldChip } from "@/components/notes/FieldChip";
import { DATE_KEY, DUE_KEY, fieldDisplay } from "@/components/notes/note-fields";
import { tagTone } from "@/components/notes/note-tags";
import { localDate } from "@/components/notes/note-templates";
import { addDays } from "@/lib/notes-periodic";
import { cn } from "@/lib/utils";
import "@/components/notes/notes.css";

const PREVIEW_TAG = tagTone("fieldwork");

const CODE_LINES: readonly (readonly (readonly [token: string, text: string])[])[] = [
  [["comment", "# Mean seedling height in cm"]],
  [
    ["keyword", "def"],
    ["", " "],
    ["variableName", "mean_height"],
    ["punctuation", "("],
    ["variableName", "plots"],
    ["punctuation", ", "],
    ["variableName", "unit"],
    ["operator", "="],
    ["string", '"cm"'],
    ["punctuation", "):"],
  ],
  [
    ["", "    "],
    ["variableName", "total"],
    ["", " "],
    ["operator", "="],
    ["", " "],
    ["variableName", "sum"],
    ["punctuation", "("],
    ["propertyName", "p.height"],
    ["", " "],
    ["keyword", "for"],
    ["", " p "],
    ["keyword", "in"],
    ["", " plots"],
    ["punctuation", ")"],
  ],
  [
    ["", "    "],
    ["keyword", "return"],
    ["", " "],
    ["variableName", "round"],
    ["punctuation", "("],
    ["variableName", "total"],
    ["", " "],
    ["operator", "/"],
    ["", " "],
    ["variableName", "len"],
    ["punctuation", "("],
    ["", "plots"],
    ["punctuation", "), "],
    ["number", "2"],
    ["punctuation", ")"],
  ],
];

const CODE = CODE_LINES.map((line, row) => ({
  id: `line-${row}`,
  pieces: line.map(([token, text], column) => ({ id: `${row}-${column}`, token, text })),
}));

const INLINE_CODE = "soil_ph";

export function SampleField({ fieldKey, days }: Readonly<{ fieldKey: typeof DATE_KEY | typeof DUE_KEY; days: number }>) {
  const { i18n } = useTranslation();
  const now = new Date();
  return <FieldChip display={fieldDisplay({ key: fieldKey, value: localDate(addDays(now, days)) }, now, i18n.language)} />;
}

function SampleTask({ checked = false, children }: Readonly<{ checked?: boolean; children: ReactNode }>) {
  return (
    <li className="note-task" data-checked={checked ? "true" : "false"}>
      <span className="note-task-handle">
        <input type="checkbox" className="note-task-box" checked={checked} readOnly tabIndex={-1} />
      </span>
      <div className="note-task-content">
        <p>{children}</p>
      </div>
    </li>
  );
}

function CodeSample() {
  return (
    <div className="note-code note-code-lang code-tokens">
      <pre>
        <code>
          {CODE.map((line) => (
            <span key={line.id} className="block">
              {line.pieces.map((piece) => (
                <span key={piece.id} className={piece.token ? `tok-${piece.token}` : undefined}>
                  {piece.text}
                </span>
              ))}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}

export function NotesAppearancePreview({ beside = false, className }: Readonly<{ beside?: boolean; className?: string }>) {
  const { t } = useTranslation(["notes"]);
  const appearanceRef = useNotesAppearanceRef<HTMLDivElement>();
  return (
    <figure
      aria-label={t(($) => $.notes.notesPreview.label)}
      data-testid="settings-notes-preview"
      className={cn(
        beside ? "sticky top-0 self-start" : "sticky -top-5 isolate z-10 -mx-1 bg-background px-1 pb-2 pt-2 dark:bg-popover",
        className,
      )}
    >
      {beside ? null : <span aria-hidden className="absolute inset-0 -z-10 bg-muted/30" />}
      <div
        ref={appearanceRef}
        data-testid="settings-notes-preview-root"
        className={cn(
          "overflow-y-auto rounded-lg border bg-background",
          beside ? "max-h-[calc(var(--settings-height)-5.5625rem)] px-5 py-4" : "max-h-72 px-6 py-5",
        )}
      >
        <div aria-hidden inert className={cn("pointer-events-none select-none", beside && "[zoom:0.8]")}>
          <p className="note-title text-2xl font-bold">{t(($) => $.notes.notesPreview.title)}</p>
          <div className="wysiwyg-content note-body mt-4">
            <div className="ProseMirror">
              <h2>{t(($) => $.notes.notesPreview.heading)}</h2>
              <p>{t(($) => $.notes.notesPreview.paragraph)}</p>
              <p>
                <Trans
                  ns="notes"
                  i18nKey={($) => $.notes.notesPreview.links}
                  components={{
                    note: <span className="text-primary underline" />,
                    tag: <span className={`note-tag ${PREVIEW_TAG.tint} ${PREVIEW_TAG.text}`} />,
                  }}
                />
              </p>
              <p>
                <mark className="note-highlight">{t(($) => $.notes.notesPreview.highlight)}</mark>{" "}
                <code>{INLINE_CODE}</code>
              </p>
              <div className="note-callout">
                <div className="note-callout-chrome">
                  <span className="note-callout-icon">
                    <Info aria-hidden className="size-4" />
                  </span>
                </div>
                <div className="note-callout-content">
                  <p className="note-callout-title">
                    {t(($) => $.notes.notesPreview.calloutTitle)} <SampleField fieldKey={DATE_KEY} days={5} />
                  </p>
                  <p>{t(($) => $.notes.notesPreview.calloutBody)}</p>
                </div>
              </div>
              <CodeSample />
              <ul className="note-tasks">
                <SampleTask checked>{t(($) => $.notes.notesPreview.taskDone)}</SampleTask>
                <SampleTask>
                  {t(($) => $.notes.notesPreview.task)} <SampleField fieldKey={DUE_KEY} days={0} />
                </SampleTask>
                <SampleTask>
                  {t(($) => $.notes.notesPreview.taskLate)} <SampleField fieldKey={DUE_KEY} days={-1} />
                </SampleTask>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </figure>
  );
}
