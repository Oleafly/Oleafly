import type { EditorView } from "@codemirror/view";
import { Component, type ErrorInfo, type FC, type ReactNode, useEffect, useLayoutEffect } from "react";
import { Dialogs } from "./dialogs";
import { Grid } from "./Grid";
import { Toolbar } from "./Toolbar";
import { type TableHost, TableProviders, useTableEditing, useTableHost, useTableSelection, useTableUi } from "./contexts";
import { editorMessage } from "../../messages";

export const RenderingError: FC<{ view: EditorView; position: number }> = ({ view, position }) => (
  <div className="ofl-visual-table-error" role="alert">
    <div className="ofl-visual-table-error-title">{editorMessage("visual.table.errorTitle")}</div>
    <div>{editorMessage("visual.table.errorBody")}</div>
    <button
      type="button"
      className="ofl-visual-table-error-action"
      onClick={() => {
        view.dispatch({ selection: { anchor: position } });
        view.focus();
      }}
    >
      {editorMessage("visual.table.viewSource")}
    </button>
  </div>
);

class TableErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Visual table rendering failed", error, info.componentStack);
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

const EditorBody: FC = () => {
  const { view, parsed } = useTableHost();
  const { selection, setSelection } = useTableSelection();
  const { editing, commitEditing } = useTableEditing();
  const { containerRef, setOpenMenu } = useTableUi();

  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (containerRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest("[data-ofl-visual-table-dialog]")) return;
      setOpenMenu(null);
      if (editing) commitEditing();
      if (selection) setSelection(null);
    };
    window.addEventListener("mousedown", onMouseDown);
    return () => window.removeEventListener("mousedown", onMouseDown);
  }, [containerRef, editing, commitEditing, selection, setSelection, setOpenMenu]);

  useLayoutEffect(() => {
    view.requestMeasure();
  }, [view, parsed, editing, selection]);

  return (
    <div className="ofl-visual-table-frame" ref={containerRef}>
      {view.state.readOnly ? null : <Toolbar />}
      <Grid />
      <Dialogs />
    </div>
  );
};

export const TableEditor: FC<{ host: TableHost }> = ({ host }) => (
  <TableErrorBoundary fallback={<RenderingError view={host.view} position={host.parsed.tabular.from} />}>
    <TableProviders host={host}>
      <EditorBody />
    </TableProviders>
  </TableErrorBoundary>
);
