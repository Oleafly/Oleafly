// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("frimousse", async () => {
  const react = await import("react");
  type Picked = { emoji: string; label: string };
  const SelectContext = react.createContext<(emoji: Picked) => void>(() => undefined);
  const GRINNING = { emoji: "😀", label: "grinning face", isActive: true };
  const ROCKET = { emoji: "🚀", label: "rocket", isActive: false };

  function Root({
    locale,
    emojibaseUrl,
    columns,
    onEmojiSelect,
    children,
    className,
  }: Readonly<{
    locale: string;
    emojibaseUrl: string;
    columns: number;
    onEmojiSelect: (emoji: Picked) => void;
    children: ReactNode;
    className?: string;
  }>) {
    return (
      <SelectContext.Provider value={onEmojiSelect}>
        <div
          data-testid="emoji-root"
          data-locale={locale}
          data-emojibase-url={emojibaseUrl}
          data-columns={columns}
          className={className}
        >
          {children}
        </div>
      </SelectContext.Provider>
    );
  }

  function List({
    components,
  }: Readonly<{
    components: {
      CategoryHeader: (props: { category: { label: string }; "data-index"?: number }) => ReactNode;
      Row: (props: { children: ReactNode; "data-row"?: number }) => ReactNode;
      Emoji: (props: {
        emoji: typeof GRINNING;
        onClick: () => void;
        "data-active"?: string;
      }) => ReactNode;
    };
  }>) {
    const select = react.useContext(SelectContext);
    const { CategoryHeader, Row, Emoji } = components;
    return (
      <div data-testid="emoji-list">
        <CategoryHeader category={{ label: "Smileys" }} data-index={0} />
        <Row data-row={0}>
          <Emoji emoji={GRINNING} data-active="" onClick={() => select(GRINNING)} />
          <Emoji emoji={ROCKET} onClick={() => select(ROCKET)} />
        </Row>
      </div>
    );
  }

  const passthrough = (testId: string) =>
    function Part({ children, className }: Readonly<{ children?: ReactNode; className?: string }>) {
      return (
        <div data-testid={testId} className={className}>
          {children}
        </div>
      );
    };

  return {
    EmojiPicker: {
      Root,
      Search: (props: ComponentProps<"input">) => <input type="search" {...props} />,
      SkinToneSelector: (props: ComponentProps<"button">) => <button type="button" {...props} />,
      Viewport: passthrough("emoji-viewport"),
      Loading: passthrough("emoji-loading"),
      Empty: passthrough("emoji-empty"),
      List,
    },
  };
});

const { default: Grid } = await import("./emoji-grid");

const LABELS = { search: "Find an emoji", skinTone: "Tone", loading: "Fetching", empty: "Nothing here" };

function EmojiGrid(props: Readonly<Omit<ComponentProps<typeof Grid>, "labels" | "locale"> & { locale?: string }>) {
  return <Grid locale="en" labels={LABELS} {...props} />;
}

describe("EmojiGrid", () => {
  it("hands the picked emoji character to the caller", () => {
    const onSelect = vi.fn();
    render(<EmojiGrid onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "🚀" }));
    expect(onSelect).toHaveBeenCalledWith("🚀");
    fireEvent.click(screen.getByRole("button", { name: "😀" }));
    expect(onSelect).toHaveBeenLastCalledWith("😀");
  });

  it("draws category headers, rows and emoji buttons with its own renderers", () => {
    render(<EmojiGrid onSelect={vi.fn()} />);
    const header = screen.getByText("Smileys");
    expect(header).toHaveAttribute("data-index", "0");
    const grinning = screen.getByRole("button", { name: "😀" });
    expect(grinning).toHaveAttribute("type", "button");
    expect(grinning).toHaveAttribute("data-active", "");
    expect(grinning.parentElement).toHaveAttribute("data-row", "0");
  });

  it("marks the current emoji pressed with the caller's class", () => {
    const { rerender } = render(<EmojiGrid selected="🚀" selectedClassName="picked" onSelect={vi.fn()} />);
    const rocket = screen.getByRole("button", { name: "🚀" });
    expect(rocket).toHaveAttribute("aria-pressed", "true");
    expect(rocket).toHaveClass("picked");
    const grinning = screen.getByRole("button", { name: "😀" });
    expect(grinning).toHaveAttribute("aria-pressed", "false");
    rerender(<EmojiGrid onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: "🚀" })).toHaveAttribute("aria-pressed", "false");
  });

  it("labels the search box, the skin tone picker and the loading and empty states from its labels", () => {
    render(<EmojiGrid onSelect={vi.fn()} />);
    const search = screen.getByRole("searchbox", { name: LABELS.search });
    expect(search).toHaveAttribute("placeholder", LABELS.search);
    expect(screen.getByRole("button", { name: LABELS.skinTone })).toBeInTheDocument();
    expect(screen.getByTestId("emoji-loading")).toHaveTextContent(LABELS.loading);
    expect(screen.getByTestId("emoji-empty")).toHaveTextContent(LABELS.empty);
  });

  it("loads emoji data from the bundled emojibase folder in eight columns", () => {
    render(<EmojiGrid onSelect={vi.fn()} />);
    const root = screen.getByTestId("emoji-root");
    expect(root).toHaveAttribute("data-locale", "en");
    expect(root).toHaveAttribute("data-emojibase-url", `${import.meta.env.BASE_URL}emojibase`);
    expect(root).toHaveAttribute("data-columns", "8");
  });

  it("asks for the emojibase locale that matches the app language", () => {
    render(<EmojiGrid locale="zh-Hans" onSelect={vi.fn()} />);
    expect(screen.getByTestId("emoji-root")).toHaveAttribute("data-locale", "zh");
  });
});
