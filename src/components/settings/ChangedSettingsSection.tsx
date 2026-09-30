import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { CircleCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty";
import {
  formatSettingValue,
  type SettingDefinition,
  type SettingId,
  type SettingSectionId,
} from "@/store/settings-schema";
import { useChangedSettings } from "./changed-settings";
import { ResetSettingButton } from "./SettingRow";

/** Every setting that differs from its default, grouped like the navigation. */
export function ChangedSettingsSection({ onShow }: Readonly<{ onShow: (id: SettingId) => void }>) {
  const { t } = useTranslation(["common", "settings", "shell"]);
  const changed = useChangedSettings();
  const rootRef = useRef<HTMLDivElement>(null);
  const definitions = changed?.changed ?? [];

  // After a reset the row leaves, so keyboard focus moves to a neighbour.
  const nextFocus = (button: HTMLElement): HTMLElement | null => {
    const item = button.closest("li");
    const neighbour = item?.nextElementSibling ?? item?.previousElementSibling;
    return neighbour?.querySelector<HTMLElement>("[data-changed-show]") ?? rootRef.current;
  };

  const groups = new Map<SettingSectionId, SettingDefinition[]>();
  for (const definition of definitions) {
    const group = groups.get(definition.section);
    if (group) group.push(definition);
    else groups.set(definition.section, [definition]);
  }

  return (
    <div ref={rootRef} tabIndex={-1} className="space-y-5">
      {definitions.length === 0 ? (
        <Empty className="py-16">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CircleCheck aria-hidden className="size-5" />
            </EmptyMedia>
            <EmptyDescription>{t(($) => $.settings.changed.empty)}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <p className="text-sm text-muted-foreground">{t(($) => $.settings.changed.intro)}</p>
      )}
      {[...groups].map(([section, items]) => (
        <section
          key={section}
          aria-labelledby={`changed-settings-${section}`}
          className="space-y-2"
        >
          <h3
            id={`changed-settings-${section}`}
            className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          >
            {t(($) => $.shell.settings.nav[section])}
          </h3>
          <ul className="m-0 list-none divide-y rounded-lg border bg-card p-0">
            {items.map((definition) => {
              const label = definition.label();
              const value = changed ? definition.read(changed.snapshot) : undefined;
              return (
                <li
                  key={definition.id}
                  data-testid={`changed-setting-${definition.id}`}
                  className="flex items-center justify-between gap-3 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{label}</p>
                    <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                      {definition.kind === "color" && typeof value === "string" ? (
                        <span
                          aria-hidden
                          className="size-3 shrink-0 rounded-full border"
                          style={{ backgroundColor: value }}
                        />
                      ) : null}
                      <span className="truncate">{formatSettingValue(definition, value)}</span>
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      data-changed-show
                      aria-label={t(($) => $.settings.changed.showAriaLabel, { label })}
                      onClick={() => onShow(definition.id)}
                    >
                      {t(($) => $.settings.changed.show)}
                    </Button>
                    <ResetSettingButton id={definition.id} label={label} nextFocus={nextFocus} />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
