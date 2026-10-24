// @vitest-environment jsdom
import { useState, type ComponentProps } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enResearchTools from "@/i18n/locales/en/researchTools.json" with { type: "json" };
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import { DESKTOP_APPS_STATUS_KEY } from "@/components/settings/desktop-apps/desktop-apps-queries";
import type { DesktopAppsStatus } from "@/lib/desktop-apps";
import type { ResearchBrief } from "@/lib/research-tasks";
import { briefFixture } from "../tests/task-fixtures";

// The connector status comes from the query cache in these tests; never from the system.
vi.mock("@/lib/desktop-apps", () => ({
  cuaDriverStatus: vi.fn(() => new Promise(() => undefined)),
  cuaDriverInstalledApps: vi.fn(async () => []),
}));

import {
  BriefFields,
  briefErrors,
  durationLabel,
  localDateTime,
  parseLocalDateTime,
  startError,
  TIME_BUDGET_OPTIONS,
  upcomingStart,
} from "./BriefFields";
import { useSettingsStore } from "@/store/settings";

const copy = enResearchTools.brief;
const desktopApps = enSettings.integrations.desktopApps.task;

type Props = ComponentProps<typeof BriefFields>;

interface HarnessProps {
  initial?: ResearchBrief;
  initialRunAfter?: number | null;
  backgroundEnabled?: boolean;
  disabled?: boolean;
  computeTargets?: Props["computeTargets"];
  renderCompute?: Props["renderCompute"];
  computeProblem?: boolean;
  onBrief?: (brief: ResearchBrief) => void;
  onRunAfter?: (runAfter: number | null) => void;
  onKeepRunning?: (keep: boolean) => void;
}

/** Holds the brief the way the task composer does. */
function Harness({
  initial = briefFixture(),
  initialRunAfter = null,
  backgroundEnabled = false,
  disabled,
  computeTargets,
  renderCompute,
  computeProblem,
  onBrief = () => {},
  onRunAfter = () => {},
  onKeepRunning = () => {},
}: Readonly<HarnessProps>) {
  const [brief, setBrief] = useState(initial);
  const [runAfter, setRunAfter] = useState<number | null>(initialRunAfter);
  const [keep, setKeep] = useState(false);
  return (
    <BriefFields
      brief={brief}
      onChange={(next) => {
        setBrief(next);
        onBrief(next);
      }}
      runAfter={runAfter}
      onRunAfterChange={(next) => {
        setRunAfter(next);
        onRunAfter(next);
      }}
      keepRunning={keep}
      onKeepRunningChange={(next) => {
        setKeep(next);
        onKeepRunning(next);
      }}
      backgroundEnabled={backgroundEnabled}
      disabled={disabled}
      computeTargets={computeTargets}
      renderCompute={renderCompute}
      computeProblem={computeProblem}
    />
  );
}

function openBrief() {
  fireEvent.click(screen.getByTestId("research-brief-more"));
}

async function choose(trigger: HTMLElement, option: string) {
  const user = userEvent.setup();
  await user.click(trigger);
  await user.click(await screen.findByRole("option", { name: option }));
}

const last = (mock: ReturnType<typeof vi.fn>) => mock.mock.calls.at(-1)?.[0] as ResearchBrief;

