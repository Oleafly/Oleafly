import { useId, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
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
import { i18n } from "@/i18n";

type Tab = "p-value" | "sample-size" | "confidence-interval";

const CALCULATORS = [
  { value: "p-value", testId: "stats-tab-p-value" },
  { value: "sample-size", testId: "stats-tab-sample-size" },
  { value: "confidence-interval", testId: "stats-tab-confidence-interval" },
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
  const { t } = useTranslation(["researchTools"]);
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
        setError(caught instanceof Error ? caught.message : t(($) => $.researchTools.stats.checkValues));
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
  const { t } = useTranslation(["researchTools"]);
  const options = CALCULATORS.map((option) => ({
    ...option,
    label: option.value === "p-value"
      ? t(($) => $.researchTools.stats.tabPValue)
      : option.value === "sample-size"
        ? t(($) => $.researchTools.stats.tabSampleSize)
        : t(($) => $.researchTools.stats.tabInterval),
  }));
  return (
    <div className="flex max-w-full items-center gap-2">
      <ToolSegmentedControl label={t(($) => $.researchTools.stats.calculator)} value={tab} options={options} onChange={onTabChange} />
      <Button type="button" size="sm" disabled={busy} data-testid={testId} onClick={onCompute} className="shrink-0">
        {busy ? t(($) => $.researchTools.stats.computing) : t(($) => $.researchTools.stats.compute)}
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
  const { t } = useTranslation(["researchTools"]);
  return (
    <ToolPreviewSurface className="items-center justify-center text-center">
      <div data-testid={testId} className="w-full max-w-md">
        {busy ? <ToolStatus state="busy">{t(($) => $.researchTools.stats.computingLocally)}</ToolStatus>
          : error ? <div className="space-y-2"><ToolStatus state="error">{t(($) => $.researchTools.stats.calculationFailed)}</ToolStatus><p className="text-sm text-muted-foreground">{error}</p></div>
          : children || <div className="space-y-3"><ToolStatus state="ready">{t(($) => $.researchTools.stats.ready)}</ToolStatus><p className="text-sm leading-6 text-muted-foreground">{empty}</p></div>}
      </div>
    </ToolPreviewSurface>
  );
}

function Examples({ children }: { children: ReactNode }) {
  const { t } = useTranslation(["researchTools"]);
  return <div><div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t(($) => $.researchTools.stats.examples)}</div><div className="flex flex-wrap gap-2">{children}</div></div>;
}

async function copyResult(lines: string[]) {
  try {
    await navigator.clipboard.writeText(lines.join("\n"));
    toast.success(i18n.t(($) => $.researchTools.stats.resultCopied));
  } catch (caught) {
    toast.error(caught instanceof Error ? caught.message : i18n.t(($) => $.researchTools.stats.copyFailed));
  }
}

function CopyResultButton({ lines }: { lines: string[] }) {
  const { t } = useTranslation(["researchTools"]);
  return (
    <Button variant="outline" size="sm" onClick={() => void copyResult(lines)}>
      <Copy className="size-3.5" /> {t(($) => $.researchTools.stats.copyResult)}
    </Button>
  );
}

function PValueCalculator({ tab, onTabChange }: { tab: Tab; onTabChange: (tab: Tab) => void }) {
  const { t } = useTranslation(["researchTools"]);
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
  const verdict = p === undefined
    ? null
    : p < 0.001
      ? "p < .001"
      : p < 0.01
        ? "p < .01"
        : p < 0.05
          ? "p < .05"
          : p < 0.1
            ? "p < .10"
            : t(($) => $.researchTools.stats.notSignificant);
  const testLabel = test === "t-two"
    ? t(($) => $.researchTools.stats.testTTwo, { df })
    : test === "t-one"
      ? t(($) => $.researchTools.stats.testTOne, { df })
      : test === "z-two"
        ? t(($) => $.researchTools.stats.testZTwo)
        : test === "z-one"
          ? t(($) => $.researchTools.stats.testZOne)
          : t(($) => $.researchTools.stats.testChi, { df });
  const backendTestLabel = test === "t-two"
    ? `Two-tailed t-test (${Number.parseFloat(df)} df)`
    : test === "t-one"
      ? `One-tailed t-test, upper tail (${Number.parseFloat(df)} df)`
      : test === "z-two"
        ? "Two-tailed z-test"
        : test === "z-one"
          ? "One-tailed z-test (upper tail)"
          : `Chi-square, upper tail (${Number.parseFloat(df)} df)`;
  const resultTestLabel = result && result.label !== backendTestLabel ? result.label : testLabel;
  const copyLines = result
    ? [
        t(($) => $.researchTools.stats.pValueTitle),
        t(($) => $.researchTools.stats.copyTest, { value: resultTestLabel }),
        t(($) => $.researchTools.stats.copyStatistic, { value: statistic }),
        ...(test.startsWith("t") || test === "chi"
          ? [t(($) => $.researchTools.stats.copyDegreesFreedom, { value: df })]
          : []),
        t(($) => $.researchTools.stats.copyPValue, { value: result.p.toPrecision(4) }),
      ]
    : [];

  return (
    <ToolSplitView storageId="statistics-p-value">
      <ToolPane
        title={t(($) => $.researchTools.stats.calculator)}
        actions={<CalculatorControls tab={tab} onTabChange={onTabChange} onCompute={() => void calculate()} busy={busy} testId="stats-p-run" />}
        footer={(
          <Examples>
            <Button variant="outline" size="sm" onClick={() => setExample("t-two", "2.34", "28")}>{t(($) => $.researchTools.stats.exampleTTest)}</Button>
            <Button variant="outline" size="sm" onClick={() => setExample("z-two", "1.96")}>{t(($) => $.researchTools.stats.exampleZTest)}</Button>
          </Examples>
        )}
      >
        <div className="mx-auto w-full max-w-md space-y-5 p-5 md:p-6">
          <label className="grid gap-1.5 text-sm">
            <span className="text-xs font-medium text-muted-foreground">{t(($) => $.researchTools.stats.test)}</span>
            <select value={test} onChange={(event) => { invalidate(); setTest(event.target.value); }} data-testid="stats-p-test" className="h-10 rounded-lg border bg-background/70 px-3 text-sm">
              <option value="t-two">{t(($) => $.researchTools.stats.testTTwoOption)}</option>
              <option value="t-one">{t(($) => $.researchTools.stats.testTOneOption)}</option>
              <option value="z-two">{t(($) => $.researchTools.stats.testZTwoOption)}</option>
              <option value="z-one">{t(($) => $.researchTools.stats.testZOneOption)}</option>
              <option value="chi">{t(($) => $.researchTools.stats.testChiOption)}</option>
            </select>
          </label>
          <NumberField label={t(($) => $.researchTools.stats.statistic)} value={statistic} onChange={(value) => { invalidate(); setStatistic(value); }} placeholder={t(($) => $.researchTools.stats.statisticPlaceholder)} />
          {(test.startsWith("t") || test === "chi") && (
            <NumberField label={t(($) => $.researchTools.stats.degreesFreedom)} value={df} onChange={(value) => { invalidate(); setDf(value); }} placeholder={t(($) => $.researchTools.stats.dfPlaceholder)} />
          )}
        </div>
      </ToolPane>
      <ToolPane
        title={t(($) => $.researchTools.stats.result)}
        badge={result ? t(($) => $.researchTools.stats.computed) : undefined}
        actions={busy
          ? <ToolStatus state="busy">{t(($) => $.researchTools.stats.working)}</ToolStatus>
          : result
            ? <CopyResultButton lines={copyLines} />
            : undefined}
      >
        <ResultSurface testId="stats-p-result" busy={busy} error={error} empty={t(($) => $.researchTools.stats.pValueEmpty)}>
          {result ? (
            <div className="space-y-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{resultTestLabel}</p>
              <p className="font-mono text-4xl tracking-tight text-foreground">{t(($) => $.researchTools.stats.pValueDisplay, { value: result.p.toPrecision(4) })}</p>
              <p className="text-sm text-muted-foreground">{verdict}</p>
            </div>
          ) : null}
        </ResultSurface>
      </ToolPane>
    </ToolSplitView>
  );
}

function SampleSizeCalculator({ tab, onTabChange }: { tab: Tab; onTabChange: (tab: Tab) => void }) {
  const { t } = useTranslation(["researchTools"]);
  const [proportion, setProportion] = useState("50");
  const [margin, setMargin] = useState("5");
  const [confidence, setConfidence] = useState("95");
  const [population, setPopulation] = useState("");
  const { result, busy, error, invalidate, run } = useCalculation<StatsSampleSizeResult>("sample size");
  const calculate = () => run(() => statsSampleSize(Number.parseFloat(proportion), Number.parseFloat(margin), Number.parseFloat(confidence), population.trim() ? Number.parseFloat(population) : undefined));
  const setExample = (nextPopulation: string) => { invalidate(); setProportion("50"); setMargin("5"); setConfidence("95"); setPopulation(nextPopulation); };
  const copyLines = result
    ? [
        t(($) => $.researchTools.stats.sampleSizeTitle),
        t(($) => $.researchTools.stats.copyExpectedProportion, { value: proportion }),
        t(($) => $.researchTools.stats.copyMargin, { value: margin }),
        t(($) => $.researchTools.stats.copyConfidence, { value: confidence }),
        ...(population.trim()
          ? [t(($) => $.researchTools.stats.copyPopulationSize, { value: population })]
          : []),
        t(($) => $.researchTools.stats.copyCriticalZ, { value: result.z.toFixed(3) }),
        t(($) => $.researchTools.stats.copyOpenSample, { value: result.infinitePopulation }),
        ...(result.finitePopulation
          ? [t(($) => $.researchTools.stats.copyFiniteSample, { value: result.finitePopulation })]
          : []),
      ]
    : [];

  return (
    <ToolSplitView storageId="statistics-sample-size">
      <ToolPane
        title={t(($) => $.researchTools.stats.calculator)}
        actions={<CalculatorControls tab={tab} onTabChange={onTabChange} onCompute={() => void calculate()} busy={busy} testId="stats-n-run" />}
        footer={(
          <Examples>
            <Button variant="outline" size="sm" onClick={() => setExample("")}>{t(($) => $.researchTools.stats.openPopulation)}</Button>
            <Button variant="outline" size="sm" onClick={() => setExample("1000")}>{t(($) => $.researchTools.stats.populationExample)}</Button>
          </Examples>
        )}
      >
        <div className="mx-auto w-full max-w-md space-y-5 p-5 md:p-6">
          <NumberField label={t(($) => $.researchTools.stats.expectedProportion)} value={proportion} onChange={(value) => { invalidate(); setProportion(value); }} placeholder={t(($) => $.researchTools.stats.proportionPlaceholder)} />
          <NumberField label={t(($) => $.researchTools.stats.marginOfErrorPercent)} value={margin} onChange={(value) => { invalidate(); setMargin(value); }} placeholder={t(($) => $.researchTools.stats.marginPlaceholder)} />
          <NumberField label={t(($) => $.researchTools.stats.confidencePercent)} value={confidence} onChange={(value) => { invalidate(); setConfidence(value); }} placeholder={t(($) => $.researchTools.stats.confidencePlaceholder)} />
          <NumberField label={t(($) => $.researchTools.stats.populationSizeOptional)} value={population} onChange={(value) => { invalidate(); setPopulation(value); }} placeholder={t(($) => $.researchTools.stats.populationPlaceholder)} />
        </div>
      </ToolPane>
      <ToolPane
        title={t(($) => $.researchTools.stats.result)}
        badge={result ? t(($) => $.researchTools.stats.computed) : undefined}
        actions={busy
          ? <ToolStatus state="busy">{t(($) => $.researchTools.stats.working)}</ToolStatus>
          : result
            ? <CopyResultButton lines={copyLines} />
            : undefined}
      >
        <ResultSurface testId="stats-n-result" busy={busy} error={error} empty={t(($) => $.researchTools.stats.sampleSizeEmpty)}>
          {result ? (
            <div className="w-full text-left">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t(($) => $.researchTools.stats.recommendedSample)}</p>
              <p className="mb-6 font-mono text-4xl tracking-tight text-foreground">{result.finitePopulation ?? result.infinitePopulation}</p>
              <ResultLine label={t(($) => $.researchTools.stats.criticalZ)} value={result.z.toFixed(3)} />
              <ResultLine label={t(($) => $.researchTools.stats.openPopulation)} value={String(result.infinitePopulation)} />
              {result.finitePopulation ? <ResultLine label={t(($) => $.researchTools.stats.finitePopulation)} value={String(result.finitePopulation)} /> : null}
            </div>
          ) : null}
        </ResultSurface>
      </ToolPane>
    </ToolSplitView>
  );
}

