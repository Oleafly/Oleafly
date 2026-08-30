// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@/lib/theme";
import { Markdown } from "./markdown";

const mermaidInitialize = vi.hoisted(() => vi.fn());
const mermaidRender = vi.hoisted(() => vi.fn());

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
    mermaidInitialize.mockClear();
    mermaidRender.mockReset();
    mermaidRender.mockResolvedValue({
      svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>Rendered diagram</text></svg>',
    });
  });

  it("renders inline math with KaTeX markup", async () => {
    const { container } = render(<Markdown>{"The result is $x^2$."}</Markdown>);

    await waitFor(() => expect(container.querySelector(".katex")).not.toBeNull());
  });

  it("allows wide display math to scroll horizontally", async () => {
    const { container } = render(
      <Markdown>{"$$\n\\sum_{i=1}^{100} x_i^2 = x_1^2 + \\cdots + x_{100}^2\n$$"}</Markdown>,
    );

    await waitFor(() => expect(container.querySelector(".katex-display")).not.toBeNull());
    expect(container.firstElementChild).toHaveClass(
      "[&_.katex-display]:overflow-x-auto",
      "[&_.katex-display]:overflow-y-hidden",
    );
  });

  it("keeps malformed math source visible without throwing", async () => {
    const source = String.raw`\frac{`;
    const { container } = render(<Markdown>{`$${source}$`}</Markdown>);

    await waitFor(() =>
      expect(container.querySelector(".katex-error")).toHaveTextContent(source)
    );
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

  it("shows the raw Mermaid source and an error note when rendering fails", async () => {
    const source = "not a valid diagram";
    mermaidRender.mockRejectedValueOnce(new Error("Parse error"));

    const { container } = renderWithTheme(`\`\`\`mermaid\n${source}\n\`\`\``);

    expect(await screen.findByText("Unable to render diagram.")).toBeInTheDocument();
    expect(container.querySelector("code.language-mermaid")).toHaveTextContent(source);
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
