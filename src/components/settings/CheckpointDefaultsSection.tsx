import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileClock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  getConfig,
  setCheckpointDefaults,
  type CheckpointPolicy,
} from "@/lib/tauri";

const DEFAULT_POLICY: CheckpointPolicy = {
  mode: "engine_dependencies",
  always_include: [],
  ignored: [],
};

function patternLines(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  ];
}

type PolicyIssue = { kind: "malformed" | "unsupported"; preview: string };
type LoadedPolicy =
  | { state: "supported"; policy: CheckpointPolicy }
  | { state: "issue"; issue: PolicyIssue };

function policyPreview(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return "Stored defaults could not be displayed.";
  }
}

function loadedPolicy(policy: unknown): LoadedPolicy {
  const preview = policyPreview(policy);
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    return { state: "issue", issue: { kind: "malformed", preview } };
  }
  const value = policy as Record<string, unknown>;
  if (typeof value.mode !== "string") {
    return { state: "issue", issue: { kind: "malformed", preview } };
  }
  if (value.mode !== "engine_dependencies") {
    return { state: "issue", issue: { kind: "unsupported", preview } };
  }
  if (
    !Array.isArray(value.always_include) ||
    !value.always_include.every((item) => typeof item === "string") ||
    !Array.isArray(value.ignored) ||
    !value.ignored.every((item) => typeof item === "string")
  ) {
    return { state: "issue", issue: { kind: "malformed", preview } };
  }
  return {
    state: "supported",
    policy: {
      ...value,
      mode: "engine_dependencies",
      always_include: [...new Set(value.always_include.map((item) => item.trim()).filter(Boolean))],
      ignored: [...new Set(value.ignored.map((item) => item.trim()).filter(Boolean))],
    } as CheckpointPolicy,
  };
}

function errorMessage(error: unknown, fallback: string): string {
  if (typeof error === "string" && error.trim()) return error.trim();
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return fallback;
}

