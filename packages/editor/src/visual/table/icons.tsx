import type { FC, ReactNode } from "react";

const Icon: FC<{ children: ReactNode }> = ({ children }) => (
  <svg
    className="ofl-visual-table-icon"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

export const AlignLeftIcon: FC = () => (
  <Icon>
    <path d="M2 3h12M2 6.5h7M2 10h12M2 13.5h7" />
  </Icon>
);

export const AlignCenterIcon: FC = () => (
  <Icon>
    <path d="M2 3h12M4.5 6.5h7M2 10h12M4.5 13.5h7" />
  </Icon>
);

export const AlignRightIcon: FC = () => (
  <Icon>
    <path d="M2 3h12M7 6.5h7M2 10h12M7 13.5h7" />
  </Icon>
);

export const AlignJustifyIcon: FC = () => (
  <Icon>
    <path d="M2 3h12M2 6.5h12M2 10h12M2 13.5h12" />
  </Icon>
);

export const WidthIcon: FC = () => (
  <Icon>
    <path d="M2 3v10M14 3v10M4.5 8h7M6.5 5.5L4 8l2.5 2.5M9.5 5.5L12 8l-2.5 2.5" />
  </Icon>
);

export const WrapIcon: FC = () => (
  <Icon>
    <path d="M2 4h12M2 8h9a2 2 0 0 1 0 4H9M2 12h4M10.5 10.5L9 12l1.5 1.5" />
  </Icon>
);

export const MergeIcon: FC = () => (
  <Icon>
    <path d="M2.5 3.5h11v9h-11zM8 3.5v2M8 10.5v2M5 8h6M6.5 6.5L5 8l1.5 1.5M9.5 6.5L11 8l-1.5 1.5" />
  </Icon>
);

export const TrashIcon: FC = () => (
  <Icon>
    <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5M6.8 7v4M9.2 7v4" />
  </Icon>
);

export const PlusIcon: FC = () => (
  <Icon>
    <path d="M8 3v10M3 8h10" />
  </Icon>
);

export const TableRemoveIcon: FC = () => (
  <Icon>
    <path d="M2.5 3h11v6h-11zM2.5 6h11M6 3v6M10 3v6M9.5 11l4 4M13.5 11l-4 4" />
  </Icon>
);

export const HelpIcon: FC = () => (
  <Icon>
    <circle cx="8" cy="8" r="6" />
    <path d="M6.2 6.3a1.9 1.9 0 0 1 3.7.6c0 1.2-1.9 1.4-1.9 2.6M8 11.6v.1" />
  </Icon>
);

export const ChevronDownIcon: FC = () => (
  <Icon>
    <path d="M4.5 6.5L8 10l3.5-3.5" />
  </Icon>
);

export const CheckIcon: FC = () => (
  <Icon>
    <path d="M3.5 8.5l3 3 6-6.5" />
  </Icon>
);

export const BorderAllIcon: FC = () => (
  <Icon>
    <path d="M2.5 2.5h11v11h-11zM2.5 8h11M8 2.5v11" />
  </Icon>
);

export const BorderNoneIcon: FC = () => (
  <Icon>
    <path d="M2.5 2.5h1M6 2.5h1M9 2.5h1M12.5 2.5h1M2.5 6v1M2.5 9v1M2.5 13.5h1M6 13.5h1M9 13.5h1M12.5 13.5h1M13.5 6v1M13.5 9v1M8 6v1M8 9v1M6 8h1M9 8h1" />
  </Icon>
);

export const BooktabsIcon: FC = () => (
  <Icon>
    <path d="M2.5 3h11M2.5 7h11M2.5 13h11M4 5v1M8 5v1M12 5v1M4 9v3M8 9v3M12 9v3" />
  </Icon>
);
