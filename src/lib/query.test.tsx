// @vitest-environment jsdom

import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useToastStore } from "@/store/toast";
import { createAppQueryClient, staleTimes } from "./query";

function Failing() {
  useQuery({
    queryKey: ["exploding"],
    queryFn: () => Promise.reject(new Error("backend unreachable")),
    retry: false,
  });
  return <p>rendered</p>;
}

function Silent() {
  useQuery({
    queryKey: ["quiet"],
    queryFn: () => Promise.reject(new Error("background sync failed")),
    retry: false,
    meta: { silent: true },
  });
  return <p>silent rendered</p>;
}

describe("app query client", () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
  });

  it("declares per-family stale times", () => {
    expect(staleTimes.catalog).toBeGreaterThan(staleTimes.projects);
    expect(staleTimes.deadlines).toBeGreaterThan(0);
    expect(staleTimes.templates).toBeGreaterThan(0);
  });

  it("surfaces query failures as an error toast", async () => {
    const client = createAppQueryClient();
    render(
      <QueryClientProvider client={client}>
        <Failing />
      </QueryClientProvider>,
    );

    await screen.findByText("rendered");
    await expect
      .poll(() => useToastStore.getState().toasts)
      .toContainEqual(
        expect.objectContaining({
          kind: "error",
          message: expect.stringContaining("backend unreachable"),
        }),
      );
  });

  it("keeps queries marked silent out of the toast stack", async () => {
    const client = createAppQueryClient();
    render(
      <QueryClientProvider client={client}>
        <Silent />
      </QueryClientProvider>,
    );

    await screen.findByText("silent rendered");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});
