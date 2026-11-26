import { useState } from "react";
import { useTranslation } from "react-i18next";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/inline-alert";

export interface ShownProblem {
  key: string;
  file: string | null;
  line: number;
  message: string;
}

function ProblemText({ problem }: Readonly<{ problem: ShownProblem }>) {
  const { t } = useTranslation(["settings"]);
  return problem.file
    ? t(($) => $.settings.snippets.problems.where, { file: problem.file, line: problem.line, message: problem.message })
    : problem.message;
}

export function SnippetProblems({ problems }: Readonly<{ problems: readonly ShownProblem[] }>) {
  const { t } = useTranslation(["settings"]);
  const [open, setOpen] = useState(false);
  if (problems.length === 0) return null;
  const [first] = problems;
  return (
    <div className="space-y-1.5" data-testid="snippet-problems">
      <InlineAlert tone="warning" icon={TriangleAlert} className="flex-wrap">
        <b>{t(($) => $.settings.snippets.problems.summary, { count: problems.length })}</b>{" "}
        <ProblemText problem={first} />{" "}
        {problems.length > 1 ? (
          <Button type="button" variant="link" size="xs" className="h-auto p-0 text-current" onClick={() => setOpen(!open)}>
            {open ? t(($) => $.settings.snippets.problems.hide) : t(($) => $.settings.snippets.problems.show)}
          </Button>
        ) : null}
      </InlineAlert>
      {open ? (
        <ul className="space-y-1 px-3 text-xs text-muted-foreground">
          {problems.slice(1).map((problem) => (
            <li key={problem.key}>
              <ProblemText problem={problem} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
