// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const current = vi.hoisted(() => vi.fn(() => null));

vi.mock("@/lib/project-intelligence/current", () => ({
  currentProjectIntelligence: current,
}));

import en from "@/i18n/locales/en/editor.json" with { type: "json" };
import { useFilesStore } from "@/store/files";
import { ProjectCitationPicker } from "./ProjectCitationPicker";

afterEach(() => {
  cleanup();
  current.mockClear();
});

describe("ProjectCitationPicker while closed", () => {
  it("leaves the project snapshot alone while the document is edited", () => {
    useFilesStore.setState({
      activePath: "main.tex",
      files: { "main.tex": { content: "a" } },
    } as never);
    render(<ProjectCitationPicker variant="bar" />);

    act(() => {
      useFilesStore.setState({ files: { "main.tex": { content: "ab" } } } as never);
    });
    expect(current).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: en.citations.trigger }));
    expect(current).toHaveBeenCalledWith("ab");
  });
});
