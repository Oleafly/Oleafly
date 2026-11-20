import { Fragment, type ReactNode, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { WorkspaceBanner, WorkspaceBannerButton, type WorkspaceBannerTone } from "@/components/ui/workspace-banner";
import { formatNameList, formatNumber } from "@/lib/intl";
import { PathMessage } from "./PathMessage";

export interface NoticeItem {
  key: string;
  path: string;
  name: string;
  actions?: ReactNode;
  alert?: ReactNode;
}

function Actions({ children }: Readonly<{ children: ReactNode }>) {
  return children ? <span className="flex shrink-0 items-center gap-1">{children}</span> : null;
}

export function NoticeGroup({
  items,
  tone,
  icon,
  testId,
  message,
  actions,
}: Readonly<{
  items: readonly NoticeItem[];
  tone: WorkspaceBannerTone;
  icon: ReactNode;
  testId: string;
  message: (names: string) => string;
  actions?: ReactNode;
}>) {
  const { t } = useTranslation(["collab", "common"]);
  const listId = useId();
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  if (items.length === 1) {
    const [item] = items;
    return (
      <WorkspaceBanner tone={tone} data-testid={testId}>
        {icon}
        <PathMessage paths={[item.path]}>{message(item.name)}</PathMessage>
        <Actions>{item.actions}</Actions>
        {item.alert}
      </WorkspaceBanner>
    );
  }
  const names = formatNameList(
    items.map((item) => item.name),
    (shown, rest) => t(($) => $.collab.history.authorsMore, { names: shown, number: formatNumber(rest) }),
    3,
  );
  return (
    <WorkspaceBanner tone={tone} data-testid={testId}>
      {icon}
      <PathMessage paths={items.map((item) => item.path)}>{message(names)}</PathMessage>
      <span className="flex shrink-0 items-center gap-1">
        <WorkspaceBannerButton
          tone={tone}
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? t(($) => $.common.actions.showLess) : t(($) => $.common.actions.showMore)}
        </WorkspaceBannerButton>
        {actions}
      </span>
      {open ? (
        <ul id={listId} className="max-h-48 basis-full space-y-1 overflow-y-auto pb-1">
          {items.map((item) => (
            <li key={item.key} data-testid={`${testId}-item`} className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="min-w-0 flex-1 break-all select-text font-mono text-[0.6875rem]">{item.path}</span>
              <Actions>{item.actions}</Actions>
              {item.alert}
            </li>
          ))}
        </ul>
      ) : (
        items.map((item) => (item.alert ? <Fragment key={item.key}>{item.alert}</Fragment> : null))
      )}
    </WorkspaceBanner>
  );
}
