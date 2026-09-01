// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@/lib/theme";
import { Markdown } from "./markdown";

const require = createRequire(join(process.cwd(), "package.json"));
const chatStyles = readFileSync(join(process.cwd(), "src/styles/globals.css"), "utf8");
const katexStyles = readFileSync(require.resolve("katex/dist/katex.min.css"), "utf8");
const rehypeRequire = createRequire(require.resolve("rehype-katex"));

function packageVersion(packagePath: string) {
  return JSON.parse(readFileSync(packagePath, "utf8") as string).version as string;
}

const mermaidInitialize = vi.hoisted(() => vi.fn());
const mermaidRender = vi.hoisted(() => vi.fn());
const clipboardWrite = vi.fn();

vi.mock("mermaid", () => ({
  default: {
    initialize: mermaidInitialize,
    render: mermaidRender,
  },
}));

function renderWithTheme(markdown: string, theme: "light" | "dark" = "dark") {
  window.localStorage.setItem("oleafly.theme", theme);
  return render(
    <ThemeProvider>
      <Markdown>{markdown}</Markdown>
    </ThemeProvider>,
  );
}

describe("Markdown rich content", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: clipboardWrite },
    });
    clipboardWrite.mockReset();
    clipboardWrite.mockResolvedValue(undefined);
    mermaidInitialize.mockClear();
    mermaidRender.mockReset();
    mermaidRender.mockResolvedValue({
      svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>Rendered diagram</text></svg>',
    });
  });

  it("uses the same KaTeX version for generated markup and loaded styles", () => {
    expect(packageVersion(rehypeRequire.resolve("katex/package.json"))).toBe(
      packageVersion(require.resolve("katex/package.json")),
    );
  });

  it("renders inline math with KaTeX markup", async () => {
    const { container } = render(<Markdown>{"The result is $x^2$."}</Markdown>);

    await waitFor(() => expect(container.querySelector(".katex")).not.toBeNull());
  });

  it("renders the complex chat math fixture with the matching KaTeX layout structure", async () => {
    const source = String.raw`
The attention update is

$$
\operatorname{Attention}(Q,K,V)=\operatorname{softmax}\!\left(\frac{QK^{\mathsf T}}{\sqrt{d_k}}\right)V
$$

Online softmax keeps

$$
m_i^{(t)}=\max\!\left(m_i^{(t-1)},m_{ij}^{(t)}\right)
$$

$$
\ell_i^{(t)}=e^{m_i^{(t-1)}-m_i^{(t)}}\ell_i^{(t-1)}+\sum_{j\in B_t}e^{s_{ij}-m_i^{(t)}}
$$

and the nested expectation is

$$
\mathbb E_{x\sim p(x)}\!\left[\left(\frac{\sum_{i=1}^{n}x_i^2}{\sqrt{1+e^{-\alpha x^2}}}\right)^{\!\beta}\right].
$$`;
    const { container } = render(<Markdown className="chat-markdown">{source}</Markdown>);

    await waitFor(() =>
      expect(container.querySelectorAll(".katex-display")).toHaveLength(4)
    );
    expect(container.querySelectorAll(".katex-base").length).toBeGreaterThan(0);
    expect(container.querySelectorAll(".katex-strut").length).toBeGreaterThan(0);
    expect(container.querySelector(".katex-html > .katex-base > .katex-strut")).not.toBeNull();
    expect(container.querySelectorAll(".mfrac").length).toBeGreaterThanOrEqual(2);
    expect(container.querySelector(".mfrac .frac-line")).not.toBeNull();
    expect(container.querySelectorAll(".sqrt").length).toBeGreaterThanOrEqual(2);
    expect(container.querySelectorAll(".msupsub").length).toBeGreaterThanOrEqual(8);
  });

  it("isolates KaTeX layout from chat prose styles without overriding math internals", async () => {
    expect(chatStyles).toContain(".chat-markdown .katex");
    const style = document.createElement("style");
    style.textContent = `${katexStyles}\n${chatStyles}`;
    document.head.append(style);
    const { container } = render(
      <Markdown className="chat-markdown">
        {String.raw`A relaxed prose line with $m_i^{(t)}$.

$$
\frac{\sum_{i=1}^{n}x_i^2}{\sqrt{d_k}}
$$`}
      </Markdown>,
    );

    await waitFor(() => expect(container.querySelector(".mfrac")).not.toBeNull());
    const math = container.querySelector<HTMLElement>(".katex");
    const descendant = container.querySelector<HTMLElement>(".katex .mord");
    const base = container.querySelector<HTMLElement>(".katex-base");
    const script = container.querySelector<HTMLElement>(".msupsub");
    const fraction = container.querySelector<HTMLElement>(".mfrac > span > span");
    const vlist = container.querySelector<HTMLElement>(".vlist");
    const display = container.querySelector<HTMLElement>(".katex-display");

    if (!(math && descendant && base && script && fraction && vlist && display)) {
      throw new Error("The KaTeX fixture is missing required layout elements");
    }

    expect(getComputedStyle(math).lineHeight).toBe("normal");
    expect(getComputedStyle(math).whiteSpace).toBe("nowrap");
    expect(getComputedStyle(descendant).lineHeight).toBe("normal");
    // Inner atoms must stay nowrap or KaTeX shatters onto multiple lines.
    expect(getComputedStyle(descendant).whiteSpace).toBe("nowrap");
    expect(getComputedStyle(base).whiteSpace).toBe("nowrap");
    expect(getComputedStyle(script).textAlign).toBe("left");
    expect(getComputedStyle(fraction).textAlign).toBe("center");
    expect(getComputedStyle(vlist).verticalAlign).toBe("bottom");
    expect(getComputedStyle(display).textAlign).toBe("center");
    expect(getComputedStyle(display).overflowX).toBe("auto");

    style.remove();
  });

  it("allows wide display math to scroll horizontally", async () => {
    const { container } = render(
      <Markdown>{"$$\n\\sum_{i=1}^{100} x_i^2 = x_1^2 + \\cdots + x_{100}^2\n$$"}</Markdown>,
    );

    await waitFor(() => expect(container.querySelector(".katex-display")).not.toBeNull());
    expect(container.firstElementChild).toHaveClass(
      "[&_.katex-display]:overflow-x-auto",
    );
    expect(container.firstElementChild).not.toHaveClass(
      "[&_.katex-display]:overflow-y-hidden",
    );
  });

  it("keeps tagged display equations on KaTeX's full-width positioning block", async () => {
    const style = document.createElement("style");
    style.textContent = `${katexStyles}\n${chatStyles}`;
    document.head.append(style);
    const { container } = render(
      <Markdown className="chat-markdown">{"$$\nE=mc^2\\tag{1}\n$$"}</Markdown>,
    );

    await waitFor(() => expect(container.querySelector(".katex-tag")).not.toBeNull());
    const math = container.querySelector<HTMLElement>(".katex-display > .katex");
    if (!math) throw new Error("The tagged equation is missing its KaTeX block");
    expect(getComputedStyle(math).display).toBe("block");
    expect(getComputedStyle(math).textAlign).toBe("center");
    style.remove();
  });

  it("keeps malformed math source visible without throwing", async () => {
    const source = String.raw`\frac{`;
    const { container } = render(<Markdown>{`$${source}$`}</Markdown>);

    await waitFor(() =>
      expect(container.querySelector(".katex-error")).toHaveTextContent(source)
    );
  });

  it("renders closed math during streaming and keeps malformed closed math readable", async () => {
    const source = String.raw`Ready $x_i^{(t)}$ and malformed $\frac{$`;
    const { container } = render(<Markdown streaming>{source}</Markdown>);

    await waitFor(() => expect(container.querySelector(".katex")).not.toBeNull());
    expect(container.querySelector(".katex-error")).toHaveTextContent(String.raw`\frac{`);
  });

  it.each([
    ["inline math", "Before $x^2"],
    ["display math", "Before\n\n$$\n\\frac{1}{2}"],
    ["code", "Before\n\n```ts\nconst x = 1;"],
    ["Mermaid", "Before\n\n```mermaid\nflowchart TD\n  A --> B"],
    ["quoted Mermaid", "> ```mermaid\n> flowchart TD\n>   A --> B"],
    ["listed Mermaid", "- ```mermaid\n  flowchart TD\n    A --> B"],
  ])("keeps unfinished streaming %s raw", async (_label, source) => {
    const { container } = render(<Markdown streaming>{source}</Markdown>);

    await waitFor(() => expect(container.querySelector('[data-streaming-raw="true"]')).not.toBeNull());
    expect(container.querySelector(".katex")).toBeNull();
    expect(container.querySelector("pre code")).toBeNull();
    expect(container.querySelector('[data-mermaid-diagram="true"]')).toBeNull();
  });

  it("waits for a closing Mermaid fence before compiling the diagram", async () => {
    const source = "```mermaid\nflowchart TD\n  A --> B";
    window.localStorage.setItem("oleafly.theme", "dark");
    const { container, rerender } = render(
      <ThemeProvider>
        <Markdown streaming>{source}</Markdown>
      </ThemeProvider>,
    );

    await waitFor(() => expect(container.querySelector('[data-streaming-raw="true"]')).not.toBeNull());
    expect(mermaidRender).not.toHaveBeenCalled();

    rerender(
      <ThemeProvider>
        <Markdown streaming>{`${source}\n\`\`\``}</Markdown>
      </ThemeProvider>,
    );

    await screen.findByRole("img", { name: "Diagram" });
    expect(mermaidRender).toHaveBeenCalledTimes(1);
  });

  it("does not recompile a settled Mermaid diagram or flash it at completion", async () => {
    const diagram = "```mermaid\nflowchart TD\n  A --> B\n```";
    window.localStorage.setItem("oleafly.theme", "dark");
    const { rerender } = render(
      <ThemeProvider>
        <Markdown streaming>{diagram}</Markdown>
      </ThemeProvider>,
    );
    await screen.findByRole("img", { name: "Diagram" });
    expect(mermaidRender).toHaveBeenCalledTimes(1);

    const completed = `${diagram}\n\nThe explanation is ready.`;
    rerender(
      <ThemeProvider>
        <Markdown streaming>{completed}</Markdown>
      </ThemeProvider>,
    );
    await screen.findByText("The explanation is ready.");
    expect(mermaidRender).toHaveBeenCalledTimes(1);

    rerender(
      <ThemeProvider>
        <Markdown>{completed}</Markdown>
      </ThemeProvider>,
    );
    await screen.findByText("The explanation is ready.");
    expect(mermaidRender).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("status", { name: "Rendering diagram" })).toBeNull();
  });

  it("preserves loose-list and reference-link semantics through completion", async () => {
    const looseList = "1. First\n\n   continuation\n\n2. Second";
    const { container, rerender } = render(<Markdown streaming>{looseList}</Markdown>);

    await waitFor(() => expect(container.querySelectorAll("ol")).toHaveLength(1));
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelector("li")).toHaveTextContent("First continuation");

    rerender(<Markdown>{looseList}</Markdown>);
    expect(container.querySelectorAll("ol")).toHaveLength(1);
    expect(container.querySelectorAll("li")).toHaveLength(2);

    const reference = "Read [the guide][g].\n\n[g]: https://example.com/guide";
    rerender(<Markdown streaming>{reference}</Markdown>);
    await waitFor(() =>
      expect(container.querySelector("a")).toHaveAttribute("href", "https://example.com/guide")
    );
    rerender(<Markdown>{reference}</Markdown>);
    expect(container.querySelector("a")).toHaveAttribute("href", "https://example.com/guide");
  });

  it.each([
    ["dark", "dark"],
    ["light", "default"],
  ] as const)("renders a Mermaid diagram with the %s app theme", async (appTheme, mermaidTheme) => {
    const source = "flowchart TD\n  A --> B";
    renderWithTheme(`\`\`\`mermaid\n${source}\n\`\`\``, appTheme);

    const diagram = await screen.findByRole("img", { name: "Diagram" });
    expect(diagram).toHaveTextContent("Rendered diagram");
    expect(diagram).toHaveAccessibleDescription(/flowchart TD A --> B/);
    expect(mermaidInitialize).toHaveBeenLastCalledWith({
      maxTextSize: 50_000,
      securityLevel: "strict",
      startOnLoad: false,
      suppressErrorRendering: true,
      theme: mermaidTheme,
    });
  });

  it("accepts Mermaid output whose HTML labels are not well-formed XML", async () => {
    mermaidRender.mockResolvedValueOnce({
      svg:
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">'
        + '<foreignObject width="10" height="10">'
        + '<div xmlns="http://www.w3.org/1999/xhtml"><span class="nodeLabel"><p>Remove NSP only<br>drops on QNLI&nbsp;MNLI</p></span></div>'
        + "</foreignObject></svg>",
    });

    renderWithTheme('```mermaid\nflowchart TD\n  A["x: y"] --> B["Remove NSP only<br/>drops on QNLI, MNLI"]\n```');

    const diagram = await screen.findByRole("img", { name: "Diagram" });
    expect(diagram.querySelector("svg foreignObject br")).not.toBeNull();
    expect(diagram).toHaveTextContent("Remove NSP only");
    expect(screen.queryByText("Unable to render diagram.")).toBeNull();
  });

  it("shows the raw Mermaid source and an error note when rendering fails", async () => {
    const source = "not a valid diagram";
    mermaidRender.mockRejectedValueOnce(new Error("Parse error"));

    const { container } = renderWithTheme(`\`\`\`mermaid\n${source}\n\`\`\``);

    expect(await screen.findByText("Unable to render diagram.")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Unable to render diagram." })).toBeInTheDocument();
    expect(container.querySelector("code.language-mermaid")).toHaveTextContent(source);
  });

  it("shows a motion-safe Mermaid skeleton and cross-fades in the diagram", async () => {
    let resolveRender: ((value: { svg: string }) => void) | undefined;
    mermaidRender.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRender = resolve;
      }),
    );
    const { container } = renderWithTheme(
      "```mermaid\nflowchart TD\n  A --> B\n```",
    );

    const loader = await screen.findByRole("status", { name: "Rendering diagram" });
    const shell = container.querySelector('[data-mermaid-diagram="true"]');
    expect(shell).toHaveAttribute("data-state", "loading");
    expect(shell).toHaveAttribute("aria-busy", "true");
    expect(loader).toHaveClass("animate-pulse", "motion-reduce:animate-none");

    await act(async () => {
      resolveRender?.({
        svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>Rendered diagram</text></svg>',
      });
    });

    const diagram = await screen.findByRole("img", { name: "Diagram" });
    expect(container.querySelector('[data-mermaid-diagram="true"]')).toBe(shell);
    expect(shell).toHaveAttribute("data-state", "ready");
    expect(shell).toHaveAttribute("aria-busy", "false");
    expect(shell).not.toHaveClass("min-h-28");
    expect(shell?.firstElementChild).toHaveClass("absolute", "inset-0");
    expect(diagram).toHaveClass(
      "transition-opacity",
      "duration-200",
      "motion-reduce:transition-none",
    );
    expect(screen.queryByRole("status", { name: "Rendering diagram" })).toBeNull();
  });

  it("copies fenced code and restores the copy action after feedback", async () => {
    render(<Markdown>{"```typescript\nconst answer = 42;\n```"}</Markdown>);
    const button = await screen.findByRole("button", { name: "Copy code" });
    expect(button).toHaveClass("after:-inset-2");

    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(button);
      await Promise.resolve();
    });

    expect(clipboardWrite).toHaveBeenCalledWith("const answer = 42;");
    expect(button).toHaveAccessibleName("Code copied");

    act(() => vi.advanceTimersByTime(1500));
    expect(button).toHaveAccessibleName("Copy code");
    vi.useRealTimers();
  });

  it("copies the Mermaid source from every diagram state", async () => {
    const source = "flowchart TD\n  A --> B";
    renderWithTheme(`\`\`\`mermaid\n${source}\n\`\`\``);
    const button = await screen.findByRole("button", { name: "Copy diagram source" });

    await act(async () => {
      fireEvent.click(button);
      await Promise.resolve();
    });

    expect(clipboardWrite).toHaveBeenCalledWith(source);
    expect(button).toHaveAccessibleName("Diagram source copied");
  });

  it("adds syntax token markup to a fenced code block", async () => {
    const { container } = render(
      <Markdown>{"```javascript\nconst answer = 42;\n```"}</Markdown>,
    );

    const code = container.querySelector("code.language-javascript");
    expect(code).not.toBeNull();
    await waitFor(() => expect(code?.querySelector(".tok-keyword")).toHaveTextContent("const"));
  });

  it("does not render raw HTML", () => {
    const { container } = render(<Markdown>{"<script>alert('no')</script>"}</Markdown>);

    expect(container.querySelector("script")).toBeNull();
    expect(container).toHaveTextContent("<script>alert('no')</script>");
  });
});
