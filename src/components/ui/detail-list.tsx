export interface DetailListItem {
  key: string;
  title: string;
  detail: string;
}

export function DetailList({ items, testId }: Readonly<{ items: readonly DetailListItem[]; testId?: string }>) {
  return (
    <ul className="mt-3 max-h-48 divide-y overflow-y-auto rounded-md border text-xs" data-testid={testId}>
      {items.map((item) => (
        <li key={item.key} className="px-3 py-2">
          <p className="truncate font-medium">{item.title}</p>
          <p className="text-muted-foreground">{item.detail}</p>
        </li>
      ))}
    </ul>
  );
}
