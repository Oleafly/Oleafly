import { useId, useRef, useState, type ReactNode } from "react";
import { Calculator, Copy } from "lucide-react";
import { ToolPageShell } from "@/components/tools/ToolPageShell";
import {
  ToolPane,
  ToolPreviewSurface,
  ToolSegmentedControl,
  ToolSplitView,
  ToolStatus,
} from "@/components/tools/ToolWorkspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useHomeViewStore } from "@/store/home-view";
import {
  statsConfidenceInterval,
  statsPValue,
  statsSampleSize,
  type StatsConfidenceIntervalResult,
  type StatsPValueResult,
  type StatsSampleSizeResult,
} from "@/lib/tauri";
import { notifyError, toast } from "@/lib/toast";

type Tab = "p-value" | "sample-size" | "confidence-interval";

const CALCULATORS = [
  { value: "p-value", label: "p-value", testId: "stats-tab-p-value" },
  { value: "sample-size", label: "Sample size", testId: "stats-tab-sample-size" },
  { value: "confidence-interval", label: "Interval", testId: "stats-tab-confidence-interval" },
] as const;

function NumberField({ label, value, onChange, placeholder }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const id = useId();
  return (
    <div className="grid gap-1.5 text-sm">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">{label}</label>
      <Input
        id={id}
        inputMode="decimal"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 rounded-lg bg-background/70"
      />
    </div>
  );
}

function ResultLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t py-2.5 first:border-t-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-right font-mono text-sm text-foreground">{value}</span>
    </div>
  );
}

function useCalculation<Result>(name: string) {
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);

  const invalidate = () => {
    request.current += 1;
    setResult(null);
    setError(null);
    setBusy(false);
  };

  const run = async (calculate: () => Promise<Result>) => {
    const id = ++request.current;
    setBusy(true);
    setError(null);
    try {
      const next = await calculate();
      if (id === request.current) setResult(next);
    } catch (caught) {
      if (id === request.current) {
        notifyError(name, caught);
        setResult(null);
        setError(caught instanceof Error ? caught.message : "Check the values and try again.");
      }
    } finally {
      if (id === request.current) setBusy(false);
    }
  };

  return { result, busy, error, invalidate, run };
}

function CalculatorControls({ tab, onTabChange, onCompute, busy, testId }: {
  tab: Tab;
  onTabChange: (tab: Tab) => void;
  onCompute: () => void;
  busy: boolean;
  testId: string;
}) {
  return (
    <div className="flex max-w-full items-center gap-2">
      <ToolSegmentedControl label="Calculator" value={tab} options={CALCULATORS} onChange={onTabChange} />
      <Button type="button" size="sm" disabled={busy} data-testid={testId} onClick={onCompute} className="shrink-0">
        {busy ? "Computing" : "Compute"}
      </Button>
    </div>
  );
}

function ResultSurface({ testId, busy, error, empty, children }: {
  testId: string;
  busy: boolean;
  error: string | null;
  empty: string;
  children: ReactNode;
}) {
  return (
    <ToolPreviewSurface className="items-center justify-center text-center">
      <div data-testid={testId} className="w-full max-w-md">
        {busy ? <ToolStatus state="busy">Computing locally…</ToolStatus>
          : error ? <div className="space-y-2"><ToolStatus state="error">Couldn&apos;t calculate this result</ToolStatus><p className="text-sm text-muted-foreground">{error}</p></div>
          : children || <div className="space-y-3"><ToolStatus state="ready">Ready for local calculation</ToolStatus><p className="text-sm leading-6 text-muted-foreground">{empty}</p></div>}
      </div>
    </ToolPreviewSurface>
  );
}

function Examples({ children }: { children: ReactNode }) {
  return <div><div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Examples</div><div className="flex flex-wrap gap-2">{children}</div></div>;
}

async function copyResult(lines: string[]) {
  try {
    await navigator.clipboard.writeText(lines.join("\n"));
    toast.success("Copied result");
  } catch (caught) {
    toast.error(caught instanceof Error ? caught.message : "Couldn't copy result");
  }
}

