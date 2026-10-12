// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import type { CollabConnectionCheck } from "@/lib/tauri";
import { ConnectionChecks, checkKey, checkStatus } from "./ConnectionChecks";
import { check, fill } from "./tests/fixtures";

const checks = enCollab.section.checks;

beforeAll(async () => {
  await loadNamespace("collab");
});

function row(key: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-check="${key}"]`);
  if (!element) throw new Error(`no row for ${key}`);
  return element;
}

describe("ConnectionChecks", () => {
  it("gives every check an icon, a status word and a plain sentence", () => {
    render(
      <ConnectionChecks
        checks={[
          check("reachable", "pass"),
          check("https", "fail", "invalid peer certificate: Expired"),
          check("protocol", "pass", "1"),
          check("websocket", "skipped"),
          check("sign_in_providers", "pass", "GitHub, University login"),
          check("email", "info", "not_configured"),
          check("clock", "fail", "-312"),
        ]}
      />,
    );
    expect(screen.getByRole("heading", { name: checks.title })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(7);
    expect(row("reachable")).toHaveTextContent(`${checks.items.reachable.label} · ${checks.status.pass}`);
    expect(row("reachable")).toHaveTextContent(checks.items.reachable.pass);
    expect(row("reachable").querySelector('[data-slot="check-badge"]')).not.toBeNull();
    expect(row("https")).toHaveTextContent(`${checks.items.https.label} · ${checks.status.fail}`);
    expect(row("https")).toHaveTextContent(checks.items.https.fail);
    expect(row("https")).toHaveTextContent("invalid peer certificate: Expired");
    expect(row("protocol").textContent).not.toMatch(/\d/);
    expect(row("webSocket")).toHaveTextContent(`${checks.items.webSocket.label} · ${checks.status.skipped}`);
    expect(row("signInProviders")).toHaveTextContent("GitHub, University login");
    expect(row("email")).toHaveTextContent(checks.items.email.info);
    expect(row("email")).not.toHaveTextContent("not_configured");
    expect(row("clock")).toHaveTextContent(checks.items.clock.fail);
    expect(row("clock")).toHaveTextContent(fill(checks.clockSkew, { seconds: "312" }));
    for (const item of screen.getAllByRole("listitem")) {
      expect(item.querySelector("svg, [data-slot='check-badge']")).not.toBeNull();
    }
  });

  it("turns detail codes into words instead of showing them", () => {
    render(
      <ConnectionChecks
        checks={[
          check("https", "info", "loopback"),
          check("protocol", "fail", "client_too_old"),
          check("email", "info", "configured"),
        ]}
      />,
    );
    expect(row("https")).toHaveTextContent(checks.items.https.info);
    expect(row("https")).not.toHaveTextContent("loopback");
    expect(row("protocol")).toHaveTextContent(enCollab.errors.client_too_old);
    expect(row("protocol")).not.toHaveTextContent("client_too_old");
    expect(row("email")).toHaveTextContent(`${checks.items.email.label} · ${checks.status.info}`);
    expect(row("email")).toHaveTextContent(checks.items.email.pass);
  });

  it("says when live edits take the slower route instead of calling the check a failure", () => {
    render(<ConnectionChecks checks={[check("websocket", "info", "fallback")]} />);
    expect(row("webSocket")).toHaveAttribute("data-status", "info");
    expect(row("webSocket").textContent).toBe(
      `${checks.items.webSocket.label} · ${checks.status.info}${checks.items.webSocket.info}`,
    );
  });

  it("leaves out checks it does not know and reads an unknown status as a note", () => {
    const unknown = { id: "future_check", status: "pass", detail: null } as unknown as CollabConnectionCheck;
    const odd = { id: "clock", status: "unsure", detail: null } as unknown as CollabConnectionCheck;
    render(<ConnectionChecks checks={[unknown, odd]} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(row("clock")).toHaveAttribute("data-status", "info");
    expect(checkKey("websocket")).toBe("webSocket");
    expect(checkKey("web_socket")).toBeNull();
    expect(checkKey("toString")).toBeNull();
    expect(checkStatus("skipped")).toBe("skipped");
  });
});
