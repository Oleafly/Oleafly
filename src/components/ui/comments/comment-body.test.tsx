// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import { loadMathRender } from "@oleafly/editor/math-render-loader";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommentBody } from "./comment-body";
import { type CommentKit, CommentKitProvider } from "./comment-kit";

const loader = vi.hoisted(() => ({ fail: false }));

vi.mock("@oleafly/editor/math-render-loader", async (importOriginal) => {
  const real = await importOriginal<typeof import("@oleafly/editor/math-render-loader")>();
  return {
    ...real,
    loadedMathRender: () => (loader.fail ? null : real.loadedMathRender()),
    loadMathRender: () => (loader.fail ? Promise.reject(new Error("math chunk gone")) : real.loadMathRender()),
  };
});

afterEach(() => {
  loader.fail = false;
});

const NO_MEMBERS: never[] = [];

describe("math in a comment body", () => {
  it("draws inline and display math with KaTeX once math is on", async () => {
    const { container } = render(<CommentBody body={String.raw`Try $x^2$ then $$\frac{a}{b}$$`} members={NO_MEMBERS} math />);
    await waitFor(() => expect(container.querySelectorAll("[data-comment-math] .katex")).toHaveLength(2));
    expect(container.querySelector('[data-comment-math="inline"]')).not.toBeNull();
    expect(container.querySelector('[data-comment-math="display"] .katex-display')).not.toBeNull();
    expect(container.querySelector("[data-comment-body]")).toHaveTextContent(/^Try/u);
  });

  it("shows math as written while math is off", () => {
    const { container } = render(<CommentBody body="Try $x^2$" members={NO_MEMBERS} />);
    expect(screen.getByText("Try $x^2$")).toBeInTheDocument();
    expect(container.querySelector("[data-comment-math], [data-comment-math-source]")).toBeNull();
  });

  it("keeps math KaTeX can't read as its source text", async () => {
    await loadMathRender();
    const { container } = render(<CommentBody body={String.raw`Broken $\frac{1}{$ here and $\notacommand$`} members={NO_MEMBERS} math />);
    expect(container.querySelectorAll("[data-comment-math-source]")).toHaveLength(2);
    expect(container.querySelector("[data-comment-math]")).toBeNull();
    expect(container.querySelector("[data-comment-body]")).toHaveTextContent(String.raw`Broken $\frac{1}{$ here and $\notacommand$`);
  });

  it("shows Markdown marks as written when Markdown is off, with links and math still drawn", async () => {
    const { container } = render(
      <CommentBody body={"**Look** at https://x.org/p and $x^2$\n- not a list"} members={NO_MEMBERS} math markdown={false} />,
    );
    await waitFor(() => expect(container.querySelector("[data-comment-math] .katex")).not.toBeNull());
    expect(container.querySelector("strong, em, code, ul, ol")).toBeNull();
    expect(screen.getByRole("link", { name: "https://x.org/p" })).toHaveAttribute("href", "https://x.org/p");
    expect(container.querySelector("[data-comment-body]")).toHaveTextContent("**Look** at");
    expect(container.querySelector("[data-comment-body]")).toHaveTextContent("- not a list");
  });

  it("draws whole environments, numbered ones without a number and ones KaTeX lacks from their body", async () => {
    const body = String.raw`See \begin{equation}x=1\end{equation} and \begin{eqnarray}a&=&b\end{eqnarray} and \begin{displaymath}y\end{displaymath}`;
    const { container } = render(<CommentBody body={body} members={NO_MEMBERS} math />);
    await waitFor(() => expect(container.querySelectorAll('[data-comment-math="display"] .katex')).toHaveLength(3));
    expect(container.querySelector("[data-comment-math-source]")).toBeNull();
    expect(container.querySelector(".eqn-num, .tag")).toBeNull();
  });

  it("tells the host when the math renderer can't load and keeps the source", async () => {
    loader.fail = true;
    const reportError = vi.fn();
    const { container } = render(
      <CommentKitProvider value={{ reportError } as Partial<CommentKit> as CommentKit}>
        <CommentBody body="Try $x^2$" members={NO_MEMBERS} math />
      </CommentKitProvider>,
    );
    await waitFor(() => expect(reportError).toHaveBeenCalledExactlyOnceWith("comment math load", expect.any(Error)));
    expect(container.querySelector("[data-comment-math-source]")).toHaveTextContent("$x^2$");
  });

  it("never turns markup or links written inside math into elements", async () => {
    const body = String.raw`$\text{<img src=x onerror=alert(1)>}$ and $\href{javascript:alert(1)}{x}$ and $\htmlId{a}{b}$`;
    const { container } = render(<CommentBody body={body} members={NO_MEMBERS} math />);
    await waitFor(() => expect(container.querySelector("[data-comment-math]")).not.toBeNull());
    expect(container.querySelector("img, a, script, [onerror], [id='a']")).toBeNull();
    expect(container.querySelector("[data-comment-math]")).toHaveTextContent("<img src=x onerror=alert(1)>");
  });
});