describe("BriefFields", () => {
  beforeEach(() => {
    Element.prototype.hasPointerCapture = vi.fn(() => false);
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("shows the goal and success criteria and keeps the rest folded", () => {
    render(<Harness initial={briefFixture({ goal: "Lower the loss", successCriteria: ["val_loss < 0.4", "No new warnings"] })} />);

    expect(screen.getByLabelText(copy.goalLabel)).toHaveValue("Lower the loss");
    expect(screen.getByLabelText(copy.goalLabel)).toHaveAttribute("placeholder", copy.goalPlaceholder);
    expect(screen.getByLabelText(copy.criteriaLabel)).toHaveValue("val_loss < 0.4\nNo new warnings");
    expect(screen.getByText(copy.criteriaHint)).toBeInTheDocument();
    const toggle = screen.getByTestId("research-brief-more");
    expect(toggle).toHaveTextContent(copy.title);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText(copy.scopeLabel)).toBeNull();

    openBrief();
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText(copy.scopeLabel)).toBeInTheDocument();
    openBrief();
    expect(screen.queryByLabelText(copy.scopeLabel)).toBeNull();
  });

  it("splits success criteria into trimmed lines, at most twelve of up to 500 characters", () => {
    const onBrief = vi.fn();
    render(<Harness onBrief={onBrief} />);
    const lines = ["  first check  ", "", "second check", ...Array.from({ length: 12 }, (_, index) => `extra ${index}`)];
    lines[3] = "x".repeat(600);

    fireEvent.change(screen.getByLabelText(copy.criteriaLabel), { target: { value: lines.join("\n") } });

    const criteria = last(onBrief).successCriteria;
    expect(criteria).toHaveLength(12);
    expect(criteria[0]).toBe("first check");
    expect(criteria[1]).toBe("second check");
    expect(criteria[2]).toHaveLength(500);
    expect(criteria.at(-1)).toBe("extra 9");
    // The box keeps what the user typed, blank lines and spaces included.
    expect(screen.getByLabelText(copy.criteriaLabel)).toHaveValue(lines.join("\n"));
  });

  it("edits the goal, scope and constraints", () => {
    const onBrief = vi.fn();
    render(<Harness onBrief={onBrief} />);
    fireEvent.change(screen.getByLabelText(copy.goalLabel), { target: { value: "Find out why" } });
    openBrief();
    fireEvent.change(screen.getByLabelText(copy.scopeLabel), { target: { value: "Only chapter 3" } });
    fireEvent.change(screen.getByLabelText(copy.constraintsLabel), { target: { value: "No new data" } });

    expect(last(onBrief)).toMatchObject({ goal: "Find out why", scope: "Only chapter 3", constraints: "No new data" });
  });

  it("validates the metric name and keeps its goal", async () => {
    const onBrief = vi.fn();
    render(<Harness onBrief={onBrief} />);
    openBrief();
    const metric = screen.getByRole("textbox", { name: copy.metricLabel });
    const goal = screen.getByRole("combobox", { name: copy.metricLabel });
    expect(metric).toHaveAttribute("placeholder", copy.metricPlaceholder);
    expect(goal).toBeDisabled();

    fireEvent.change(metric, { target: { value: "a b" } });
    expect(screen.getByText(copy.invalidMetric)).toBeInTheDocument();
    expect(metric).toHaveAttribute("aria-invalid", "true");

    fireEvent.change(metric, { target: { value: " val_loss " } });
    expect(screen.queryByText(copy.invalidMetric)).toBeNull();
    expect(metric).toHaveAttribute("aria-invalid", "false");
    expect(last(onBrief).primaryMetric).toEqual({ name: "val_loss", goal: "minimize" });
    expect(goal).toBeEnabled();
    expect(goal).toHaveTextContent(copy.metricMinimize);

    await choose(goal, copy.metricMaximize);
    expect(last(onBrief).primaryMetric).toEqual({ name: "val_loss", goal: "maximize" });

    fireEvent.change(metric, { target: { value: "val_acc" } });
    expect(last(onBrief).primaryMetric).toEqual({ name: "val_acc", goal: "maximize" });

    fireEvent.change(metric, { target: { value: "  " } });
    expect(last(onBrief).primaryMetric).toBeNull();
    expect(goal).toBeDisabled();
  });

  it("checks the cost and run limits as they are typed", () => {
    const onBrief = vi.fn();
    render(<Harness onBrief={onBrief} />);
    openBrief();
    const cost = screen.getByLabelText(copy.costLabel);
    const runs = screen.getByLabelText(copy.runsLabel);
    expect(cost).toHaveAttribute("placeholder", copy.noLimit);
    expect(runs).toHaveAttribute("placeholder", copy.noLimit);

    fireEvent.change(cost, { target: { value: "0" } });
    expect(screen.getByText(copy.invalidCost)).toBeInTheDocument();
    expect(cost).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(cost, { target: { value: "lots" } });
    expect(last(onBrief).budget.usdCap).toBeNaN();
    expect(screen.getByText(copy.invalidCost)).toBeInTheDocument();
    fireEvent.change(cost, { target: { value: "2.5" } });
    expect(screen.queryByText(copy.invalidCost)).toBeNull();
    expect(last(onBrief).budget.usdCap).toBe(2.5);
    fireEvent.change(cost, { target: { value: " " } });
    expect(last(onBrief).budget.usdCap).toBeNull();

    fireEvent.change(runs, { target: { value: "1.5" } });
    expect(screen.getByText(copy.invalidRuns)).toBeInTheDocument();
    expect(runs).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(runs, { target: { value: "20" } });
    expect(screen.queryByText(copy.invalidRuns)).toBeNull();
    expect(last(onBrief).budget.maxRuns).toBe(20);
    fireEvent.change(runs, { target: { value: "" } });
    expect(last(onBrief).budget.maxRuns).toBeNull();
  });

  it("picks the command rule, network access and plan review", async () => {
    const onBrief = vi.fn();
    render(<Harness onBrief={onBrief} />);
    openBrief();
    const commands = screen.getByRole("combobox", { name: copy.commandsLabel });
    const network = screen.getByRole("checkbox", { name: new RegExp(copy.network) });
    const plan = screen.getByRole("checkbox", { name: new RegExp(copy.reviewPlan) });
    expect(commands).toHaveTextContent(copy.commandsAllow);
    expect(screen.getByText(copy.networkHint)).toBeInTheDocument();
    expect(screen.getByText(copy.reviewPlanHint)).toBeInTheDocument();

    fireEvent.click(plan);
    expect(last(onBrief).reviewPlanFirst).toBe(true);
    fireEvent.click(network);
    expect(last(onBrief).permissions.network).toBe(true);
    await choose(commands, copy.commandsAsk);
    expect(last(onBrief).permissions.commands).toBe("ask");
    await choose(commands, copy.commandsOff);
    expect(last(onBrief).permissions).toMatchObject({ commands: "off", network: true });
    expect(network).toBeDisabled();
    fireEvent.click(plan);
    expect(last(onBrief).reviewPlanFirst).toBe(false);
  });

  it("offers the time budgets and keeps a custom one in order", async () => {
    const onBrief = vi.fn();
    render(<Harness initial={briefFixture({ budget: { ...briefFixture().budget, wallClockMinutes: 90 } })} onBrief={onBrief} />);
    openBrief();
    const time = screen.getByRole("combobox", { name: copy.timeLabel });
    expect(time).toHaveTextContent("90 minutes");

    const user = userEvent.setup();
    await user.click(time);
    const options = screen.getAllByRole("option").map((option) => option.textContent);
    expect(options).toEqual([
      "30 minutes",
      "1 hour",
      "90 minutes",
      "2 hours",
      "4 hours",
      "8 hours",
      "12 hours",
      "24 hours",
    ]);
    await user.click(screen.getByRole("option", { name: "4 hours" }));
    expect(last(onBrief).budget.wallClockMinutes).toBe(240);
  });

  it("offers run timeouts for the profile and keeps a custom one", async () => {
    const onBrief = vi.fn();
    render(
      <Harness
        initial={briefFixture({ budget: { ...briefFixture().budget, runTimeoutMinutes: 45 } })}
        onBrief={onBrief}
      />,
    );
    openBrief();
    const timeout = screen.getByRole("combobox", { name: copy.runTimeoutLabel });
    expect(timeout).toHaveTextContent("45 minutes");

    const user = userEvent.setup();
    await user.click(timeout);
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "10 minutes",
      "30 minutes",
      "45 minutes",
      "1 hour",
      "2 hours",
    ]);
    await user.click(screen.getByRole("option", { name: "2 hours" }));
    expect(last(onBrief).budget.runTimeoutMinutes).toBe(120);
  });

  it("switching the run profile keeps a timeout both allow and otherwise picks a middle one", async () => {
    const onBrief = vi.fn();
    render(
      <Harness
        initial={briefFixture({ budget: { ...briefFixture().budget, runTimeoutMinutes: 10 } })}
        onBrief={onBrief}
      />,
    );
    openBrief();
    const profile = screen.getByRole("combobox", { name: copy.profileLabel });
    expect(profile).toHaveTextContent(copy.profileAnalysis);
    expect(screen.getByText(copy.profileAnalysisHint)).toBeInTheDocument();

    await choose(profile, copy.profileTraining);
    expect(last(onBrief)).toMatchObject({ profile: "training", budget: { runTimeoutMinutes: 240 } });
    expect(screen.getByText(copy.profileTrainingHint)).toBeInTheDocument();

    await choose(screen.getByRole("combobox", { name: copy.runTimeoutLabel }), "1 hour");
    await choose(profile, copy.profileAnalysis);
    expect(last(onBrief)).toMatchObject({ profile: "analysis", budget: { runTimeoutMinutes: 60 } });

    await choose(screen.getByRole("combobox", { name: copy.runTimeoutLabel }), "2 hours");
    await choose(profile, copy.profileTraining);
    expect(last(onBrief)).toMatchObject({ profile: "training", budget: { runTimeoutMinutes: 120 } });
  });

  it("lists the compute targets and picks the executor that goes with one", async () => {
    const onBrief = vi.fn();
    render(
      <Harness
        computeTargets={[{ id: "t-s", label: "Lab cluster", executor: "slurm" }]}
        onBrief={onBrief}
      />,
    );
    openBrief();
    const compute = screen.getByRole("combobox", { name: copy.computeLabel });
    expect(compute).toHaveTextContent(copy.computeLocal);

    await choose(compute, "Lab cluster");
    expect(last(onBrief).compute).toEqual({ executor: "slurm", target: "t-s", resources: null });
    await choose(compute, copy.computeLocal);
    expect(last(onBrief).compute).toEqual({ executor: "local", target: null, resources: null });
  });

  it("keeps this computer when no other target exists, or shows the composer's own control", () => {
    const view = render(<Harness />);
    openBrief();
    expect(screen.getByRole("combobox", { name: copy.computeLabel })).toBeDisabled();
    view.unmount();

    const renderCompute = vi.fn((fieldId: string) => <input id={fieldId} defaultValue="Runs on the cluster" />);
    render(<Harness renderCompute={renderCompute} />);
    openBrief();
    expect(screen.getByLabelText(copy.computeLabel)).toHaveValue("Runs on the cluster");
    expect(renderCompute).toHaveBeenCalledWith(expect.stringMatching(/-compute$/));
  });

  it("schedules a start time and clears it again", () => {
    const onRunAfter = vi.fn();
    const onBrief = vi.fn();
    render(
      <Harness
        initial={briefFixture({ permissions: { ...briefFixture().permissions, desktopApps: true } })}
        onBrief={onBrief}
        onRunAfter={onRunAfter}
      />,
    );
    openBrief();
    const start = screen.getByLabelText(copy.startAtLabel);
    expect(start).toHaveValue("");
    expect(screen.getByText(copy.startNow)).toBeInTheDocument();
    expect(screen.getByTestId("research-brief-desktop-apps")).toHaveTextContent(desktopApps.off);

    fireEvent.change(start, { target: { value: "2026-10-20T09:30" } });
    expect(onRunAfter).toHaveBeenLastCalledWith(new Date("2026-10-20T09:30").getTime());
    expect(start).toHaveValue("2026-10-20T09:30");
    expect(screen.queryByText(copy.startNow)).toBeNull();
    expect(last(onBrief).permissions.desktopApps).toBe(false);
    expect(screen.getByTestId("research-brief-desktop-apps")).toHaveTextContent(desktopApps.unattended);

    fireEvent.change(start, { target: { value: "" } });
    expect(onRunAfter).toHaveBeenLastCalledWith(null);
    expect(screen.getByText(copy.startNow)).toBeInTheDocument();
    expect(onBrief).toHaveBeenCalledOnce();
  });

  it("keep running needs background work turned on in Settings", () => {
    const view = render(<Harness backgroundEnabled={false} />);
    openBrief();
    const keep = screen.getByRole("checkbox", { name: new RegExp(copy.keepRunning) });
    expect(keep).toBeDisabled();
    expect(keep).not.toBeChecked();
    expect(screen.getByText(copy.keepRunningHint)).toBeInTheDocument();
    view.unmount();

    const onKeepRunning = vi.fn();
    const onBrief = vi.fn();
    render(
      <Harness
        backgroundEnabled
        initial={briefFixture({ permissions: { ...briefFixture().permissions, desktopApps: true } })}
        onBrief={onBrief}
        onKeepRunning={onKeepRunning}
      />,
    );
    openBrief();
    const enabled = screen.getByRole("checkbox", { name: new RegExp(copy.keepRunning) });
    expect(screen.queryByText(copy.keepRunningHint)).toBeNull();
    fireEvent.click(enabled);
    expect(onKeepRunning).toHaveBeenLastCalledWith(true);
    expect(enabled).toBeChecked();
    expect(last(onBrief).permissions.desktopApps).toBe(false);
    expect(screen.getByTestId("research-brief-desktop-apps")).toHaveTextContent(desktopApps.unattended);

    fireEvent.click(enabled);
    expect(onKeepRunning).toHaveBeenLastCalledWith(false);
    expect(onBrief).toHaveBeenCalledOnce();
  });

  it("shows the limits a saved brief already has", () => {
    render(
      <Harness initial={briefFixture({ budget: { wallClockMinutes: 120, usdCap: 5, maxRuns: 10, runTimeoutMinutes: 60 } })} />,
    );
    openBrief();
    expect(screen.getByLabelText(copy.costLabel)).toHaveValue("5");
    expect(screen.getByLabelText(copy.runsLabel)).toHaveValue("10");
  });

  it("lets an attended task use desktop apps once the connector is ready", () => {
    const client = new QueryClient();
    client.setQueryData(DESKTOP_APPS_STATUS_KEY, {
      supported: true,
      settings: { enabled: true, apps: [{ id: "com.example.lab", name: "Lab Notebook" }], sites: [], scriptedControl: false },
    } as unknown as DesktopAppsStatus);
    const onBrief = vi.fn();
    render(
      <QueryClientProvider client={client}>
        <Harness onBrief={onBrief} />
      </QueryClientProvider>,
    );
    openBrief();
    const apps = screen.getByRole("checkbox", { name: new RegExp(desktopApps.label) });
    expect(apps).toBeEnabled();
    expect(screen.getByTestId("research-brief-desktop-apps")).toHaveTextContent(desktopApps.description);

    fireEvent.click(apps);
    expect(last(onBrief).permissions.desktopApps).toBe(true);
    expect(apps).toBeChecked();

    fireEvent.change(screen.getByLabelText(copy.startAtLabel), { target: { value: "2026-10-20T09:30" } });
    expect(last(onBrief).permissions.desktopApps).toBe(false);
    expect(apps).toBeDisabled();
    expect(apps).not.toBeChecked();
  });

  it("says a folded option needs fixing, and opens on the problem when the draft already has one", () => {
    const bad = briefFixture({ budget: { wallClockMinutes: 120, usdCap: Number.NaN, maxRuns: null, runTimeoutMinutes: 60 } });
    const view = render(<Harness initial={bad} />);
    // Opens on the bad value, where it can be fixed.
    expect(screen.getByTestId("research-brief-more")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(copy.invalidCost)).toBeInTheDocument();
    expect(screen.queryByTestId("research-brief-problem")).toBeNull();

    openBrief();
    expect(screen.getByTestId("research-brief-problem")).toHaveTextContent(copy.problemHidden);
    view.unmount();

    render(<Harness />);
    expect(screen.queryByTestId("research-brief-problem")).toBeNull();
    openBrief();
    fireEvent.change(screen.getByLabelText(copy.costLabel), { target: { value: "abc" } });
    openBrief();
    expect(screen.getByTestId("research-brief-problem")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(copy.goalLabel), { target: { value: "Still folded" } });
    openBrief();
    fireEvent.change(screen.getByLabelText(copy.costLabel), { target: { value: "5" } });
    openBrief();
    expect(screen.queryByTestId("research-brief-problem")).toBeNull();
  });

  it("says so while folded when the run settings have a problem the composer found", () => {
    render(<Harness computeProblem />);
    expect(screen.getByTestId("research-brief-more")).toHaveAttribute("aria-expanded", "true");
    openBrief();
    expect(screen.getByTestId("research-brief-problem")).toHaveTextContent(copy.problemHidden);
  });

  it("limits the start time to the next 30 days and explains one outside them", () => {
    render(<Harness />);
    openBrief();
    const start = screen.getByLabelText(copy.startAtLabel);
    const now = Date.now();
    expect(start).toHaveAttribute("min", localDateTime(now));
    expect(start).toHaveAttribute("max", localDateTime(now + 30 * 24 * 60 * 60 * 1000));

    fireEvent.change(start, { target: { value: localDateTime(now - 5 * 60 * 60 * 1000) } });
    expect(screen.getByText(copy.invalidStart)).toBeInTheDocument();
    expect(start).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(start, { target: { value: localDateTime(now + 40 * 24 * 60 * 60 * 1000) } });
    expect(screen.getByText(copy.invalidStart)).toBeInTheDocument();
    fireEvent.change(start, { target: { value: localDateTime(now + 2 * 24 * 60 * 60 * 1000) } });
    expect(screen.queryByText(copy.invalidStart)).toBeNull();
    expect(start).toHaveAttribute("aria-invalid", "false");
  });

  it("keeps a typed start time in the box instead of rewriting it", () => {
    const onRunAfter = vi.fn();
    render(<Harness onRunAfter={onRunAfter} />);
    openBrief();
    const start = screen.getByLabelText(copy.startAtLabel);
    const at = localDateTime(Date.now() + 3 * 24 * 60 * 60 * 1000);

    fireEvent.change(start, { target: { value: at } });

    expect(start).toHaveValue(at);
    expect(onRunAfter).toHaveBeenLastCalledWith(new Date(at).getTime());
  });

  it("offers the Settings link where background work is turned on", () => {
    useSettingsStore.setState({ settingsOpen: false, settingsInitialSection: "general" });
    render(<Harness backgroundEnabled={false} />);
    openBrief();

    fireEvent.click(screen.getByTestId("research-brief-keep-running-settings"));

    expect(useSettingsStore.getState()).toMatchObject({ settingsOpen: true, settingsInitialSection: "research" });
  });

  it("leaves out the Settings link once background work is on", () => {
    render(<Harness backgroundEnabled />);
    openBrief();
    expect(screen.queryByTestId("research-brief-keep-running-settings")).toBeNull();
  });

  it("locks every field while the task is saved", () => {
    render(<Harness disabled computeTargets={[{ id: "t-s", label: "Lab cluster", executor: "slurm" }]} />);
    expect(screen.getByLabelText(copy.goalLabel)).toBeDisabled();
    expect(screen.getByLabelText(copy.criteriaLabel)).toBeDisabled();
    openBrief();
    const fields = within(screen.getByTestId("research-brief-fields"));
    expect(fields.getByLabelText(copy.scopeLabel)).toBeDisabled();
    expect(fields.getByLabelText(copy.constraintsLabel)).toBeDisabled();
    expect(fields.getByRole("textbox", { name: copy.metricLabel })).toBeDisabled();
    expect(fields.getByLabelText(copy.costLabel)).toBeDisabled();
    expect(fields.getByLabelText(copy.runsLabel)).toBeDisabled();
    expect(fields.getByLabelText(copy.startAtLabel)).toBeDisabled();
    for (const name of [copy.commandsLabel, copy.timeLabel, copy.runTimeoutLabel, copy.profileLabel, copy.computeLabel]) {
      expect(fields.getByRole("combobox", { name })).toBeDisabled();
    }
    for (const checkbox of fields.getAllByRole("checkbox")) expect(checkbox).toBeDisabled();
  });
});

