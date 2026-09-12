import { useId, useState } from "react";
import { Calculator } from "lucide-react";
import { ToolPageShell } from "@/components/tools/ToolPageShell";
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
import { notifyError } from "@/lib/toast";

type Tab = "p-value" | "sample-size" | "confidence-interval";

function NumberField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const id = useId();
  return (
    <div className="grid gap-1 text-xs">
      <label htmlFor={id} className="text-muted-foreground">
        {label}
      </label>
      <Input
        id={id}
        inputMode="decimal"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="h-9"
      />
    </div>
  );
}

function ResultLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t px-1 py-1.5 first:border-t-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-mono text-sm">{value}</span>
    </div>
  );
}

function PValueCalculator() {
  const [test, setTest] = useState("t-two");
  const [statistic, setStatistic] = useState("2.34");
  const [df, setDf] = useState("28");
  const [result, setResult] = useState<StatsPValueResult | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const needsDf = test.startsWith("t") || test === "chi";
      setResult(
        await statsPValue(
          test,
          Number.parseFloat(statistic),
          needsDf ? Number.parseFloat(df) : undefined,
        ),
      );
    } catch (e) {
      notifyError("p-value", e);
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  const p = result?.p;
  const verdict =
    p === undefined
      ? null
      : p < 0.001
        ? "p < .001, highly significant"
        : p < 0.01
          ? "p < .01, significant"
          : p < 0.05
            ? "p < .05, significant"
            : p < 0.1
              ? "p < .10, marginal"
              : "n.s.";

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-3">
        <label className="grid gap-1 text-xs">
          <span className="text-muted-foreground">Test</span>
          <select
            value={test}
            onChange={(event) => setTest(event.target.value)}
            data-testid="stats-p-test"
            className="h-9 rounded-md border bg-transparent px-2 text-sm"
          >
            <option value="t-two">t-test, two-tailed</option>
            <option value="t-one">t-test, one-tailed (upper)</option>
            <option value="z-two">z-test, two-tailed</option>
            <option value="z-one">z-test, one-tailed (upper)</option>
            <option value="chi">chi-square, upper tail</option>
          </select>
        </label>
        <NumberField label="Statistic" value={statistic} onChange={setStatistic} placeholder="2.34" />
        {(test.startsWith("t") || test === "chi") && (
          <NumberField label="Degrees of freedom" value={df} onChange={setDf} placeholder="28" />
        )}
        <Button type="button" size="sm" disabled={busy} data-testid="stats-p-run" onClick={() => void run()}>
          Compute
        </Button>
      </div>
      <div className="rounded-lg border bg-card p-3" data-testid="stats-p-result">
        {result ? (
          <>
            <ResultLine label={result.label} value={`p = ${result.p.toPrecision(4)}`} />
            <p className="mt-2 text-xs text-muted-foreground">{verdict}</p>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">Enter a statistic and compute.</p>
        )}
      </div>
    </div>
  );
}

function SampleSizeCalculator() {
  const [proportion, setProportion] = useState("50");
  const [margin, setMargin] = useState("5");
  const [confidence, setConfidence] = useState("95");
  const [population, setPopulation] = useState("");
  const [result, setResult] = useState<StatsSampleSizeResult | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      setResult(
        await statsSampleSize(
          Number.parseFloat(proportion),
          Number.parseFloat(margin),
          Number.parseFloat(confidence),
          population.trim() ? Number.parseFloat(population) : undefined,
        ),
      );
    } catch (e) {
      notifyError("sample size", e);
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-3">
        <NumberField label="Expected proportion (%)" value={proportion} onChange={setProportion} placeholder="50" />
        <NumberField label="Margin of error (%)" value={margin} onChange={setMargin} placeholder="5" />
        <NumberField label="Confidence (%)" value={confidence} onChange={setConfidence} placeholder="95" />
        <NumberField label="Population size (optional)" value={population} onChange={setPopulation} placeholder="1000" />
        <Button type="button" size="sm" disabled={busy} data-testid="stats-n-run" onClick={() => void run()}>
          Compute
        </Button>
      </div>
      <div className="rounded-lg border bg-card p-3" data-testid="stats-n-result">
        {result ? (
          <>
            <ResultLine label="Critical z" value={result.z.toFixed(3)} />
            <ResultLine label="Sample (infinite population)" value={String(result.infinitePopulation)} />
            {result.finitePopulation ? (
              <ResultLine label="Sample (finite population)" value={String(result.finitePopulation)} />
            ) : null}
          </>
        ) : (
          <p className="text-xs text-muted-foreground">Percent inputs, computed with the finite-population correction when a size is given.</p>
        )}
      </div>
    </div>
  );
}

