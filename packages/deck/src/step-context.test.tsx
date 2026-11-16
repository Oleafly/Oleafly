// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import type { MutableRefObject, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PreviewStepHost } from "./preview-step-host";
import { Step, type StepAggregate, type StepController, StepHost, Steps, useIsActivePage } from "./step-context";

let reduceMotion = false;

function stepStates(): (string | null)[] {
  return [...document.querySelectorAll("[data-osd-step]")].map((el) => el.getAttribute("data-osd-step"));
}

function stepOf(text: string): HTMLElement {
  const el = screen.getByText(text).closest<HTMLElement>("[data-osd-step]");
  if (!el) throw new Error(`no step around ${text}`);
  return el;
}

function controllerRef(): MutableRefObject<StepController | null> {
  return { current: null };
}

function ActiveProbe({ name }: Readonly<{ name: string }>) {
  return <span>{`${name}: ${useIsActivePage() ? "active" : "inactive"}`}</span>;
}

function TwoGroups({ withSecond = true }: Readonly<{ withSecond?: boolean }>) {
  return (
    <>
      <Steps>
        <Step>{"A1"}</Step>
        <Step>{"A2"}</Step>
      </Steps>
      {withSecond ? (
        <Steps>
          <Step>{"B1"}</Step>
          <Step>{"B2"}</Step>
        </Steps>
      ) : null}
    </>
  );
}

function host(children: ReactNode, props: Partial<Parameters<typeof StepHost>[0]> = {}) {
  return (
    <StepHost isActivePage entryDirection="forward" controllerRef={props.controllerRef ?? controllerRef()} {...props}>
      {children}
    </StepHost>
  );
}

beforeEach(() => {
  reduceMotion = false;
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: reduceMotion, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Steps", () => {
  it("reveals every step and keeps other children when no slide hosts it", () => {
    render(
      <Steps>
        <Step>{"One"}</Step>
        {"plain text"}
        <p>{"Aside"}</p>
        <Step>{"Two"}</Step>
      </Steps>,
    );

    expect(stepStates()).toEqual(["revealed", "revealed"]);
    expect(screen.getByText("Aside")).toBeInTheDocument();
    expect(screen.getByText(/plain text/)).toBeInTheDocument();
  });

  it("starts hidden on a forward entry and steps through the groups in order", () => {
    const ref = controllerRef();
    const onAggregate = vi.fn<(aggregate: StepAggregate) => void>();
    render(host(<TwoGroups />, { controllerRef: ref, onAggregateChange: onAggregate }));

    expect(stepStates()).toEqual(["pending", "pending", "pending", "pending"]);
    expect(onAggregate).toHaveBeenLastCalledWith({ revealed: 0, stepCount: 4 });

    const advanced: boolean[] = [];
    act(() => {
      for (let i = 0; i < 5; i++) advanced.push(ref.current?.advance() ?? false);
    });
    expect(advanced).toEqual([true, true, true, true, false]);
    expect(stepStates()).toEqual(["revealed", "revealed", "revealed", "revealed"]);
    expect(onAggregate).toHaveBeenLastCalledWith({ revealed: 4, stepCount: 4 });

    act(() => {
      expect(ref.current?.retreat()).toBe(true);
    });
    expect(stepStates()).toEqual(["revealed", "revealed", "revealed", "pending"]);

    const retreated: boolean[] = [];
    act(() => {
      for (let i = 0; i < 4; i++) retreated.push(ref.current?.retreat() ?? false);
    });
    expect(retreated).toEqual([true, true, true, false]);
    expect(stepStates()).toEqual(["pending", "pending", "pending", "pending"]);
    expect(onAggregate).toHaveBeenLastCalledWith({ revealed: 0, stepCount: 4 });
  });

  it.each(["backward", "jump"] as const)("starts fully revealed on a %s entry", (entryDirection) => {
    const ref = controllerRef();
    const onAggregate = vi.fn<(aggregate: StepAggregate) => void>();
    render(host(<TwoGroups />, { controllerRef: ref, entryDirection, onAggregateChange: onAggregate }));

    expect(stepStates()).toEqual(["revealed", "revealed", "revealed", "revealed"]);
    expect(onAggregate).toHaveBeenLastCalledWith({ revealed: 4, stepCount: 4 });
    act(() => {
      expect(ref.current?.advance()).toBe(false);
    });
  });

  it("drops a group's steps from the totals when it unmounts", () => {
    const onAggregate = vi.fn<(aggregate: StepAggregate) => void>();
    const ref = controllerRef();
    const view = render(host(<TwoGroups />, { controllerRef: ref, onAggregateChange: onAggregate }));

    view.rerender(host(<TwoGroups withSecond={false} />, { controllerRef: ref, onAggregateChange: onAggregate }));

    expect(onAggregate).toHaveBeenLastCalledWith({ revealed: 0, stepCount: 2 });
    expect(screen.queryByText("B1")).toBeNull();
  });
});

