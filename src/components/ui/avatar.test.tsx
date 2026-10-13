// @vitest-environment jsdom

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { Github } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import { Avatar, AvatarStack, avatarHue, type AvatarPerson, type AvatarSize } from "./avatar";

const people: AvatarPerson[] = [
  { id: "a1", name: "Alice Chen" },
  { id: "b2", name: "Bob Smith", imageUrl: "https://avatars.test/bob.png" },
  { id: "c3", name: "Carol" },
  { id: "d4", name: "Dan Ito" },
  { id: "e5", name: "Eve Park" },
  { id: "f6", name: "Femi Ade" },
];

function avatarIn(container: HTMLElement): Element | null {
  return container.querySelector('[data-slot="avatar"]');
}

describe("avatarHue", () => {
  it("keeps the hues the subagent chips already use and stays on the wheel", () => {
    expect(avatarHue("agent-1")).toBe(321);
    expect(avatarHue("agent-2")).toBe(322);
    expect(avatarHue("Alice Chen")).toBe(262);
    expect(avatarHue("")).toBe(0);
    for (const seed of ["x", "😀x", "a much longer seed with spaces"]) {
      const hue = avatarHue(seed);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
      expect(avatarHue(seed)).toBe(hue);
    }
  });
});

describe("Avatar", () => {
  it("shows the picture as a decorative image at the requested size", () => {
    render(<Avatar person={people[1]} size="md" />);
    const image = screen.getByRole("presentation");
    expect(image).toHaveAttribute("src", "https://avatars.test/bob.png");
    expect(image).toHaveAttribute("alt", "");
    expect(image).toHaveAttribute("data-slot", "avatar");
    expect(image).toHaveClass("size-8", "rounded-full", "object-cover");
  });

  it("paints the initials with a hue the caller chose for the person", () => {
    const { container } = render(<Avatar person={{ ...people[0], hue: 17 }} size="sm" />);
    expect(avatarIn(container)).toHaveStyle({ backgroundColor: "hsl(17 55% 45%)" });
  });

  it("falls back to initials on the person's hue when the picture fails", () => {
    const { container } = render(<Avatar person={people[1]} size="sm" />);
    fireEvent.error(screen.getByRole("presentation"));
    expect(screen.queryByRole("presentation")).toBeNull();
    const initials = avatarIn(container);
    expect(initials).toHaveTextContent("BS");
    expect(initials).toHaveAttribute("aria-hidden", "true");
    expect(initials).toHaveStyle({ backgroundColor: `hsl(${avatarHue("b2")} 55% 45%)` });
  });

  it("uses one letter at the smallest size and up to two above it", () => {
    const { container, rerender } = render(<Avatar person={people[0]} size="xs" />);
    expect(avatarIn(container)).toHaveTextContent(/^A$/);
    expect(avatarIn(container)).toHaveClass("size-4", "text-[0.5625rem]", "font-bold", "text-white");
    rerender(<Avatar person={people[0]} size="sm" />);
    expect(avatarIn(container)).toHaveTextContent(/^AC$/);
    expect(avatarIn(container)).toHaveClass("size-5");
    rerender(<Avatar person={people[2]} size="md" />);
    expect(avatarIn(container)).toHaveTextContent(/^C$/);
    expect(avatarIn(container)).toHaveClass("size-8");
  });

  it("has a toolbar size between small and medium that keeps two initials clear of the edge", () => {
    const { container } = render(<Avatar person={people[0]} size="base" />);
    expect(avatarIn(container)).toHaveTextContent(/^[A-Z]{2}$/);
    expect(avatarIn(container)).toHaveClass("size-7", "text-[0.625rem]", "p-1");
  });

  it.each<[AvatarSize, string]>([
    ["xs", "p-0.5"],
    ["sm", "p-0.5"],
    ["base", "p-1"],
    ["md", "p-1.5"],
  ])("pads the %s initials so the letters stay clear of the edge", (size, padding) => {
    const { container } = render(<Avatar person={people[0]} size={size} />);
    expect(avatarIn(container)).toHaveClass(padding, "leading-none");
  });

  it("keeps a surrogate pair whole in an initial", () => {
    const { container } = render(<Avatar person={{ id: "z", name: "😀 Lab" }} size="sm" />);
    expect(avatarIn(container)).toHaveTextContent("😀L");
  });

  it("shows the fallback icon instead of initials when one is given", () => {
    const { container } = render(
      <Avatar person={people[0]} size="md" fallbackIcon={<Github data-testid="mark" />} />,
    );
    const avatar = avatarIn(container);
    expect(avatar).toContainElement(screen.getByTestId("mark"));
    expect(avatar).toHaveClass("size-8", "bg-foreground", "text-background", "[&_svg]:size-4");
    expect(avatar).not.toHaveTextContent("AC");
  });
});