describe("brief helpers", () => {
  it("words a duration in hours when it divides evenly", () => {
    expect(durationLabel(1)).toBe("1 minute");
    expect(durationLabel(30)).toBe("30 minutes");
    expect(durationLabel(60)).toBe("1 hour");
    expect(durationLabel(90)).toBe("90 minutes");
    expect(durationLabel(1_440)).toBe("24 hours");
    expect(TIME_BUDGET_OPTIONS).toEqual([30, 60, 120, 240, 480, 720, 1440]);
  });

  it("lists what is wrong with a brief", () => {
    expect(briefErrors(briefFixture())).toEqual({});
    expect(briefErrors(briefFixture({ primaryMetric: { name: "val_loss", goal: "minimize" } }))).toEqual({});
    expect(briefErrors(briefFixture({ primaryMetric: { name: "", goal: "minimize" } }))).toEqual({
      metric: copy.invalidMetric,
    });
    expect(briefErrors(briefFixture({ primaryMetric: { name: "x".repeat(65), goal: "maximize" } }))).toEqual({
      metric: copy.invalidMetric,
    });
    // The task store's rule: a letter or underscore first, and slashes are fine.
    expect(briefErrors(briefFixture({ primaryMetric: { name: "1acc", goal: "maximize" } }))).toEqual({
      metric: copy.invalidMetric,
    });
    expect(briefErrors(briefFixture({ primaryMetric: { name: "train/loss", goal: "minimize" } }))).toEqual({});
    const budget = briefFixture().budget;
    expect(briefErrors(briefFixture({ budget: { ...budget, usdCap: 10_001 } }))).toEqual({ cost: copy.invalidCost });
    expect(briefErrors(briefFixture({ budget: { ...budget, usdCap: Number.POSITIVE_INFINITY } }))).toEqual({
      cost: copy.invalidCost,
    });
    expect(briefErrors(briefFixture({ budget: { ...budget, usdCap: 10_000, maxRuns: 1_000 } }))).toEqual({});
    expect(briefErrors(briefFixture({ budget: { ...budget, maxRuns: 0 } }))).toEqual({ runs: copy.invalidRuns });
    expect(briefErrors(briefFixture({ budget: { ...budget, maxRuns: 1_001 } }))).toEqual({ runs: copy.invalidRuns });
  });

  it("reads typed local dates and refuses text that is not one", () => {
    const at = new Date(2026, 9, 24, 14, 30).getTime();
    expect(parseLocalDateTime("2026-10-24T14:30")).toBe(at);
    expect(parseLocalDateTime("  2026-10-24 14:30 ")).toBe(at);
    expect(parseLocalDateTime("2026-10-24T14:30:45")).toBe(new Date(2026, 9, 24, 14, 30, 45).getTime());
    expect(parseLocalDateTime("2026-10-2")).toBeNaN();
    expect(parseLocalDateTime("2026-10-24")).toBeNaN();
    expect(parseLocalDateTime("tomorrow 9am")).toBeNaN();
    // A day that rolls over into the next month is not a day.
    expect(parseLocalDateTime("2026-02-31T10:00")).toBeNaN();
    expect(parseLocalDateTime("2026-13-01T10:00")).toBeNaN();
    expect(parseLocalDateTime("2026-10-24T25:00")).toBeNaN();
  });

  it("explains a start time the backend would refuse", () => {
    const now = Date.UTC(2026, 9, 23, 12);
    const day = 24 * 60 * 60 * 1000;
    expect(startError(null, now)).toBeUndefined();
    expect(startError(now + day, now)).toBeUndefined();
    expect(startError(now - 30_000, now)).toBeUndefined();
    expect(startError(now - 61_000, now)).toBe(copy.invalidStart);
    expect(startError(now + 31 * day, now)).toBe(copy.invalidStart);
    expect(startError(Number.NaN, now)).toContain(localDateTime(now + day));
    expect(startError(Number.NaN, now)).toMatch(/^Use the format \d{4}-\d{2}-\d{2}T\d{2}:\d{2}\.$/);
  });

  it("counts a start time that already passed as starting now", () => {
    const now = Date.UTC(2026, 9, 23, 12);
    expect(upcomingStart(null, now)).toBeNull();
    expect(upcomingStart(undefined, now)).toBeNull();
    expect(upcomingStart(now - 1, now)).toBeNull();
    expect(upcomingStart(now, now)).toBeNull();
    expect(upcomingStart(Number.NaN, now)).toBeNull();
    expect(upcomingStart(now + 1, now)).toBe(now + 1);
  });

  it("formats a time for a local date and time field", () => {
    const at = new Date(2026, 0, 5, 7, 4).getTime();
    expect(localDateTime(at)).toBe("2026-01-05T07:04");
    expect(new Date(localDateTime(at)).getTime()).toBe(at);
  });
});
