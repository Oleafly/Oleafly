import { ChevronDown, Quote, X } from "lucide-react";
import { useMemo, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { ChatComposer, type ChatComposerHandle, type SlashItem } from "@/components/ai/composer/ChatComposer";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { isResearchAction, RESEARCH_ACTIONS } from "./research-actions";
import type { ResearchActionId } from "./types";

export interface PromptRequest {
  agent: string;
  actionId: ResearchActionId | null;
  prompt: string;
}

interface AgentPromptProps {
  composerRef: RefObject<ChatComposerHandle | null>;
  agents: readonly string[];
  working: boolean;
  quote: string | null;
  message: string | null;
  onClearQuote: () => void;
  onSend: (request: PromptRequest) => void;
  onStop: () => void;
}

const NO_ATTACHMENTS: [] = [];

export function AgentPrompt({
  composerRef,
  agents,
  working,
  quote,
  message,
  onClearQuote,
  onSend,
  onStop,
}: Readonly<AgentPromptProps>) {
  const { t } = useTranslation(["notes"]);
  const [text, setText] = useState("");
  const [agent, setAgent] = useState(agents[0] ?? "");
  const slashItems = useMemo<SlashItem[]>(
    () =>
      RESEARCH_ACTIONS.map(({ id, icon }) => ({
        id,
        label: t(($) => $.notes.prompt.actions[id]),
        icon,
        group: t(($) => $.notes.prompt.actionsGroup),
      })),
    [t],
  );

  const send = (actionId: ResearchActionId | null) => {
    if (working || !agent) return;
    onSend({ agent, actionId, prompt: actionId ? "" : text.trim() });
    setText("");
  };

  return (
    <div className="relative space-y-2">
      {message && !working && (
        <p className="rounded-lg border bg-card px-3 py-2 text-sm text-muted-foreground">{message}</p>
      )}
      {quote && (
        <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-1.5 text-xs text-muted-foreground">
          <Quote aria-hidden className="size-3 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{quote}</span>
          <button
            type="button"
            aria-label={t(($) => $.notes.prompt.removeQuote)}
            className="flex size-5 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:bg-accent"
            onClick={onClearQuote}
          >
            <X aria-hidden className="size-3" />
          </button>
        </div>
      )}
      <ChatComposer
        ref={composerRef}
        composerId="notes"
        value={text}
        onChange={setText}
        onSubmit={() => send(null)}
        busy={working}
        onStop={onStop}
        placeholder={t(($) => $.notes.prompt.placeholder)}
        attachments={NO_ATTACHMENTS}
        slashItems={slashItems}
        onSlashSelect={(item) => {
          if (isResearchAction(item.id)) send(item.id);
        }}
        labels={{ textarea: t(($) => $.notes.prompt.label) }}
        controls={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="xs"
                aria-label={t(($) => $.notes.prompt.agent)}
                className="max-w-44 text-muted-foreground data-[state=open]:bg-accent"
              >
                <span className="truncate">{agent}</span>
                <ChevronDown aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start">
              <DropdownMenuRadioGroup value={agent} onValueChange={setAgent}>
                {agents.map((name) => (
                  <DropdownMenuRadioItem key={name} value={name}>
                    {name}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />
    </div>
  );
}