describe("AvatarStack", () => {
  it("shows at most four people and names the rest for screen readers", () => {
    const { container } = render(<AvatarStack people={people} />);
    expect(container.querySelectorAll('[data-slot="avatar"]')).toHaveLength(4);
    for (const person of people.slice(0, 4)) {
      expect(screen.getByText(person.name)).toHaveClass("sr-only");
    }
    expect(screen.queryByText("Eve Park")).toBeNull();
    expect(screen.getByText("+2")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText(enCommon.avatar.more_other.replace("{{count}}", "2"))).toHaveClass("sr-only");
  });

  it("uses the singular label for one hidden person and honours a custom maximum", () => {
    render(<AvatarStack people={people.slice(0, 3)} max={2} />);
    expect(screen.getByText("+1")).toBeInTheDocument();
    expect(screen.getByText(enCommon.avatar.more_one.replace("{{count}}", "1"))).toBeInTheDocument();
  });

  it("separates overlapping avatars with a border colour, never a ring or a shadow", () => {
    const { container } = render(<AvatarStack people={people.slice(0, 3)} size="sm" />);
    const avatars = [...container.querySelectorAll('[data-slot="avatar"]')];
    for (const avatar of avatars) {
      expect(avatar).toHaveClass("border-2", "border-background");
      expect(avatar.className).not.toMatch(/\bring\b|ring-|shadow|outline/);
    }
    expect(avatars[0]?.parentElement).not.toHaveClass("-ml-1.5");
    expect(avatars[1]?.parentElement).toHaveClass("-ml-1.5");
  });

  it("overlaps the small sizes by a quarter of the circle and the toolbar size lightly so two initials stay readable", () => {
    const rem = (token: string) => Number(token) / 4;
    const share = (size: AvatarSize) => {
      const { container, unmount } = render(<AvatarStack people={people.slice(0, 2)} size={size} />);
      const avatar = container.querySelectorAll('[data-slot="avatar"]')[1] as HTMLElement;
      const box = /(?:^|\s)size-([\d.]+)/.exec(avatar.className)?.[1] ?? "0";
      const overlap = /(?:^|\s)-ml-([\d.]+)/.exec(avatar.parentElement?.className ?? "")?.[1] ?? "0";
      unmount();
      return rem(overlap) / rem(box);
    };
    const shares = (["xs", "sm", "md"] as const).map(share);
    for (const value of shares) {
      expect(value).toBeGreaterThanOrEqual(0.25);
      expect(value).toBeLessThanOrEqual(0.32);
    }
    expect(share("base")).toBeLessThanOrEqual(0.15);
  });

  it("sizes and pads the counter like the toolbar avatars it follows", () => {
    const { container } = render(<AvatarStack people={people} size="base" />);
    const avatars = [...container.querySelectorAll('[data-slot="avatar"]')];
    expect(avatars[0]).toHaveClass("size-7", "border-2", "border-background");
    expect(avatars[1]?.parentElement).toHaveClass("-ml-1");
    const more = container.querySelector('[data-slot="avatar-more"]');
    expect(more).toHaveClass("size-7", "text-[0.625rem]", "p-1", "border-2", "border-background", "-ml-1");
    expect(more?.className).not.toMatch(/\bring\b|ring-|shadow|outline/);
  });

  it("adds no counter when everyone fits", () => {
    render(<AvatarStack people={people.slice(0, 2)} />);
    expect(screen.queryByText(/^\+\d+$/)).toBeNull();
  });

  it("keeps the native title when no tooltip is asked for", () => {
    const { container } = render(<AvatarStack people={people.slice(0, 2)} />);
    expect(container.querySelector('[title="Alice Chen"]')).not.toBeNull();
  });

  it("names each avatar for screen readers with a plain label and can show a wide tooltip", () => {
    vi.useFakeTimers();
    try {
      const { container } = render(
        <AvatarStack
          people={people.slice(0, 2)}
          tipWide
          renderTip={(person) => <span data-testid="card">{`${person.name} card`}</span>}
          renderLabel={(person) => `${person.name} label`}
        />,
      );
      expect(screen.getByText("Alice Chen label")).toHaveClass("sr-only");
      expect(screen.queryByTestId("card")).toBeNull();
      const avatars = [...container.querySelectorAll('[data-slot="avatar"]')];
      fireEvent.mouseEnter(avatars[0]?.parentElement as Element);
      act(() => vi.advanceTimersByTime(400));
      const tip = screen.getByRole("tooltip");
      expect(tip).toHaveClass("max-w-xs");
      expect(within(tip).getByTestId("card")).toHaveTextContent("Alice Chen card");
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the app tooltip on each avatar and on the counter, outside any button", () => {
    vi.useFakeTimers();
    try {
      const { container } = render(
        <AvatarStack
          people={people}
          renderTip={(person) => `${person.name} details`}
          renderMoreTip={(hidden) => hidden.map((person) => person.name).join(" and ")}
        />,
      );
      expect(container.querySelector("button")).toBeNull();
      expect(container.querySelector("[title]")).toBeNull();
      expect(screen.getByText("Alice Chen details")).toHaveClass("sr-only");
      expect(screen.getByText("Eve Park and Femi Ade")).toHaveClass("sr-only");
      const avatars = [...container.querySelectorAll('[data-slot="avatar"]')];
      expect(avatars).toHaveLength(4);
      expect(avatars[1]?.closest(".-ml-1\\.5")).not.toBeNull();
      fireEvent.mouseEnter(avatars[1]?.parentElement as Element);
      act(() => vi.advanceTimersByTime(400));
      expect(screen.getByRole("tooltip")).toHaveTextContent("Bob Smith details");
      fireEvent.mouseLeave(avatars[1]?.parentElement as Element);
      const more = container.querySelector('[data-slot="avatar-more"]') as HTMLElement;
      fireEvent.mouseEnter(more.parentElement as Element);
      act(() => vi.advanceTimersByTime(400));
      expect(within(screen.getByRole("tooltip")).getByText("Eve Park and Femi Ade")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("makes an avatar a button only for people with an action, named by the action and described by the label", () => {
    const run = vi.fn();
    const { container } = render(
      <AvatarStack
        people={people.slice(0, 3)}
        renderTip={(person) => `${person.name} details`}
        renderLabel={(person) => `${person.name} label`}
        action={(person) => (person.id === "c3" ? null : { label: `Go to ${person.name}`, run: () => run(person.id) })}
      />,
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual(["Go to Alice Chen", "Go to Bob Smith"]);
    expect(buttons[0]).toHaveAccessibleDescription("Alice Chen label");
    expect(buttons[0]).toHaveAttribute("type", "button");
    expect(buttons[0].querySelector('[data-slot="avatar"]')).toHaveClass("border-2", "group-focus-visible:border-primary");
    expect(buttons[0].className).not.toMatch(/ring|outline|shadow/);
    expect(buttons[1].parentElement).toHaveClass("-ml-1.5");
    fireEvent.click(buttons[1]);
    expect(run).toHaveBeenCalledExactlyOnceWith("b2");
    const carol = [...container.querySelectorAll('[data-slot="avatar"]')][2];
    expect(carol.closest("button")).toBeNull();
    expect(screen.getByText("Carol label")).toHaveClass("sr-only");
  });
});
