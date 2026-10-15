// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import { BOB, projectSummary, server } from "../tests/fixtures";
import { JoinLinkDialog } from "./JoinLinkDialog";

const copy = enCollab.links.confirm;

function fact(label: string): HTMLElement {
  return within(screen.getByRole("dialog", { name: copy.title }))
    .getByText(label, { selector: "dt" })
    .nextElementSibling as HTMLElement;
}

beforeAll(async () => {
  await loadNamespace("collab");
});

describe("JoinLinkDialog", () => {
  it("names an unnamed server by its address once and an owner without contact details by name only", () => {
    render(
      <JoinLinkDialog
        server={server({ name: "" })}
        project={projectSummary({ title: "Reef survey", owner: { ...BOB, email: null, login: null }, role: "viewer" })}
        onAnswer={vi.fn()}
      />,
    );
    expect(fact(copy.server).textContent).toBe("https://collab.uni.edu");
    expect(fact(copy.owner).textContent).toBe("Bob Smith");
    expect(fact(copy.role)).toHaveTextContent(enCollab.projectRoles.viewer);
  });

  it("says when the owner was removed from the server or suspended on it", () => {
    const { unmount } = render(
      <JoinLinkDialog server={server()} project={projectSummary({ owner: { ...BOB, active: false } })} onAnswer={vi.fn()} />,
    );
    expect(fact(copy.owner)).toHaveTextContent(`Bob Smith${BOB.email}${enCollab.manage.inactive}`);
    unmount();
    render(<JoinLinkDialog server={server()} project={projectSummary()} onAnswer={vi.fn()} />);
    expect(fact(copy.owner)).not.toHaveTextContent(enCollab.manage.inactive);
  });

  it("answers no from Cancel and the close button, and yes from Join", async () => {
    const user = userEvent.setup();
    const onAnswer = vi.fn();
    render(<JoinLinkDialog server={server()} project={projectSummary()} onAnswer={onAnswer} />);
    await user.click(screen.getByRole("button", { name: enCommon.actions.cancel }));
    await user.click(screen.getAllByRole("button", { name: enCommon.actions.close })[0]);
    await user.click(screen.getByRole("button", { name: copy.join }));
    expect(onAnswer.mock.calls).toEqual([[false], [false], [true]]);
  });
});
