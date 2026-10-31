export type EditorErrorReporter = (scope: string, error: unknown) => void;

let reporter: EditorErrorReporter = (scope, error) => console.error(scope, error);

export function setEditorErrorReporter(next: EditorErrorReporter): void {
  reporter = next;
}

export function reportEditorError(scope: string, error: unknown): void {
  reporter(scope, error);
}