export function CheckpointDefaultsSection() {
  const [savedPolicy, setSavedPolicy] = useState<CheckpointPolicy | null>(null);
  const [policyIssue, setPolicyIssue] = useState<PolicyIssue | null>(null);
  const [alwaysInclude, setAlwaysInclude] = useState("");
  const [ignored, setIgnored] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);
  const loadRequest = useRef(0);

  const load = useCallback(async () => {
    const request = ++loadRequest.current;
    setLoading(true);
    setMessage(null);
    try {
      const config = await getConfig();
      if (request !== loadRequest.current) return;
      const policy = loadedPolicy(config.checkpoint_defaults);
      if (policy.state === "issue") {
        setSavedPolicy(null);
        setPolicyIssue(policy.issue);
        setAlwaysInclude("");
        setIgnored("");
      } else {
        setSavedPolicy(policy.policy);
        setPolicyIssue(null);
        setAlwaysInclude(policy.policy.always_include.join("\n"));
        setIgnored(policy.policy.ignored.join("\n"));
      }
    } catch {
      if (request !== loadRequest.current) return;
      setSavedPolicy(null);
      setPolicyIssue(null);
      setMessage({
        kind: "error",
        text: "Couldn't load checkpoint defaults.",
      });
    } finally {
      if (request === loadRequest.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      loadRequest.current += 1;
    };
  }, [load]);

  const nextPolicy = useMemo<CheckpointPolicy | null>(() => {
    if (!savedPolicy) return null;
    return {
      ...savedPolicy,
      mode: "engine_dependencies",
      always_include: patternLines(alwaysInclude),
      ignored: patternLines(ignored),
    };
  }, [alwaysInclude, ignored, savedPolicy]);

  const dirty = Boolean(
    savedPolicy &&
      (savedPolicy.mode !== "engine_dependencies" ||
        alwaysInclude !== savedPolicy.always_include.join("\n") ||
        ignored !== savedPolicy.ignored.join("\n")),
  );

  const save = async () => {
    if (!nextPolicy || !dirty || saving) return;
    setSaving(true);
    setMessage(null);
    try {
      await setCheckpointDefaults(nextPolicy);
      setSavedPolicy(nextPolicy);
      setAlwaysInclude(nextPolicy.always_include.join("\n"));
      setIgnored(nextPolicy.ignored.join("\n"));
      setMessage({ kind: "success", text: "Defaults saved." });
    } catch (error) {
      setMessage({
        kind: "error",
        text: errorMessage(error, "Couldn't save checkpoint defaults."),
      });
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    if (!savedPolicy) return;
    setAlwaysInclude(savedPolicy.always_include.join("\n"));
    setIgnored(savedPolicy.ignored.join("\n"));
    setMessage(null);
  };

  const updateAlwaysInclude = (value: string) => {
    setAlwaysInclude(value);
    setMessage(null);
  };

  const updateIgnored = (value: string) => {
    setIgnored(value);
    setMessage(null);
  };

  const resetToSafePolicy = async () => {
    if (saving) return;
    setSaving(true);
    setMessage(null);
    try {
      await setCheckpointDefaults(DEFAULT_POLICY);
      setSavedPolicy(DEFAULT_POLICY);
      setPolicyIssue(null);
      setAlwaysInclude("");
      setIgnored("");
      setMessage({ kind: "success", text: "Defaults reset." });
    } catch (error) {
      setMessage({
        kind: "error",
        text: errorMessage(error, "Couldn't reset checkpoint defaults."),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      aria-labelledby="checkpoint-defaults-title"
      className="overflow-hidden rounded-xl border bg-card/60"
    >
      <div className="flex items-start gap-2.5 border-b px-4 py-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <FileClock aria-hidden className="size-4" />
        </span>
        <div className="min-w-0">
          <h3 id="checkpoint-defaults-title" className="font-medium">
            Checkpoint defaults
          </h3>
          <p className="text-xs text-muted-foreground">
            New projects start with this policy. Existing projects keep their
            own settings.
          </p>
        </div>
      </div>

      {loading ? (
        <div
          className="flex items-center gap-2 px-4 py-5 text-sm text-muted-foreground"
          role="status"
        >
          <Loader2
            aria-hidden
            className="size-4 animate-spin motion-reduce:animate-none"
          />
          Loading checkpoint defaults...
        </div>
      ) : policyIssue ? (
        <div className="space-y-3 px-4 py-4">
          <p className="text-xs" role="status">
            {policyIssue.kind === "unsupported"
              ? "These defaults use a checkpoint policy this version of Oleafly does not support."
              : "These checkpoint defaults are malformed and cannot be edited safely."}
          </p>
          <section aria-label="Stored checkpoint defaults">
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/35 p-2.5 text-[11px]">
              {policyIssue.preview}
            </pre>
          </section>
          <p className="text-[11px] text-muted-foreground">
            Resetting replaces the stored value with the safe engine dependency policy.
          </p>
          {message ? (
            <p role={message.kind === "error" ? "alert" : "status"} className="text-xs">
              {message.text}
            </p>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={saving}
            onClick={() => void resetToSafePolicy()}
          >
            {saving ? <Loader2 aria-hidden className="size-3.5 animate-spin" /> : null}
            Reset to safe defaults
          </Button>
        </div>
      ) : savedPolicy ? (
        <div className="space-y-3 px-4 py-4">
          <div>
            <label
              htmlFor="checkpoint-defaults-mode"
              className="text-xs font-medium"
            >
              Capture mode
            </label>
            <Input
              id="checkpoint-defaults-mode"
              readOnly
              value="engine_dependencies"
              className="mt-1 h-8 bg-muted/35 font-mono text-xs"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label
                htmlFor="checkpoint-defaults-always-include"
                className="text-xs font-medium"
              >
                Always include
              </label>
              <Textarea
                id="checkpoint-defaults-always-include"
                aria-describedby="checkpoint-defaults-always-include-help"
                value={alwaysInclude}
                disabled={saving}
                placeholder="figures/*.png"
                className="mt-1 min-h-20 font-mono text-xs"
                onChange={(event) => updateAlwaysInclude(event.target.value)}
              />
              <p
                id="checkpoint-defaults-always-include-help"
                className="mt-1 text-[11px] text-muted-foreground"
              >
                Add files even when the document engine does not report them.
              </p>
            </div>

            <div>
              <label
                htmlFor="checkpoint-defaults-ignored"
                className="text-xs font-medium"
              >
                Ignored
              </label>
              <Textarea
                id="checkpoint-defaults-ignored"
                aria-describedby="checkpoint-defaults-ignored-help"
                value={ignored}
                disabled={saving}
                placeholder="scratch/*.tmp"
                className="mt-1 min-h-20 font-mono text-xs"
                onChange={(event) => updateIgnored(event.target.value)}
              />
              <p
                id="checkpoint-defaults-ignored-help"
                className="mt-1 text-[11px] text-muted-foreground"
              >
                If a required file is ignored, the document still compiles but
                Oleafly skips its checkpoint.
              </p>
            </div>
          </div>

          <p className="text-[11px] text-muted-foreground">
            Enter one project-relative pattern per line. Use forward slashes
            with * and ?.
          </p>

          {message ? (
            <p
              role={message.kind === "error" ? "alert" : "status"}
              aria-live={message.kind === "error" ? "assertive" : "polite"}
              className={
                message.kind === "error"
                  ? "text-xs text-destructive"
                  : "text-xs text-muted-foreground"
              }
            >
              {message.text}
            </p>
          ) : null}

          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              disabled={!dirty || saving}
              onClick={() => void save()}
            >
              {saving ? (
                <Loader2
                  aria-hidden
                  className="size-3.5 animate-spin motion-reduce:animate-none"
                />
              ) : null}
              {saving ? "Saving..." : "Save defaults"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!dirty || saving}
              onClick={discard}
            >
              Discard changes
            </Button>
          </div>
        </div>
      ) : (
        <div className="px-4 py-4">
          {message ? (
            <p className="text-sm text-destructive" role="alert">
              {message.text}
            </p>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => void load()}
          >
            Try again
          </Button>
        </div>
      )}
    </section>
  );
}