function CopyResultButton({ lines }: { lines: string[] }) {
  return (
    <Button variant="outline" size="sm" onClick={() => void copyResult(lines)}>
      <Copy className="size-3.5" /> Copy result
    </Button>
  );
}

function PValueCalculator({ tab, onTabChange }: { tab: Tab; onTabChange: (tab: Tab) => void }) {
  const [test, setTest] = useState("t-two");
  const [statistic, setStatistic] = useState("2.34");
  const [df, setDf] = useState("28");
  const { result, busy, error, invalidate, run } = useCalculation<StatsPValueResult>("p-value");
  const calculate = () => run(async () => {
    const needsDf = test.startsWith("t") || test === "chi";
    return statsPValue(test, Number.parseFloat(statistic), needsDf ? Number.parseFloat(df) : undefined);
  });
  const setExample = (nextTest: string, nextStatistic: string, nextDf = "") => {
    invalidate(); setTest(nextTest); setStatistic(nextStatistic); setDf(nextDf);
  };
  const p = result?.p;
  const verdict = p === undefined ? null : p < 0.001 ? "p < .001" : p < 0.01 ? "p < .01" : p < 0.05 ? "p < .05" : p < 0.1 ? "p < .10" : "Not significant";

  return (
    <ToolSplitView storageId="statistics-p-value">
      <ToolPane title="Calculator" actions={<CalculatorControls tab={tab} onTabChange={onTabChange} onCompute={() => void calculate()} busy={busy} testId="stats-p-run" />} footer={<Examples><Button variant="outline" size="sm" onClick={() => setExample("t-two", "2.34", "28")}>t-test</Button><Button variant="outline" size="sm" onClick={() => setExample("z-two", "1.96")}>z-test</Button></Examples>}>
        <div className="mx-auto w-full max-w-md space-y-5 p-5 md:p-6">
          <label className="grid gap-1.5 text-sm"><span className="text-xs font-medium text-muted-foreground">Test</span><select value={test} onChange={(event) => { invalidate(); setTest(event.target.value); }} data-testid="stats-p-test" className="h-10 rounded-lg border bg-background/70 px-3 text-sm"><option value="t-two">t-test, two-tailed</option><option value="t-one">t-test, upper tail</option><option value="z-two">z-test, two-tailed</option><option value="z-one">z-test, upper tail</option><option value="chi">chi-square, upper tail</option></select></label>
          <NumberField label="Statistic" value={statistic} onChange={(value) => { invalidate(); setStatistic(value); }} placeholder="2.34" />
          {(test.startsWith("t") || test === "chi") && <NumberField label="Degrees of freedom" value={df} onChange={(value) => { invalidate(); setDf(value); }} placeholder="28" />}
        </div>
      </ToolPane>
      <ToolPane title="Result" badge={result ? "Computed" : undefined} actions={busy ? <ToolStatus state="busy">Working</ToolStatus> : result ? <CopyResultButton lines={["p-value", `Test: ${result.label}`, `Statistic: ${statistic}`, ...(test.startsWith("t") || test === "chi" ? [`Degrees of freedom: ${df}`] : []), `p-value: ${result.p.toPrecision(4)}`]} /> : undefined}>
        <ResultSurface testId="stats-p-result" busy={busy} error={error} empty="Enter a test statistic, then compute its p-value.">
          {result ? <div className="space-y-5"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{result.label}</p><p className="font-mono text-4xl tracking-tight text-foreground">p = {result.p.toPrecision(4)}</p><p className="text-sm text-muted-foreground">{verdict}</p></div> : null}
        </ResultSurface>
      </ToolPane>
    </ToolSplitView>
  );
}

