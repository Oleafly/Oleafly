// @vitest-environment jsdom

import { act, render, screen } from "@testing-library/react";
import { BACKEND_CAPABILITIES, PROTOCOL_VERSION } from "@oleafly/backend-port";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { backendProtocolInfo } from "@/lib/tauri";
import { BackendProtocolBanner } from "./BackendProtocolBanner";

vi.mock("@/lib/tauri", () => ({
  backendProtocolInfo: vi.fn(),
}));

const mockInfo = vi.mocked(backendProtocolInfo);

const flush = () => act(() => Promise.resolve());

describe("BackendProtocolBanner", () => {
  beforeEach(() => {
    mockInfo.mockReset();
  });

  it("stays hidden when the backend matches the contract", async () => {
    mockInfo.mockResolvedValue({
      protocol_version: PROTOCOL_VERSION,
      capabilities: [...BACKEND_CAPABILITIES],
    });

    render(<BackendProtocolBanner />);
    await flush();

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the degradation banner on a protocol version mismatch", async () => {
    mockInfo.mockResolvedValue({
      protocol_version: PROTOCOL_VERSION + 1,
      capabilities: [],
    });

    render(<BackendProtocolBanner />);
    await flush();

    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("rejects the previous backend contract even when it reports a capability superset", async () => {
    mockInfo.mockResolvedValue({
      protocol_version: 2,
      capabilities: [...BACKEND_CAPABILITIES, "future-capability"],
    });

    render(<BackendProtocolBanner />);
    await flush();

    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("shows the banner when the backend lacks a required capability", async () => {
    mockInfo.mockResolvedValue({
      protocol_version: PROTOCOL_VERSION,
      capabilities: ["compile"],
    });

    render(<BackendProtocolBanner />);
    await flush();

    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("stays hidden when the backend cannot be queried", async () => {
    mockInfo.mockRejectedValue(new Error("no tauri runtime"));

    render(<BackendProtocolBanner />);
    await flush();

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
