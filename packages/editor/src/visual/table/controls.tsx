import { type FC, type MouseEvent, type ReactNode, useEffect, useRef } from "react";
import { useTableUi } from "./contexts";
import { CheckIcon, ChevronDownIcon } from "./icons";

const keepFocus = (event: MouseEvent) => {
  event.preventDefault();
  event.stopPropagation();
};

export const ToolbarButton: FC<{
  label: string;
  icon: ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  disabledLabel?: string;
  expanded?: boolean;
  caret?: boolean;
}> = ({ label, icon, onClick, active, disabled, disabledLabel, expanded, caret }) => (
  <button
    type="button"
    className="ofl-visual-table-button"
    title={disabled && disabledLabel ? disabledLabel : label}
    aria-label={label}
    aria-pressed={active}
    aria-expanded={expanded}
    disabled={disabled}
    onMouseDown={keepFocus}
    onClick={onClick}
  >
    {icon}
    {caret ? <ChevronDownIcon /> : null}
  </button>
);

export const ToolbarMenu: FC<{
  id: string;
  trigger: (state: { open: boolean; toggle: () => void }) => ReactNode;
  children: ReactNode;
}> = ({ id, trigger, children }) => {
  const { openMenu, setOpenMenu } = useTableUi();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const open = openMenu === id;

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: Event) => {
      if (!hostRef.current?.contains(event.target as Node)) setOpenMenu(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenMenu(null);
    };
    document.addEventListener("mousedown", onPointer, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onPointer, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, setOpenMenu]);

  return (
    <div className="ofl-visual-table-menu-host" ref={hostRef}>
      {trigger({ open, toggle: () => setOpenMenu(open ? null : id) })}
      {open ? (
        <div className="ofl-visual-table-menu" role="menu">
          {children}
        </div>
      ) : null}
    </div>
  );
};

export const ToolbarSelect: FC<{
  id: string;
  value: string;
  label: string;
  disabled?: boolean;
  disabledLabel?: string;
  children: ReactNode;
}> = ({ id, value, label, disabled, disabledLabel, children }) => (
  <ToolbarMenu
    id={id}
    trigger={({ open, toggle }) => (
      <button
        type="button"
        className="ofl-visual-table-select"
        title={disabled && disabledLabel ? disabledLabel : label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onMouseDown={keepFocus}
        onClick={toggle}
      >
        <span>{value}</span>
        <ChevronDownIcon />
      </button>
    )}
  >
    {children}
  </ToolbarMenu>
);

export const MenuItem: FC<{
  label: string;
  icon?: ReactNode;
  checked?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}> = ({ label, icon, checked, disabled, onSelect }) => {
  const { setOpenMenu } = useTableUi();
  return (
    <button
      type="button"
      className="ofl-visual-table-menu-item"
      role={checked === undefined ? "menuitem" : "menuitemradio"}
      aria-checked={checked}
      disabled={disabled}
      onMouseDown={keepFocus}
      onClick={() => {
        setOpenMenu(null);
        onSelect();
      }}
    >
      {icon}
      <span className="ofl-visual-table-menu-label">{label}</span>
      {checked ? <CheckIcon /> : null}
    </button>
  );
};

export const MenuSeparator: FC = () => <div className="ofl-visual-table-menu-separator" role="separator" />;
