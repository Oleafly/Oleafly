import type { EditorView } from "@codemirror/view";
import {
  type Dispatch,
  type FC,
  type ReactNode,
  type RefObject,
  type SetStateAction,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { type TableEdit, sanitizeCellInput, writeCellEdit } from "./commands";
import type { ParsedTable, TableEnvironmentInfo } from "./model";
import { type CellSelection, clampSelection } from "./table-selection";

export interface TableHost {
  view: EditorView;
  parsed: ParsedTable;
  environment: TableEnvironmentInfo | null;
  directChild: boolean;
}

export type SelectionUpdate = CellSelection | null | ((current: CellSelection | null) => CellSelection | null);

interface SelectionState {
  selection: CellSelection | null;
  setSelection: (next: SelectionUpdate) => void;
  dragging: boolean;
  setDragging: Dispatch<SetStateAction<boolean>>;
}

export interface EditingCell {
  row: number;
  column: number;
  content: string;
  dirty: boolean;
}

interface EditingState {
  editing: EditingCell | null;
  startEditing: (row: number, column: number, initial?: string) => void;
  updateContent: (content: string) => void;
  commitEditing: () => void;
  cancelEditing: () => void;
}

export type DialogKind = "help" | "width" | null;

interface UiState {
  containerRef: RefObject<HTMLDivElement | null>;
  openMenu: string | null;
  setOpenMenu: Dispatch<SetStateAction<string | null>>;
  dialog: DialogKind;
  setDialog: Dispatch<SetStateAction<DialogKind>>;
}

const HostContext = createContext<TableHost | null>(null);
const SelectionContext = createContext<SelectionState | null>(null);
const EditingContext = createContext<EditingState | null>(null);
const UiContext = createContext<UiState | null>(null);

function required<T>(value: T | null, name: string): T {
  if (value === null) throw new Error(`${name} is only available inside the table editor`);
  return value;
}

export function useTableHost(): TableHost {
  return required(useContext(HostContext), "TableHost");
}

export function useTableSelection(): SelectionState {
  return required(useContext(SelectionContext), "TableSelection");
}

export function useTableEditing(): EditingState {
  return required(useContext(EditingContext), "TableEditing");
}

export function useTableUi(): UiState {
  return required(useContext(UiContext), "TableUi");
}

export function runEdit(host: TableHost, edit: TableEdit | null, setSelection: (next: SelectionUpdate) => void): void {
  if (!edit) return;
  if (edit.changes.length > 0) host.view.dispatch({ changes: edit.changes });
  host.view.requestMeasure();
  if (edit.selection) setSelection(edit.selection);
}

export function useApplyEdit(): (edit: TableEdit | null) => void {
  const host = useTableHost();
  const { setSelection } = useTableSelection();
  return useCallback((edit: TableEdit | null) => runEdit(host, edit, setSelection), [host, setSelection]);
}

export const TableProviders: FC<{ host: TableHost; children: ReactNode }> = ({ host, children }) => {
  const [rawSelection, setRawSelection] = useState<CellSelection | null>(null);
  const [dragging, setDragging] = useState(false);
  const [editing, setEditing] = useState<EditingCell | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const model = host.parsed.model;

  const selection = useMemo(() => clampSelection(model, rawSelection), [model, rawSelection]);
  const setSelection = useCallback((next: SelectionUpdate) => {
    setRawSelection((current) => (typeof next === "function" ? next(current) : next));
  }, []);

  const selectionState = useMemo<SelectionState>(
    () => ({ selection, setSelection, dragging, setDragging }),
    [selection, setSelection, dragging],
  );

  const editingRef = useRef<EditingCell | null>(null);
  editingRef.current = editing;

  const flushEditing = useCallback(() => {
    const current = editingRef.current;
    if (current?.dirty && current.row < model.rowCount) {
      const content = sanitizeCellInput(current.content);
      runEdit(host, writeCellEdit(host.parsed, current.row, current.column, content), setSelection);
    }
    editingRef.current = null;
  }, [host, model, setSelection]);

  const commitEditing = useCallback(() => {
    flushEditing();
    setEditing(null);
  }, [flushEditing]);

  const startEditing = useCallback(
    (row: number, column: number, initial?: string) => {
      const current = editingRef.current;
      if (current && (current.row !== row || current.column !== column)) flushEditing();
      const content = initial ?? model.cellAt(row, column).content.trim();
      const next = { row, column, content, dirty: initial !== undefined };
      editingRef.current = next;
      setEditing(next);
    },
    [flushEditing, model],
  );

  const updateContent = useCallback((content: string) => {
    setEditing((current) => (current ? { ...current, content, dirty: true } : current));
  }, []);

  const cancelEditing = useCallback(() => {
    editingRef.current = null;
    setEditing(null);
  }, []);

  const editingState = useMemo<EditingState>(
    () => ({ editing, startEditing, updateContent, commitEditing, cancelEditing }),
    [editing, startEditing, updateContent, commitEditing, cancelEditing],
  );

  const uiState = useMemo<UiState>(
    () => ({ containerRef, openMenu, setOpenMenu, dialog, setDialog }),
    [openMenu, dialog],
  );

  return (
    <HostContext.Provider value={host}>
      <SelectionContext.Provider value={selectionState}>
        <EditingContext.Provider value={editingState}>
          <UiContext.Provider value={uiState}>{children}</UiContext.Provider>
        </EditingContext.Provider>
      </SelectionContext.Provider>
    </HostContext.Provider>
  );
};