describe("StepHost controller", () => {
  it("only the active page publishes its controller and withdraws it when it stops being active", () => {
    const ref = controllerRef();
    const view = render(host(<TwoGroups />, { controllerRef: ref, isActivePage: false }));
    expect(ref.current).toBeNull();

    view.rerender(host(<TwoGroups />, { controllerRef: ref, isActivePage: true }));
    expect(ref.current).not.toBeNull();

    view.rerender(host(<TwoGroups />, { controllerRef: ref, isActivePage: false }));
    expect(ref.current).toBeNull();
  });

  it("leaves the controller alone when another page has taken it over", () => {
    const ref = controllerRef();
    const Pair = ({ showFirst }: Readonly<{ showFirst: boolean }>) => (
      <>
        {showFirst ? (
          <StepHost isActivePage entryDirection="forward" controllerRef={ref}>
            <Steps>
              <Step>{"First page step"}</Step>
            </Steps>
          </StepHost>
        ) : null}
        <StepHost isActivePage entryDirection="forward" controllerRef={ref}>
          <Steps>
            <Step>{"Second page step"}</Step>
          </Steps>
        </StepHost>
      </>
    );
    const view = render(<Pair showFirst />);
    const second = ref.current;

    view.rerender(<Pair showFirst={false} />);

    expect(ref.current).toBe(second);
    act(() => {
      expect(ref.current?.advance()).toBe(true);
    });
    expect(stepOf("Second page step")).toHaveAttribute("data-osd-step", "revealed");
  });

  it("drives Steps from another copy of the runtime", async () => {
    vi.resetModules();
    const second = await import("./step-context");
    expect(second.Steps).not.toBe(Steps);
    const ref = controllerRef();
    render(
      <StepHost isActivePage entryDirection="forward" controllerRef={ref}>
        <second.Steps>
          <second.Step>{"Shared step"}</second.Step>
        </second.Steps>
      </StepHost>,
    );

    expect(stepOf("Shared step")).toHaveAttribute("data-osd-step", "pending");
    act(() => {
      expect(ref.current?.advance()).toBe(true);
    });
    expect(stepOf("Shared step")).toHaveAttribute("data-osd-step", "revealed");
  });

  it("tells pages whether they are the active one", () => {
    render(
      <>
        <ActiveProbe name="outside" />
        {host(<ActiveProbe name="current" />)}
        {host(<ActiveProbe name="leaving" />, { isActivePage: false })}
      </>,
    );

    expect(screen.getByText("outside: inactive")).toBeInTheDocument();
    expect(screen.getByText("current: active")).toBeInTheDocument();
    expect(screen.getByText("leaving: inactive")).toBeInTheDocument();
  });
});

describe("controlled StepHost", () => {
  it("splits the revealed count across groups in order and follows changes", () => {
    const onAggregate = vi.fn<(aggregate: StepAggregate) => void>();
    const ref = controllerRef();
    const view = render(
      host(<TwoGroups />, {
        controllerRef: ref,
        entryDirection: "backward",
        controlledRevealed: 1,
        onAggregateChange: onAggregate,
      }),
    );

    expect(stepStates()).toEqual(["revealed", "pending", "pending", "pending"]);
    expect(onAggregate).toHaveBeenLastCalledWith({ revealed: 1, stepCount: 4 });

    view.rerender(
      host(<TwoGroups />, {
        controllerRef: ref,
        entryDirection: "backward",
        controlledRevealed: 3,
        onAggregateChange: onAggregate,
      }),
    );
    expect(stepStates()).toEqual(["revealed", "revealed", "revealed", "pending"]);
    expect(onAggregate).toHaveBeenLastCalledWith({ revealed: 3, stepCount: 4 });

    view.rerender(host(<TwoGroups />, { controllerRef: ref, controlledRevealed: -2 }));
    expect(stepStates()).toEqual(["pending", "pending", "pending", "pending"]);
  });

  it("previews a slide with all or some of its steps shown", () => {
    const view = render(
      <PreviewStepHost revealed={Number.POSITIVE_INFINITY}>
        <TwoGroups />
      </PreviewStepHost>,
    );
    expect(stepStates()).toEqual(["revealed", "revealed", "revealed", "revealed"]);

    view.rerender(
      <PreviewStepHost revealed={2}>
        <TwoGroups />
      </PreviewStepHost>,
    );
    expect(stepStates()).toEqual(["revealed", "revealed", "pending", "pending"]);
  });
});

describe("Step", () => {
  it("fades in over its duration and hides while pending", () => {
    render(
      <StepHost isActivePage entryDirection="forward" controllerRef={controllerRef()}>
        <Steps>
          <Step duration={300}>{"Slow"}</Step>
        </Steps>
      </StepHost>,
    );

    const step = stepOf("Slow");
    expect(step.style.transition).toBe("opacity 300ms cubic-bezier(0, 0, 0.2, 1)");
    expect(step.style.opacity).toBe("0");
    expect(step.style.visibility).toBe("hidden");
  });

  it("shows at once on its own and drops the fade for reduced motion", () => {
    const view = render(<Step>{"Alone"}</Step>);
    expect(stepOf("Alone")).toHaveAttribute("data-osd-step", "revealed");
    expect(stepOf("Alone").style.transition).toBe("opacity 180ms cubic-bezier(0, 0, 0.2, 1)");
    expect(stepOf("Alone").style.visibility).toBe("visible");
    view.unmount();

    reduceMotion = true;
    render(<Step>{"Calm"}</Step>);
    expect(stepOf("Calm").style.transition).toBe("opacity 0ms cubic-bezier(0, 0, 0.2, 1)");
  });
});