function SampleSizeCalculator({ tab, onTabChange }: { tab: Tab; onTabChange: (tab: Tab) => void }) {
  const [proportion, setProportion] = useState("50");
  const [margin, setMargin] = useState("5");
  const [confidence, setConfidence] = useState("95");
  const [population, setPopulation] = useState("");
  const { result, busy, error, invalidate, run } = useCalculation<StatsSampleSizeResult>("sample size");
  const calculate = () => run(() => statsSampleSize(Number.parseFloat(proportion), Number.parseFloat(margin), Number.parseFloat(confidence), population.trim() ? Number.parseFloat(population) : undefined));
  const setExample = (nextPopulation: string) => { invalidate(); setProportion("50"); setMargin("5"); setConfidence("95"); setPopulation(nextPopulation); };

  return (
    <ToolSplitView storageId="statistics-sample-size">
      <ToolPane title="Calculator" actions={<CalculatorControls tab={tab} onTabChange={onTabChange} onCompute={() => void calculate()} busy={busy} testId="stats-n-run" />} footer={<Examples><Button variant="outline" size="sm" onClick={() => setExample("")}>Open population</Button><Button variant="outline" size="sm" onClick={() => setExample("1000")}>Population of 1,000</Button></Examples>}>
        <div className="mx-auto w-full max-w-md space-y-5 p-5 md:p-6">
          <NumberField label="Expected proportion (%)" value={proportion} onChange={(value) => { invalidate(); setProportion(value); }} placeholder="50" />
          <NumberField label="Margin of error (%)" value={margin} onChange={(value) => { invalidate(); setMargin(value); }} placeholder="5" />
          <NumberField label="Confidence (%)" value={confidence} onChange={(value) => { invalidate(); setConfidence(value); }} placeholder="95" />
          <NumberField label="Population size (optional)" value={population} onChange={(value) => { invalidate(); setPopulation(value); }} placeholder="1000" />
        </div>
      </ToolPane>
      <ToolPane title="Result" badge={result ? "Computed" : undefined} actions={busy ? <ToolStatus state="busy">Working</ToolStatus> : result ? <CopyResultButton lines={["Sample size", `Expected proportion: ${proportion}%`, `Margin of error: ${margin}%`, `Confidence: ${confidence}%`, ...(population.trim() ? [`Population size: ${population}`] : []), `Critical z: ${result.z.toFixed(3)}`, `Open population sample: ${result.infinitePopulation}`, ...(result.finitePopulation ? [`Finite population sample: ${result.finitePopulation}`] : [])]} /> : undefined}>
        <ResultSurface testId="stats-n-result" busy={busy} error={error} empty="Enter an expected proportion and margin of error to estimate a sample size.">
          {result ? <div className="w-full text-left"><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recommended sample</p><p className="mb-6 font-mono text-4xl tracking-tight text-foreground">{result.finitePopulation ?? result.infinitePopulation}</p><ResultLine label="Critical z" value={result.z.toFixed(3)} /><ResultLine label="Open population" value={String(result.infinitePopulation)} />{result.finitePopulation ? <ResultLine label="Finite population" value={String(result.finitePopulation)} /> : null}</div> : null}
        </ResultSurface>
      </ToolPane>
    </ToolSplitView>
  );
}

