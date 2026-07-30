//#region src/utils/iterateOverFile.d.ts
interface IterateOverFileProps {
  lines: string[];
  startingLine?: number;
  totalLines?: number;
  callback: FileLineCallback;
}
interface FileLineCallbackProps {
  lineIndex: number;
  lineNumber: number;
  content: string;
  isLastLine: boolean;
}
type FileLineCallback = (props: FileLineCallbackProps) => boolean | void;
/**
 * Iterates over lines in a file with optional windowing support.
 *
 * Similar to `iterateOverDiff` but simplified for linear file content.
 * Supports viewport windowing for virtualization scenarios.
 *
 * @param props - Configuration for iteration
 * @param props.lines - Pre-split array of lines (use splitFileContents() to create from string)
 * @param props.startingLine - Optional starting line index (0-based, default: 0)
 * @param props.totalLines - Optional max lines to iterate (default: Infinity)
 * @param props.callback - Callback invoked for each line in the window.
 *                         Return `true` to stop iteration early.
 *
 * @example
 * ```typescript
 * const lines = splitFileContents('line1\nline2\nline3');
 * iterateOverFile({
 *   lines,
 *   startingLine: 0,
 *   totalLines: 10,
 *   callback: ({ lineIndex, lineNumber, content, isLastLine }) => {
 *     console.log(`Line ${lineNumber}: ${content}`);
 *     if (content.includes('stop')) return true; // Stop iteration
 *   }
 * });
 * ```
 */
declare function iterateOverFile({
  lines,
  startingLine,
  totalLines,
  callback
}: IterateOverFileProps): void;
//#endregion
export { FileLineCallback, FileLineCallbackProps, IterateOverFileProps, iterateOverFile };
//# sourceMappingURL=iterateOverFile.d.ts.map