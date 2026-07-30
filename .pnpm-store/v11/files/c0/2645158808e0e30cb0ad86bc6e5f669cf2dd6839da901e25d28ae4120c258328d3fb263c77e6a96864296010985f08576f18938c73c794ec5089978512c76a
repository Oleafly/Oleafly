import { EditorSlashMenuHiddenInput, EditorSlashMenuList, EditorSlashMenuPopup, EditorSlashMenuPortal, EditorSlashMenuPositioner } from "./atoms.mjs";
import { EditorSlashMenuItems, EditorSlashMenuOption } from "./type.mjs";
import React from "react";
import { AutocompleteRootChangeEventDetails, AutocompleteRootProps } from "@base-ui/react/autocomplete";
//#region src/EditorSlashMenu/EditorSlashMenu.d.ts
type Props = {
  /** Anchor for positioning (caret virtual element, dom element, ref, etc.) */
  anchor?: React.ComponentProps<typeof EditorSlashMenuPositioner>['anchor'];
  defaultOpen?: boolean;
  /** Initial query string (uncontrolled) */
  defaultValue?: string;
  /** Optional custom empty state */
  empty?: React.ReactNode;
  hiddenInputProps?: React.ComponentProps<typeof EditorSlashMenuHiddenInput>;
  items: EditorSlashMenuItems;
  listProps?: React.ComponentProps<typeof EditorSlashMenuList>;
  onOpenChange?: (open: boolean, details: AutocompleteRootChangeEventDetails) => void;
  onOpenChangeComplete?: (open: boolean) => void;
  /** Called when a command is selected. */
  onSelect?: (item: EditorSlashMenuOption, details: AutocompleteRootChangeEventDetails) => void;
  /** Called when query changes. By default, changes caused by item selection are ignored. */
  onValueChange?: (value: string, details: AutocompleteRootChangeEventDetails) => void;
  open?: boolean;
  popupProps?: React.ComponentProps<typeof EditorSlashMenuPopup>;
  portalProps?: Omit<React.ComponentProps<typeof EditorSlashMenuPortal>, 'container'> & {
    container?: HTMLElement | null;
  };
  positionerProps?: Omit<React.ComponentProps<typeof EditorSlashMenuPositioner>, 'anchor'>;
  /** Optional custom group label renderer */
  renderGroupLabel?: (label: string) => React.ReactNode;
  /** Optional custom item renderer */
  renderItem?: (item: EditorSlashMenuOption) => React.ReactNode;
  /** Reserve icon space even when icon is missing */
  reserveIconSpace?: boolean;
  /** Pass-through props */
  rootProps?: Omit<AutocompleteRootProps<EditorSlashMenuOption>, 'items' | 'value' | 'defaultValue' | 'onValueChange' | 'open' | 'defaultOpen' | 'onOpenChange' | 'onOpenChangeComplete' | 'itemToStringValue'>;
  /** Whether selecting an item should propagate its filled value via `onValueChange`. */
  updateValueOnSelect?: boolean;
  /** Current query string (controlled) */
  value?: string;
  /**
   * Render a visually-hidden input element for keyboard navigation / screen readers.
   * Default is `false` because slash menus usually live inside an editor input.
   */
  withHiddenInput?: boolean;
};
declare const EditorSlashMenu: React.NamedExoticComponent<Props>;
//#endregion
export { EditorSlashMenu as default };
//# sourceMappingURL=EditorSlashMenu.d.mts.map