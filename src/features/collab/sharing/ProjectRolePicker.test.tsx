// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import { allowRadixSelect } from "../tests/select";
import { GRANTABLE_ROLES, ProjectRolePicker, toGrantableRole } from "./ProjectRolePicker";

beforeAll(async () => {
  allowRadixSelect();
  await loadNamespace("collab");
});

describe("ProjectRolePicker", () => {
  it("grants editor, reviewer, commenter and viewer, never owner", () => {
    expect(GRANTABLE_ROLES).toEqual(["editor", "reviewer", "commenter", "viewer"]);
    expect(toGrantableRole("reviewer")).toBe("reviewer");
    expect(toGrantableRole("commenter")).toBe("commenter");
    expect(toGrantableRole("owner")).toBeNull();
    expect(toGrantableRole("unknown")).toBeNull();
  });

  it("lists every role with a short description and shows only the name once picked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const label = enCollab.manage.add.roleLabel;
    render(<ProjectRolePicker value="editor" label={label} onChange={onChange} />);
    const trigger = screen.getByRole("combobox", { name: label });
    expect(trigger).toHaveTextContent(enCollab.projectRoles.editor);
    expect(trigger).not.toHaveTextContent(enCollab.projectRoleDescriptions.editor);
    await user.click(trigger);
    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(
      GRANTABLE_ROLES.map((role) => `${enCollab.projectRoles[role]}${enCollab.projectRoleDescriptions[role]}`),
    );
    const reviewer = options[1];
    expect(within(reviewer).getByText(enCollab.projectRoleDescriptions.reviewer)).toBeInTheDocument();
    await user.click(reviewer);
    expect(onChange).toHaveBeenCalledWith("reviewer");
  });
});
