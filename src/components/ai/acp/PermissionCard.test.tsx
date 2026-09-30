// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AcpPermission } from "@/lib/acp";
import { resetDisplayHomes, setDisplayHomes } from "@/lib/display-path";
import { PermissionCard } from "./PermissionCard";

const MAIN = "/Users/ada/.oleafly/projects/p/main.tex";

function permission(overrides: Partial<AcpPermission> = {}): AcpPermission {
  return {
    id: "request-1",
    sessionId: "session-1",
    turnId: "turn-1",
    title: `Edit ${MAIN}`,
    toolCallId: "tool-1",
    options: [{ optionId: "allow-once", name: "Allow once", kind: "allow_once" }],
    expiresAt: Date.now() + 60_000,
    ...overrides,
  };
}

describe("PermissionCard", () => {
  afterEach(() => resetDisplayHomes());

  it("shows a home path in the agent's request as ~ and still answers by id", () => {
    setDisplayHomes(["/Users/ada"]);
    const onChoose = vi.fn(async () => {});
    const { container } = render(<PermissionCard request={permission()} onChoose={onChoose} />);

    expect(screen.getByText("Edit ~/.oleafly/projects/p/main.tex")).toBeInTheDocument();
    expect(container.textContent).not.toContain("/Users/ada");

    fireEvent.click(screen.getByRole("button", { name: /Allow once/ }));
    expect(onChoose).toHaveBeenCalledWith("request-1", "allow-once");
  });
});
