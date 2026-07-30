import React from "react";
import { AutocompleteRootChangeEventDetails } from "@base-ui/react/autocomplete";
//#region src/EditorSlashMenu/type.d.ts
type EditorSlashMenuItemValue = string;
type EditorSlashMenuOption = {
  /** Render danger style (red) */
  danger?: boolean;
  /** Whether the item is disabled */
  disabled?: boolean;
  /** Optional extra content shown at the end */
  extra?: React.ReactNode;
  /** Optional icon shown at the start */
  icon?: React.ReactNode;
  /** Optional additional keywords for filtering */
  keywords?: string[];
  /** Visible label, also used for filtering by default */
  label: string;
  /** Unique id of the command */
  value: EditorSlashMenuItemValue;
};
type EditorSlashMenuGroup = {
  items: EditorSlashMenuOption[];
  /** Optional group title */
  label?: string;
};
type EditorSlashMenuItems = Array<EditorSlashMenuOption | EditorSlashMenuGroup>;
type EditorSlashMenuOnOpenChange = (open: boolean, details: AutocompleteRootChangeEventDetails) => void;
type EditorSlashMenuOnValueChange = (value: string, details: AutocompleteRootChangeEventDetails) => void;
type EditorSlashMenuOnSelect = (item: EditorSlashMenuOption, details: AutocompleteRootChangeEventDetails) => void;
type EditorSlashMenuValueToString = (item: EditorSlashMenuOption) => string;
type EditorSlashMenuRenderItem = (item: EditorSlashMenuOption) => React.ReactNode;
type EditorSlashMenuRenderGroupLabel = (label: string) => React.ReactNode;
type EditorSlashMenuPlacement = 'top' | 'bottom';
//#endregion
export { EditorSlashMenuGroup, EditorSlashMenuItemValue, EditorSlashMenuItems, EditorSlashMenuOnOpenChange, EditorSlashMenuOnSelect, EditorSlashMenuOnValueChange, EditorSlashMenuOption, EditorSlashMenuPlacement, EditorSlashMenuRenderGroupLabel, EditorSlashMenuRenderItem, EditorSlashMenuValueToString };
//# sourceMappingURL=type.d.mts.map