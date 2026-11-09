import type { ReactNode } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Info } from "lucide-react";
import { useNotesAppearanceRef } from "@/hooks/use-notes-appearance";
import "@/components/notes/notes.css";

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
    ["keyword", "return"],
    ["", " "],
    ["variableName", "round"],
    ["punctuation", "("],
    ["variableName", "sum"],
    ["punctuation", "("],
    ["propertyName", "p.height"],
    ["", " "],
    ["keyword", "for"],
    ["", " p "],
    ["keyword", "in"],
    ["", " plots"],
    ["punctuation", ") "],
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

function CodeSample() {
  return (
    <div className="note-code note-code-lang">
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

export function NotesAppearancePreview({ actions }: Readonly<{ actions?: ReactNode }>) {
  const { t } = useTranslation(["settings"]);
  const appearanceRef = useNotesAppearanceRef<HTMLDivElement>();
  return (
    <figure
      aria-label={t(($) => $.settings.notesPreview.label)}
      data-testid="settings-notes-preview"
      className="sticky -top-5 isolate z-10 -mx-1 bg-background px-1 pb-2 pt-2 dark:bg-popover"
    >
      <span aria-hidden className="absolute inset-0 -z-10 bg-muted/30" />
      {actions ? <div className="mb-2 flex min-h-6 items-center justify-end gap-2">{actions}</div> : null}
      <div
        ref={appearanceRef}
        data-testid="settings-notes-preview-root"
        className="max-h-72 overflow-y-auto rounded-lg border bg-background px-6 py-5"
      >
        <div aria-hidden inert className="pointer-events-none select-none">
          <p className="note-title text-2xl font-bold">{t(($) => $.settings.notesPreview.title)}</p>
          <div className="wysiwyg-content note-body mt-4">
            <div className="ProseMirror">
              <h2>{t(($) => $.settings.notesPreview.heading)}</h2>
              <p>{t(($) => $.settings.notesPreview.paragraph)}</p>
              <p>
                <Trans
                  ns="settings"
                  i18nKey={($) => $.settings.notesPreview.links}
                  components={{
                    note: <span className="text-primary underline" />,
                    tag: <span className="note-tag" />,
                  }}
                />
              </p>
              <p>
                <mark className="note-highlight">{t(($) => $.settings.notesPreview.highlight)}</mark>{" "}
                <code>{INLINE_CODE}</code>
              </p>
              <div className="note-callout">
                <div className="note-callout-chrome">
                  <span className="note-callout-icon">
                    <Info aria-hidden className="size-4" />
                  </span>
                </div>
                <div className="note-callout-content">
                  <p className="note-callout-title">{t(($) => $.settings.notesPreview.calloutTitle)}</p>
                  <p>{t(($) => $.settings.notesPreview.calloutBody)}</p>
                </div>
              </div>
              <CodeSample />
              <ul className="note-tasks">
                <li className="note-task" data-checked="true">
                  <span className="note-task-handle">
                    <input type="checkbox" className="note-task-box" checked readOnly tabIndex={-1} />
                  </span>
                  <div className="note-task-content">
                    <p>{t(($) => $.settings.notesPreview.taskDone)}</p>
                  </div>
                </li>
                <li className="note-task" data-checked="false">
                  <span className="note-task-handle">
                    <input type="checkbox" className="note-task-box" checked={false} readOnly tabIndex={-1} />
                  </span>
                  <div className="note-task-content">
                    <p>{t(($) => $.settings.notesPreview.task)}</p>
                  </div>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </figure>
  );
}
