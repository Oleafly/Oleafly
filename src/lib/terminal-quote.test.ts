import { describe, expect, it } from "vitest";
import {
  hasControlCharacters,
  quoteShellArg,
  relativeTerminalPath,
  shellCommandLine,
  terminalPathArg,
} from "./terminal-quote";

describe("terminal quoting", () => {
  it("invokes a quoted program with & in PowerShell, doubling every kind of single quote", () => {
    expect(shellCommandLine("powershell", { command: "C:\\Program Files\\Claude\\claude.exe", args: [] })).toBe(
      "& 'C:\\Program Files\\Claude\\claude.exe'",
    );
    expect(
      shellCommandLine("powershell", {
        command: "C:\\Users\\O'Brien\\bin\\pi.exe",
        args: ["login", "--profile", "work space"],
      }),
    ).toBe("& 'C:\\Users\\O''Brien\\bin\\pi.exe' login --profile 'work space'");
    expect(quoteShellArg("powershell", "D:\\tools\\it’s\\x.exe")).toBe("'D:\\tools\\it’’s\\x.exe'");
    expect(quoteShellArg("powershell", "$env:HOME")).toBe("'$env:HOME'");
    expect(quoteShellArg("powershell", "@args")).toBe("'@args'");
    expect(quoteShellArg("powershell", "a;b")).toBe("'a;b'");
    expect(quoteShellArg("powershell", "")).toBe("''");
  });

  it("double-quotes cmd arguments that need it", () => {
    expect(shellCommandLine("cmd", { command: "C:\\Program Files\\Git\\cmd\\git.exe", args: ["status"] })).toBe(
      "\"C:\\Program Files\\Git\\cmd\\git.exe\" status",
    );
    expect(quoteShellArg("cmd", "a&b")).toBe("\"a&b\"");
    expect(quoteShellArg("cmd", "say \"hi\"")).toBe("\"say \"\"hi\"\"\"");
    expect(quoteShellArg("cmd", "D:\\naïve dir\\tool.exe")).toBe("\"D:\\naïve dir\\tool.exe\"");
    expect(quoteShellArg("cmd", "")).toBe("\"\"");
  });

  it("single-quotes POSIX arguments and escapes embedded quotes", () => {
    expect(shellCommandLine("posix", { command: "/Users/me/My Apps/claude", args: ["--version"] })).toBe(
      "'/Users/me/My Apps/claude' --version",
    );
    expect(quoteShellArg("posix", "it's")).toBe("'it'\\''s'");
    expect(quoteShellArg("posix", "$HOME`id`")).toBe("'$HOME`id`'");
    expect(quoteShellArg("posix", "C:\\Program Files\\x.exe")).toBe("'C:\\Program Files\\x.exe'");
    expect(quoteShellArg("posix", "")).toBe("''");
    expect(quoteShellArg("posix", "src/main.tex")).toBe("src/main.tex");
    expect(quoteShellArg("posix", "=cmd")).toBe("'=cmd'");
    expect(quoteShellArg("posix", "~/x")).toBe("'~/x'");
  });

  it("escapes backslashes and quotes inside fish single quotes", () => {
    expect(quoteShellArg("fish", "it's")).toBe("'it\\'s'");
    expect(quoteShellArg("fish", "a\\b c")).toBe("'a\\\\b c'");
    expect(shellCommandLine("fish", { command: "/opt/bin/pi", args: ["login"] })).toBe("/opt/bin/pi login");
  });

  it("writes dropped paths with the shell's separator", () => {
    expect(terminalPathArg("powershell", "windows", "chapters/intro 1.tex")).toBe("'chapters\\intro 1.tex'");
    expect(terminalPathArg("cmd", "windows", "figures/a.png")).toBe("figures\\a.png");
    expect(terminalPathArg("posix", "windows", "figures/a b.png")).toBe("'figures/a b.png'");
    expect(terminalPathArg("posix", "linux", "figures/a.png")).toBe("figures/a.png");
    expect(terminalPathArg("powershell", "linux", "figures/a.png")).toBe("figures/a.png");
  });

  it("makes project paths relative to the terminal's start folder", () => {
    expect(relativeTerminalPath("", "figures/a.png")).toBe("figures/a.png");
    expect(relativeTerminalPath("chapters", "chapters/intro.tex")).toBe("intro.tex");
    expect(relativeTerminalPath("chapters/one", "figures/a.png")).toBe("../../figures/a.png");
    expect(relativeTerminalPath("chapters", "chapters")).toBe(".");
  });

  it("flags control characters", () => {
    expect(hasControlCharacters("ok")).toBe(false);
    expect(hasControlCharacters("café 漢")).toBe(false);
    expect(hasControlCharacters("a\nb")).toBe(true);
    expect(hasControlCharacters("\x1b[2J")).toBe(true);
    expect(hasControlCharacters("tab\there")).toBe(true);
    expect(hasControlCharacters("del\x7f")).toBe(true);
  });
});
