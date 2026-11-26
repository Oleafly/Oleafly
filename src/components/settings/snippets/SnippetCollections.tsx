import { useTranslation } from "react-i18next";
import { Box, Layers, type LucideIcon, Package, Plus, User } from "lucide-react";
import type { LayerId, SnippetRecord } from "@oleafly/snippets";
import { Button } from "@/components/ui/button";
import { NavItem } from "@/components/ui/nav-item";
import { SectionHeading } from "@/components/ui/section-heading";
import { Switch } from "@/components/ui/switch";

export interface SnippetCollection {
  id: string;
  name: string;
  layer: LayerId;
  count: number;
  enabled: boolean;
}

const LAYER_ICONS: Readonly<Record<LayerId, LucideIcon>> = { user: User, project: User, pack: Package, builtin: Box };

export function collectionsOf(
  records: readonly SnippetRecord[],
  names: (collection: string) => string,
  disabled: ReadonlySet<string>,
  extra: readonly { id: string; layer: LayerId }[],
): SnippetCollection[] {
  const found = new Map<string, SnippetCollection>();
  for (const { id, layer } of extra) {
    found.set(id, { id, name: names(id), layer, count: 0, enabled: !disabled.has(id) });
  }
  for (const record of records) {
    const known = found.get(record.collection);
    if (known) known.count += 1;
    else found.set(record.collection, { id: record.collection, name: names(record.collection), layer: record.layer, count: 1, enabled: !disabled.has(record.collection) });
  }
  return [...found.values()];
}

function CollectionRow({
  collection,
  active,
  onSelect,
  onToggle,
}: Readonly<{
  collection: SnippetCollection;
  active: boolean;
  onSelect: () => void;
  onToggle: (enabled: boolean) => void;
}>) {
  const { t } = useTranslation(["settings"]);
  return (
    <div className="flex items-center gap-1.5">
      <NavItem
        icon={LAYER_ICONS[collection.layer]}
        active={active}
        onClick={onSelect}
        className="min-w-0 flex-1"
        labelClassName="flex min-w-0 flex-1 items-center gap-2"
        label={
          <>
            <span className="truncate">{collection.name}</span>
            <span className="ml-auto font-mono text-xs text-muted-foreground">{collection.count}</span>
          </>
        }
      />
      <Switch
        checked={collection.enabled}
        onCheckedChange={onToggle}
        aria-label={t(($) => $.settings.snippets.library.useCollection, { name: collection.name })}
      />
    </div>
  );
}

export function SnippetCollections({
  collections,
  total,
  selected,
  onSelect,
  onToggle,
  onAdd,
}: Readonly<{
  collections: readonly SnippetCollection[];
  total: number;
  selected: string | null;
  onSelect: (collection: string | null) => void;
  onToggle: (collection: string, enabled: boolean) => void;
  onAdd: () => void;
}>) {
  const { t } = useTranslation(["settings"]);
  const groups = [
    { key: "mine", label: t(($) => $.settings.snippets.library.mine), layers: ["user", "project"] },
    { key: "packs", label: t(($) => $.settings.snippets.library.packs), layers: ["pack"] },
    { key: "builtIn", label: t(($) => $.settings.snippets.library.builtIn), layers: ["builtin"] },
  ] as const;
  return (
    <nav aria-label={t(($) => $.settings.snippets.library.collections)} className="flex flex-col gap-1">
      <NavItem
        icon={Layers}
        active={selected === null}
        onClick={() => onSelect(null)}
        labelClassName="flex min-w-0 flex-1 items-center gap-2"
        label={
          <>
            <span className="truncate">{t(($) => $.settings.snippets.library.all)}</span>
            <span className="ml-auto font-mono text-xs text-muted-foreground">{total}</span>
          </>
        }
      />
      {groups.map((group) => {
        const members = collections.filter((collection) => (group.layers as readonly LayerId[]).includes(collection.layer));
        if (members.length === 0) return null;
        return (
          <div key={group.key} className="flex flex-col gap-1">
            <SectionHeading as="h4" className="mt-2 px-2.5">
              {group.label}
            </SectionHeading>
            {members.map((collection) => (
              <CollectionRow
                key={collection.id}
                collection={collection}
                active={selected === collection.id}
                onSelect={() => onSelect(collection.id)}
                onToggle={(enabled) => onToggle(collection.id, enabled)}
              />
            ))}
          </div>
        );
      })}
      <Button type="button" variant="ghost" size="sm" className="mt-2 justify-start" onClick={onAdd}>
        <Plus aria-hidden />
        {t(($) => $.settings.snippets.library.add)}
      </Button>
    </nav>
  );
}
