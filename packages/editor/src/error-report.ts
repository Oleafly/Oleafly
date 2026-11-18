export type EditorErrorReporter = (scope: string, error: unknown) => void;

let reporter: EditorErrorReporter | null = null;

export function setEditorErrorReporter(next: EditorErrorReporter | null): void {
  reporter = next;
}

export function reportEditorError(scope: string, error: unknown): void {
  console.error(scope, error);
  reporter?.(scope, error);
}