function ConfidenceIntervalCalculator() {
  const [mode, setMode] = useState<"mean" | "proportion">("mean");
  const [mean, setMean] = useState("100");
  const [sd, setSd] = useState("15");
  const [n, setN] = useState("9");
  const [successes, setSuccesses] = useState("81");
  const [confidence, setConfidence] = useState("95");
  const [result, setResult] = useState<StatsConfidenceIntervalResult | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      setResult(
        await statsConfidenceInterval(mode, Number.parseFloat(confidence), {
          mean: mode === "mean" ? Number.parseFloat(mean) : undefined,
          sd: mode === "mean" ? Number.parseFloat(sd) : undefined,
          n: Number.parseFloat(n),
          successes: mode === "proportion" ? Number.parseFloat(successes) : undefined,
        }),
      );
    } catch (e) {
      notifyError("confidence interval", e);
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-3">
        <label className="grid gap-1 text-xs">
          <span className="text-muted-foreground">Estimate</span>
          <select
            value={mode}
            onChange={(event) => setMode(event.target.value as "mean" | "proportion")}
            data-testid="stats-ci-mode"
            className="h-9 rounded-md border bg-transparent px-2 text-sm"
          >
            <option value="mean">Mean</option>
            <option value="proportion">Proportion</option>
          </select>
        </label>
        {mode === "mean" ? (
          <>
            <NumberField label="Sample mean" value={mean} onChange={setMean} placeholder="100" />
            <NumberField label="Sample standard deviation" value={sd} onChange={setSd} placeholder="15" />
          </>
        ) : (
          <NumberField label="Successes" value={successes} onChange={setSuccesses} placeholder="81" />
        )}
        <NumberField label="Sample size" value={n} onChange={setN} placeholder="9" />
        <NumberField label="Confidence (%)" value={confidence} onChange={setConfidence} placeholder="95" />
        <Button type="button" size="sm" disabled={busy} data-testid="stats-ci-run" onClick={() => void run()}>
          Compute
        </Button>
      </div>
      <div className="rounded-lg border bg-card p-3" data-testid="stats-ci-result">
        {result ? (
          <>
            <ResultLine
              label="Point estimate"
              value={result.pointEstimate.toPrecision(4)}
            />
            <ResultLine
              label="Interval"
              value={`[${result.lower.toPrecision(4)}, ${result.upper.toPrecision(4)}]`}
            />
            <ResultLine label="Standard error" value={result.standardError.toPrecision(4)} />
            <ResultLine label="Margin of error" value={result.marginOfError.toPrecision(4)} />
            <ResultLine
              label={`Critical ${result.criticalLabel}`}
              value={result.criticalValue.toFixed(4)}
            />
          </>
        ) : (
          <p className="text-xs text-muted-foreground">Means use the t distribution; proportions use Wald.</p>
        )}
      </div>
    </div>
  );
}

export function StatsToolView() {
  const activePage = useHomeViewStore((s) => s.page);
  const [tab, setTab] = useState<Tab>("p-value");
  if (activePage !== "stats") return null;
  return (
    <ToolPageShell
      page="stats"
      title="Statistics Calculators"
      subtitle="p-values, sample sizes, and confidence intervals, computed locally"
      icon={Calculator}
      testId="stats-tool-view"
    >
      <div className="space-y-4">
        <div className="flex gap-1">
          {(
            [
              ["p-value", "p-value"],
              ["sample-size", "Sample size"],
              ["confidence-interval", "Confidence interval"],
            ] as [Tab, string][]
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              data-testid={`stats-tab-${value}`}
              onClick={() => setTab(value)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                tab === value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === "p-value" && <PValueCalculator />}
        {tab === "sample-size" && <SampleSizeCalculator />}
        {tab === "confidence-interval" && <ConfidenceIntervalCalculator />}
      </div>
    </ToolPageShell>
  );
}