function ConfidenceIntervalCalculator({ tab, onTabChange }: { tab: Tab; onTabChange: (tab: Tab) => void }) {
  const [mode, setMode] = useState<"mean" | "proportion">("mean");
  const [mean, setMean] = useState("100");
  const [sd, setSd] = useState("15");
  const [n, setN] = useState("9");
  const [successes, setSuccesses] = useState("81");
  const [confidence, setConfidence] = useState("95");
  const { result, busy, error, invalidate, run } = useCalculation<StatsConfidenceIntervalResult>("confidence interval");
  const calculate = () => run(() => statsConfidenceInterval(mode, Number.parseFloat(confidence), { mean: mode === "mean" ? Number.parseFloat(mean) : undefined, sd: mode === "mean" ? Number.parseFloat(sd) : undefined, n: Number.parseFloat(n), successes: mode === "proportion" ? Number.parseFloat(successes) : undefined }));
  const setMeanExample = () => { invalidate(); setMode("mean"); setMean("100"); setSd("15"); setN("9"); setConfidence("95"); };
  const setProportionExample = () => { invalidate(); setMode("proportion"); setSuccesses("0"); setN("10"); setConfidence("95"); };

  return (
    <ToolSplitView storageId="statistics-confidence-interval">
      <ToolPane title="Calculator" actions={<CalculatorControls tab={tab} onTabChange={onTabChange} onCompute={() => void calculate()} busy={busy} testId="stats-ci-run" />} footer={<Examples><Button variant="outline" size="sm" onClick={setMeanExample}>Mean</Button><Button variant="outline" size="sm" onClick={setProportionExample}>0 of 10</Button></Examples>}>
        <div className="mx-auto w-full max-w-md space-y-5 p-5 md:p-6">
          <div data-testid="stats-ci-mode"><ToolSegmentedControl label="Estimate type" value={mode} options={[{ value: "mean", label: "Mean", testId: "stats-ci-mode-mean" }, { value: "proportion", label: "Proportion", testId: "stats-ci-mode-proportion" }]} onChange={(value) => { invalidate(); setMode(value); }} /></div>
          {mode === "mean" ? <><NumberField label="Sample mean" value={mean} onChange={(value) => { invalidate(); setMean(value); }} placeholder="100" /><NumberField label="Sample standard deviation" value={sd} onChange={(value) => { invalidate(); setSd(value); }} placeholder="15" /></> : <NumberField label="Successes" value={successes} onChange={(value) => { invalidate(); setSuccesses(value); }} placeholder="81" />}
          <NumberField label="Sample size" value={n} onChange={(value) => { invalidate(); setN(value); }} placeholder="9" />
          <NumberField label="Confidence (%)" value={confidence} onChange={(value) => { invalidate(); setConfidence(value); }} placeholder="95" />
        </div>
      </ToolPane>
      <ToolPane title="Result" badge={result ? "Computed" : undefined} actions={busy ? <ToolStatus state="busy">Working</ToolStatus> : result ? <CopyResultButton lines={["Confidence interval", `Method: ${result.intervalMethod}`, `Confidence: ${confidence}%`, ...(mode === "mean" ? [`Sample mean: ${mean}`, `Sample standard deviation: ${sd}`] : [`Successes: ${successes}`]), `Sample size: ${n}`, `Point estimate: ${result.pointEstimate.toPrecision(4)}`, `Interval: [${result.lower.toPrecision(4)}, ${result.upper.toPrecision(4)}]`, `Standard error: ${result.standardError.toPrecision(4)}`, `${result.intervalMethod.startsWith("Wilson") ? "Wilson half-width" : "Margin of error"}: ${result.marginOfError.toPrecision(4)}`, `Critical ${result.criticalLabel}: ${result.criticalValue.toFixed(4)}`]} /> : undefined}>
        <ResultSurface testId="stats-ci-result" busy={busy} error={error} empty="Means use t intervals. Proportions use Wilson score intervals.">
          {result ? <div className="w-full text-left"><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{result.intervalMethod}</p><p className="mb-6 font-mono text-2xl tracking-tight text-foreground">[{result.lower.toPrecision(4)}, {result.upper.toPrecision(4)}]</p><ResultLine label="Point estimate" value={result.pointEstimate.toPrecision(4)} /><ResultLine label="Standard error" value={result.standardError.toPrecision(4)} /><ResultLine label={result.intervalMethod.startsWith("Wilson") ? "Wilson half-width" : "Margin of error"} value={result.marginOfError.toPrecision(4)} /><ResultLine label={`Critical ${result.criticalLabel}`} value={result.criticalValue.toFixed(4)} /></div> : null}
        </ResultSurface>
      </ToolPane>
    </ToolSplitView>
  );
}

export function StatsToolView() {
  const activePage = useHomeViewStore((s) => s.page);
  const [tab, setTab] = useState<Tab>("p-value");
  if (activePage !== "stats") return null;
  return (
    <ToolPageShell page="stats" title="Statistics Calculators" subtitle="p-values, sample sizes, and confidence intervals, computed locally" icon={Calculator} status={<ToolStatus state="ready">Local calculation</ToolStatus>} showTheme testId="stats-tool-view">
      {tab === "p-value" && <PValueCalculator tab={tab} onTabChange={setTab} />}
      {tab === "sample-size" && <SampleSizeCalculator tab={tab} onTabChange={setTab} />}
      {tab === "confidence-interval" && <ConfidenceIntervalCalculator tab={tab} onTabChange={setTab} />}
    </ToolPageShell>
  );
}