function ConfidenceIntervalCalculator({ tab, onTabChange }: { tab: Tab; onTabChange: (tab: Tab) => void }) {
  const { t } = useTranslation(["researchTools"]);
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
  const intervalMethod = mode === "mean"
    ? t(($) => $.researchTools.stats.meanIntervalMethod)
    : t(($) => $.researchTools.stats.proportionIntervalMethod);
  const marginLabel = mode === "proportion"
    ? t(($) => $.researchTools.stats.wilsonHalfWidth)
    : t(($) => $.researchTools.stats.marginOfError);
  const copyLines = result
    ? [
        t(($) => $.researchTools.stats.confidenceIntervalTitle),
        t(($) => $.researchTools.stats.copyMethod, { value: intervalMethod }),
        t(($) => $.researchTools.stats.copyConfidence, { value: confidence }),
        ...(mode === "mean"
          ? [
              t(($) => $.researchTools.stats.copySampleMean, { value: mean }),
              t(($) => $.researchTools.stats.copySampleSd, { value: sd }),
            ]
          : [t(($) => $.researchTools.stats.copySuccesses, { value: successes })]),
        t(($) => $.researchTools.stats.copySampleSize, { value: n }),
        t(($) => $.researchTools.stats.copyPointEstimate, { value: result.pointEstimate.toPrecision(4) }),
        t(($) => $.researchTools.stats.copyInterval, {
          lower: result.lower.toPrecision(4),
          upper: result.upper.toPrecision(4),
        }),
        t(($) => $.researchTools.stats.copyStandardError, { value: result.standardError.toPrecision(4) }),
        t(($) => $.researchTools.stats.copyMarginValue, {
          label: marginLabel,
          value: result.marginOfError.toPrecision(4),
        }),
        t(($) => $.researchTools.stats.copyCritical, {
          label: result.criticalLabel,
          value: result.criticalValue.toFixed(4),
        }),
      ]
    : [];

  return (
    <ToolSplitView storageId="statistics-confidence-interval">
      <ToolPane
        title={t(($) => $.researchTools.stats.calculator)}
        actions={<CalculatorControls tab={tab} onTabChange={onTabChange} onCompute={() => void calculate()} busy={busy} testId="stats-ci-run" />}
        footer={(
          <Examples>
            <Button variant="outline" size="sm" onClick={setMeanExample}>{t(($) => $.researchTools.stats.mean)}</Button>
            <Button variant="outline" size="sm" onClick={setProportionExample}>{t(($) => $.researchTools.stats.zeroOfTen)}</Button>
          </Examples>
        )}
      >
        <div className="mx-auto w-full max-w-md space-y-5 p-5 md:p-6">
          <div data-testid="stats-ci-mode">
            <ToolSegmentedControl
              label={t(($) => $.researchTools.stats.estimateType)}
              value={mode}
              options={[
                { value: "mean", label: t(($) => $.researchTools.stats.mean), testId: "stats-ci-mode-mean" },
                { value: "proportion", label: t(($) => $.researchTools.stats.proportion), testId: "stats-ci-mode-proportion" },
              ]}
              onChange={(value) => { invalidate(); setMode(value); }}
            />
          </div>
          {mode === "mean" ? (
            <>
              <NumberField label={t(($) => $.researchTools.stats.sampleMean)} value={mean} onChange={(value) => { invalidate(); setMean(value); }} placeholder={t(($) => $.researchTools.stats.meanPlaceholder)} />
              <NumberField label={t(($) => $.researchTools.stats.sampleSd)} value={sd} onChange={(value) => { invalidate(); setSd(value); }} placeholder={t(($) => $.researchTools.stats.sdPlaceholder)} />
            </>
          ) : (
            <NumberField label={t(($) => $.researchTools.stats.successes)} value={successes} onChange={(value) => { invalidate(); setSuccesses(value); }} placeholder={t(($) => $.researchTools.stats.successesPlaceholder)} />
          )}
          <NumberField label={t(($) => $.researchTools.stats.sampleSizeTitle)} value={n} onChange={(value) => { invalidate(); setN(value); }} placeholder={t(($) => $.researchTools.stats.sampleSizePlaceholder)} />
          <NumberField label={t(($) => $.researchTools.stats.confidencePercent)} value={confidence} onChange={(value) => { invalidate(); setConfidence(value); }} placeholder={t(($) => $.researchTools.stats.confidencePlaceholder)} />
        </div>
      </ToolPane>
      <ToolPane
        title={t(($) => $.researchTools.stats.result)}
        badge={result ? t(($) => $.researchTools.stats.computed) : undefined}
        actions={busy
          ? <ToolStatus state="busy">{t(($) => $.researchTools.stats.working)}</ToolStatus>
          : result
            ? <CopyResultButton lines={copyLines} />
            : undefined}
      >
        <ResultSurface testId="stats-ci-result" busy={busy} error={error} empty={t(($) => $.researchTools.stats.intervalEmpty)}>
          {result ? (
            <div className="w-full text-left">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{intervalMethod}</p>
              <p className="mb-6 font-mono text-2xl tracking-tight text-foreground">{t(($) => $.researchTools.stats.intervalDisplay, { lower: result.lower.toPrecision(4), upper: result.upper.toPrecision(4) })}</p>
              <ResultLine label={t(($) => $.researchTools.stats.pointEstimate)} value={result.pointEstimate.toPrecision(4)} />
              <ResultLine label={t(($) => $.researchTools.stats.standardError)} value={result.standardError.toPrecision(4)} />
              <ResultLine label={marginLabel} value={result.marginOfError.toPrecision(4)} />
              <ResultLine label={t(($) => $.researchTools.stats.criticalValue, { label: result.criticalLabel })} value={result.criticalValue.toFixed(4)} />
            </div>
          ) : null}
        </ResultSurface>
      </ToolPane>
    </ToolSplitView>
  );
}

export function StatsToolView() {
  const { t } = useTranslation(["researchTools"]);
  const activePage = useHomeViewStore((s) => s.page);
  const [tab, setTab] = useState<Tab>("p-value");
  if (activePage !== "stats") return null;
  return (
    <ToolPageShell
      page="stats"
      title={t(($) => $.researchTools.stats.title)}
      subtitle={t(($) => $.researchTools.stats.subtitle)}
      icon={Calculator}
      status={<ToolStatus state="ready">{t(($) => $.researchTools.stats.localCalculation)}</ToolStatus>}
      showTheme
      testId="stats-tool-view"
    >
      {tab === "p-value" && <PValueCalculator tab={tab} onTabChange={setTab} />}
      {tab === "sample-size" && <SampleSizeCalculator tab={tab} onTabChange={setTab} />}
      {tab === "confidence-interval" && <ConfidenceIntervalCalculator tab={tab} onTabChange={setTab} />}
    </ToolPageShell>
  );
}
