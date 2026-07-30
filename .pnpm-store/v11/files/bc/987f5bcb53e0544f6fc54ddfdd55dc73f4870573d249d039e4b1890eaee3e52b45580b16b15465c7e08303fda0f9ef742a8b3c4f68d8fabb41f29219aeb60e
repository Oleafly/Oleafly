/** VS Code / TextMate theme object (frozen at runtime). */
interface PierreTheme {
  readonly name: string;
  readonly displayName: string;
  readonly type: "light" | "dark";
  readonly colors: Readonly<Record<string, string>>;
  readonly tokenColors: ReadonlyArray<{
    readonly name?: string;
    readonly scope?: string | string[];
    readonly settings: Readonly<Record<string, string>>;
  }>;
  readonly semanticTokenColors: Readonly<Record<string, string | Record<string, string>>>;
}

declare const theme: PierreTheme;
export default theme;
