// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import { formatBytes } from "@/lib/format-bytes";
import { formatDateTime } from "@/lib/intl";
import { fill, runtimeSettings } from "../tests/fixtures";
import { OverviewSection } from "./OverviewSection";
import { STARTED, overview } from "./tests/fixtures";

const copy = enCollab.console.overview;

beforeAll(async () => {
  await loadNamespace("collab");
});

function stat(id: string): HTMLElement {
  const tile = document.querySelector<HTMLElement>(`[data-stat="${id}"]`);
  if (!tile) throw new Error(`no ${id} figure`);
  return tile;
}

function renderReady(props: Partial<Parameters<typeof OverviewSection>[0]> = {}) {
  const onNavigate = vi.fn();
  const onRetry = vi.fn();
  render(
    <OverviewSection
      state={{ status: "ready", overview: overview() }}
      onNavigate={onNavigate}
      onRetry={onRetry}
      {...props}
    />,
  );
  return { onNavigate, onRetry };
}

describe("OverviewSection", () => {
  it("shows the server's numbers at a glance", () => {
    renderReady();
    expect(within(stat("people")).getByText("12")).toBeInTheDocument();
    expect(within(stat("people")).getByText(fill(copy.glance.suspended, { number: "1" }))).toBeInTheDocument();
    expect(within(stat("devices")).getByText("20")).toBeInTheDocument();
    expect(within(stat("projects")).getByText("7")).toBeInTheDocument();
    expect(
      within(stat("projects")).getByText(fill(copy.glance.projectsDetail, { archived: "2", pending: "1" })),
    ).toBeInTheDocument();
    expect(within(stat("online")).getByText("3")).toBeInTheDocument();
    expect(within(stat("online")).getByText(fill(copy.glance.onlineDetail, { number: "2" }))).toBeInTheDocument();
    expect(within(stat("started")).getByText("3 days ago")).toBeInTheDocument();
    expect(within(stat("started")).getByText(formatDateTime(STARTED))).toBeInTheDocument();
    expect(within(stat("version")).getByText("0.1.0")).toBeInTheDocument();
    expect(within(stat("version")).getByText(fill(copy.glance.protocol, { protocol: "1" }))).toBeInTheDocument();
  });

  it("leaves out the suspended line when nobody is suspended", () => {
    const quiet = overview();
    quiet.counts = { ...quiet.counts, suspended_people: 0 };
    renderReady({ state: { status: "ready", overview: quiet } });
    expect(stat("people").querySelectorAll("dd")).toHaveLength(1);
  });

  it("names guest invitations waiting for approval and leads to People", async () => {
    const waiting = overview();
    waiting.counts = { ...waiting.counts, pending_guest_approvals: 2 };
    const { onNavigate } = renderReady({ state: { status: "ready", overview: waiting } });
    const row = screen.getByTestId("console-pending-guests");
    expect(row).toHaveTextContent(fill(copy.glance.pendingGuests, { number: "2" }));
    await userEvent.setup().click(within(row).getByRole("button", { name: copy.glance.reviewGuests }));
    expect(onNavigate).toHaveBeenCalledWith("people");
  });

  it("says nothing about guest approvals when none are waiting", () => {
    renderReady();
    expect(screen.queryByTestId("console-pending-guests")).toBeNull();
  });

  it("shows storage use to admins with where the files live", () => {
    renderReady();
    expect(within(stat("database")).getByText(formatBytes(4096))).toBeInTheDocument();
    expect(within(stat("snapshots")).getByText(formatBytes(3 * 1024 * 1024))).toBeInTheDocument();
    expect(within(stat("files")).getByText(formatBytes(1536))).toBeInTheDocument();
    expect(within(stat("files")).getByText(copy.storage.location.disk)).toBeInTheDocument();
    expect(screen.queryByText(copy.storage.adminOnly)).not.toBeInTheDocument();
  });

  it.each([
    ["s3", copy.storage.location.s3],
    ["unknown", copy.storage.location.unknown],
  ] as const)("names %s storage", (location, label) => {
    const elsewhere = overview();
    elsewhere.storage = { database_bytes: 1, snapshot_bytes: 1, file_bytes: 1, files_location: location };
    renderReady({ state: { status: "ready", overview: elsewhere } });
    expect(within(stat("files")).getByText(label)).toBeInTheDocument();
  });

  it("tells maintainers that storage is for admins", () => {
    renderReady({ state: { status: "ready", overview: overview({ storage: null }) } });
    expect(screen.getByText(copy.storage.adminOnly)).toBeInTheDocument();
    expect(document.querySelector('[data-stat="database"]')).toBeNull();
  });

  it("says when everything is working", () => {
    renderReady();
    expect(screen.getByText(copy.health.okLabel)).toBeInTheDocument();
    expect(screen.getByText(copy.health.okDescription)).toBeInTheDocument();
  });

  it("lists each problem with what to do about it", () => {
    renderReady({
      state: {
        status: "ready",
        overview: overview({
          health: {
            status: "warning",
            issues: ["no_sign_in_provider", "storage_not_writable", "sign_in_failing", "sign_in_emails_paused", "unknown"],
          },
        }),
      },
    });
    for (const issue of Object.values(copy.health.issues)) {
      expect(screen.getByText(issue.label)).toBeInTheDocument();
      expect(screen.getByText(issue.description)).toBeInTheDocument();
    }
    expect(screen.queryByText(copy.health.okLabel)).not.toBeInTheDocument();
  });

  it("says which sign-in option is failing and since when, in the provider's own words", () => {
    const since = STARTED + 3_600_000;
    renderReady({
      state: {
        status: "ready",
        overview: overview({
          health: { status: "warning", issues: ["sign_in_failing", "sign_in_emails_paused"] },
          providers: [
            { id: "github", kind: "github", label: "GitHub" },
            { id: "uni", kind: "oidc", label: "University sign-in" },
          ],
          sign_in_problems: [
            { provider: "uni", at: since, reason: "unauthorized_client: The client is not allowed." },
            { provider: "gone", at: since, reason: "" },
          ],
        }),
      },
    });
    expect(screen.getByText(copy.health.issues.signInFailing.label)).toBeInTheDocument();
    expect(screen.getByText(copy.health.issues.signInEmailsPaused.description)).toBeInTheDocument();
    const problems = screen.getByTestId("console-sign-in-problems");
    expect(problems).toHaveTextContent(
      fill(copy.health.problem, { provider: "University sign-in", time: formatDateTime(since) }),
    );
    expect(problems).toHaveTextContent("unauthorized_client: The client is not allowed.");
    expect(problems).toHaveTextContent(fill(copy.health.problem, { provider: "gone", time: formatDateTime(since) }));
  });

  it("reads a problem a newer server reports as a general problem", () => {
    const later = overview({ health: { status: "warning", issues: ["disk_full" as never] } });
    renderReady({ state: { status: "ready", overview: later } });
    expect(screen.getByText(copy.health.issues.unknown.label)).toBeInTheDocument();
  });

  it("shows email and sign-in status and opens the email section", async () => {
    const { onNavigate } = renderReady({
      state: {
        status: "ready",
        overview: overview({
          email_configured: true,
          providers: [
            { id: "github", kind: "github", label: "GitHub" },
            { id: "uni", kind: "oidc", label: "University SSO" },
          ],
        }),
      },
    });
    expect(screen.getByText(copy.services.emailOn)).toBeInTheDocument();
    expect(screen.getByText(copy.services.emailOnDescription)).toBeInTheDocument();
    expect(screen.getByText("GitHub and University SSO")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: copy.services.openEmail }));
    expect(onNavigate).toHaveBeenCalledWith("email");
  });

  it("names sign-in by email link among the sign-in options", () => {
    renderReady({
      state: {
        status: "ready",
        overview: overview({
          email_configured: true,
          providers: [
            { id: "github", kind: "github", label: "GitHub" },
            { id: "email-link", kind: "email_link", label: "Email" },
          ],
        }),
      },
    });
    expect(screen.getByText(`GitHub and ${copy.services.emailLinkOption}`)).toBeInTheDocument();
    expect(screen.queryByText(copy.services.signInNone)).not.toBeInTheDocument();
  });

  it("says when email and sign-in are missing", () => {
    renderReady({ state: { status: "ready", overview: overview({ providers: [] }) } });
    expect(screen.getByText(copy.services.emailOff)).toBeInTheDocument();
    expect(screen.getByText(copy.services.emailOffDescription)).toBeInTheDocument();
    expect(screen.getByText(copy.services.signInNone)).toBeInTheDocument();
  });

  it("summarises the server settings and links to them", async () => {
    const { onNavigate } = renderReady({
      state: {
        status: "ready",
        overview: overview({ settings: runtimeSettings({ link_sharing_allowed: false }) }),
      },
    });
    const sharing = screen.getByTestId("console-setting-link_sharing_allowed");
    expect(within(sharing).getByText(enCollab.admin.settings.linkSharingAllowed.label)).toBeInTheDocument();
    expect(within(sharing).getByText(copy.settings.off)).toBeInTheDocument();
    const directory = screen.getByTestId("console-setting-directory_visible");
    expect(within(directory).getByText(copy.settings.on)).toBeInTheDocument();
    expect(
      screen.getByText(fill(copy.limits, { project: "200 MB", file: "50 MB", people: "20" })),
    ).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: copy.settings.change }));
    expect(onNavigate).toHaveBeenCalledWith("settings");
  });

  it("shows progress while loading", () => {
    renderReady({ state: { status: "loading" } });
    expect(screen.getByText(copy.loading)).toBeInTheDocument();
  });

  it("explains a failure and tries again", async () => {
    const { onRetry } = renderReady({ state: { status: "failed", code: "unreachable" } });
    expect(screen.getByText(enCollab.admin.loadFailed)).toBeInTheDocument();
    expect(screen.getByText(enCollab.errors.unreachable)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: enCommon.actions.retry }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
