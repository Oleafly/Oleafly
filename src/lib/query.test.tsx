// @vitest-environment jsdom

import { QueryClientProvider, useMutation, useQuery } from "@tanstack/react-query";
import { act, render, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useToastStore } from "@/store/toast";
import { APP_ERROR_PREFIX } from "./app-error";
import { createAppQueryClient, staleTimes } from "./query";

const logs = vi.hoisted(() => ({ logError: vi.fn(async () => undefined) }));
vi.mock("@/lib/log", () => logs);

function Background() {
  useQuery({
    queryKey: ["background"],
    queryFn: () => Promise.reject(new Error("backend unreachable")),
    retry: false,
  });
  return <p>{"background rendered"}</p>;
}

function Notifying() {
  useQuery({
    queryKey: ["notifying"],
    queryFn: () => Promise.reject(new Error("report failed")),
    retry: false,
    meta: { notify: true },
  });
  return <p>{"notifying rendered"}</p>;
}

function wrapperFor(client: ReturnType<typeof createAppQueryClient>) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe("app query client", () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
    logs.logError.mockClear();
  });

  it("declares per-family stale times", () => {
    expect(staleTimes.catalog).toBeGreaterThan(staleTimes.projects);
    expect(staleTimes.deadlines).toBeGreaterThan(0);
    expect(staleTimes.templates).toBeGreaterThan(0);
  });

  it("logs a failed background query without showing a toast", async () => {
    const client = createAppQueryClient();
    render(
      <QueryClientProvider client={client}>
        <Background />
      </QueryClientProvider>,
    );

    await screen.findByText("background rendered");
    await expect.poll(() => logs.logError.mock.calls.length).toBe(1);
    expect(logs.logError).toHaveBeenCalledWith(
      "query",
      expect.objectContaining({ message: "backend unreachable" }),
    );
    await settle();
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("stays quiet when the same background query fails again", async () => {
    const client = createAppQueryClient();
    render(
      <QueryClientProvider client={client}>
        <Background />
      </QueryClientProvider>,
    );
    await screen.findByText("background rendered");
    await expect.poll(() => logs.logError.mock.calls.length).toBe(1);

    await act(async () => {
      await client.refetchQueries({ queryKey: ["background"] });
    });

    expect(logs.logError).toHaveBeenCalledTimes(2);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("shows one toast for a query that opts in to notifications", async () => {
    const client = createAppQueryClient();
    render(
      <QueryClientProvider client={client}>
        <Notifying />
      </QueryClientProvider>,
    );

    await screen.findByText("notifying rendered");
    await expect
      .poll(() => useToastStore.getState().toasts)
      .toEqual([expect.objectContaining({ kind: "error", message: "report failed" })]);

    await act(async () => {
      await client.refetchQueries({ queryKey: ["notifying"] });
    });

    expect(useToastStore.getState().toasts).toEqual([
      expect.objectContaining({ kind: "error", message: "report failed", count: 2 }),
    ]);
  });

  it("shows a failed mutation with the localized app error text", async () => {
    const client = createAppQueryClient();
    const encoded = `${APP_ERROR_PREFIX}${JSON.stringify({ code: "project.name_empty", params: {}, detail: null })}`;
    const { result } = renderHook(
      () => useMutation({ mutationFn: () => Promise.reject(encoded) }),
      { wrapper: wrapperFor(client) },
    );

    await act(async () => {
      await result.current.mutateAsync().catch(() => undefined);
    });

    expect(logs.logError).toHaveBeenCalledWith("mutation", encoded);
    expect(useToastStore.getState().toasts).toEqual([
      expect.objectContaining({ kind: "error", message: "Project name cannot be empty." }),
    ]);
  });

  it("keeps a mutation marked silent out of the toast stack", async () => {
    const client = createAppQueryClient();
    const { result } = renderHook(
      () =>
        useMutation({
          mutationFn: () => Promise.reject(new Error("refresh failed")),
          meta: { silent: true },
        }),
      { wrapper: wrapperFor(client) },
    );

    await act(async () => {
      await result.current.mutateAsync().catch(() => undefined);
    });

    expect(logs.logError).toHaveBeenCalledWith(
      "mutation",
      expect.objectContaining({ message: "refresh failed" }),
    );
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});
