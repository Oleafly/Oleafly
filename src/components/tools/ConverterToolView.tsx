import { useEffect, useMemo, useRef, useState } from "react";
import { languageForPath } from "@oleafly/editor";
import {
  Check,
  CloudDownload,
  Copy,
  Download,
  FileArchive,
  FileText,
  FolderPlus,
  Image as ImageIcon,
  Loader2,
  RotateCcw,
  Settings,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CodeField } from "@/components/tools/CodeField";
import { ToolPageShell } from "@/components/tools/ToolPageShell";
import {
  ToolPane,
  ToolSegmentedControl,
  ToolSplitView,
  ToolStatus,
} from "@/components/tools/ToolWorkspace";
import {
  AD_HOC_CONVERTERS,
  projectReadySource,
  runAdHocConverter,
  type ConverterOutput,
} from "@/features/ad-hoc-converters";
import { createProjectFromAdHoc, writeBytesFile } from "@/lib/tauri";
import { pickSavePath } from "@/lib/native-file-dialog";
import { toolById } from "@/lib/tool-catalog";
import { logError } from "@/lib/log";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useFilesStore } from "@/store/files";
import { useHomeViewStore } from "@/store/home-view";
import { useSettingsStore } from "@/store/settings";

type InputMode = "text" | "file";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function stem(fileName: string): string {
  return fileName.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "").trim();
}

function FileDrop({
  file,
  accept,
  label,
  onChange,
}: {
  file: File | null;
  accept?: string;
  label: string;
  onChange: (file: File | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  return (
    <div className="flex min-h-0 flex-1 flex-col p-4">
      <button
        type="button"
        data-testid="converter-file-drop"
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          onChange(event.dataTransfer.files[0] ?? null);
        }}
        className={cn(
          "flex min-h-64 flex-1 flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed px-8 py-12 text-center transition-colors",
          dragging ? "border-primary bg-primary/5" : "border-border bg-muted/20 hover:border-primary/60",
        )}
      >
        <span className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
          {accept?.startsWith("image/") ? <ImageIcon className="size-5" /> : <Upload className="size-5" />}
        </span>
        {file ? (
          <span>
            <span className="block text-sm font-semibold text-foreground">{file.name}</span>
            <span className="mt-1 block text-xs text-muted-foreground">
              {(file.size / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} KB · Click to replace
            </span>
          </span>
        ) : (
          <span>
            <span className="block text-sm font-semibold text-foreground">Drop {label.toLowerCase()} here</span>
            <span className="mt-1 block text-xs text-muted-foreground">or click to choose a file</span>
          </span>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        data-testid="converter-file-input"
        onChange={(event) => {
          onChange(event.target.files?.[0] ?? null);
          event.target.value = "";
        }}
      />
      {file && (
        <Button variant="ghost" size="sm" className="mt-2 self-center" onClick={() => onChange(null)}>
          Remove file
        </Button>
      )}
    </div>
  );
}

async function zipOutput(output: ConverterOutput): Promise<string> {
  const { zipSync } = await import("fflate");
  const entries: Record<string, Uint8Array> = {};
  for (const file of output.files) entries[file.path] = base64ToBytes(file.dataBase64);
  if (output.kind === "text" && output.text !== null) {
    entries[output.fileName] = new TextEncoder().encode(output.text);
  }
  return bytesToBase64(zipSync(entries));
}

async function saveOutput(output: ConverterOutput): Promise<void> {
  const hasBundle = output.kind === "bundle" || output.files.length > 0;
  const fileName = hasBundle ? output.fileName.replace(/\.[^.]+$/, ".zip") : output.fileName;
  const extension = fileName.split(".").pop() || "txt";
  const destination = await pickSavePath({
    defaultPath: fileName,
    filters: [{ name: hasBundle ? "Source bundle" : "Converted file", extensions: [extension] }],
  });
  if (!destination) return;
  let dataBase64: string;
  if (hasBundle) {
    dataBase64 = await zipOutput(output);
  } else if (output.kind === "binary" && output.dataBase64) {
    dataBase64 = output.dataBase64;
  } else {
    dataBase64 = bytesToBase64(new TextEncoder().encode(output.text ?? ""));
  }
  await writeBytesFile(destination, dataBase64);
  toast.success(`Saved ${fileName}`);
}

function openLocalModelSettings(): void {
  const settings = useSettingsStore.getState();
  settings.setSettingsInitialSection("ai");
  settings.setSettingsOpen(true);
}

function ConverterWorkspace({ id }: { id: keyof typeof AD_HOC_CONVERTERS }) {
  const definition = AD_HOC_CONVERTERS[id];
  const catalogTool = toolById(id);
  const editorTheme = useSettingsStore((state) => state.editorTheme);
  const initialMode: InputMode = definition.inputKind === "file" ? "file" : "text";
  const [mode, setMode] = useState<InputMode>(initialMode);
  const [text, setText] = useState(definition.example ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [output, setOutput] = useState<ConverterOutput | null>(null);
  const [busy, setBusy] = useState(false);
  const [projectBusy, setProjectBusy] = useState(false);
  const [progress, setProgress] = useState("Ready");
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const abortController = useRef<AbortController | null>(null);
  const allowsModes = definition.inputKind === "image-or-text" || definition.inputKind === "arxiv";
  const useFile = definition.inputKind === "file" || (allowsModes && mode === "file");
  const sourceName = definition.sourceFileName ?? (id === "equation-to-latex" ? "equation.tex" : "source.txt");
  const sourceLanguage = useMemo(() => () => languageForPath(sourceName) ?? [], [sourceName]);
  const outputSourceName = output?.kind === "bundle"
    ? output.mainFile ?? definition.outputFileName
    : output?.fileName ?? definition.outputFileName;
  const outputLanguage = useMemo(
    () => () => languageForPath(outputSourceName) ?? [],
    [outputSourceName],
  );
  const canConvert = useFile ? Boolean(file) : Boolean(text.trim());

  useEffect(
    () => () => {
      request.current += 1;
      abortController.current?.abort();
    },
    [],
  );

  const resetConversion = () => {
    request.current += 1;
    abortController.current?.abort();
    abortController.current = null;
    setOutput(null);
    setError(null);
    setBusy(false);
    setProgress("Ready");
  };

  const clear = () => {
    resetConversion();
    setText("");
    setFile(null);
  };

  const convert = async () => {
    if (!canConvert || busy) return;
    const current = request.current + 1;
    request.current = current;
    abortController.current?.abort();
    const controller = new AbortController();
    abortController.current = controller;
    setBusy(true);
    setError(null);
    setOutput(null);
    setProgress("Converting");
    try {
      const result = await runAdHocConverter(
        id,
        { text: useFile ? "" : text, file: useFile ? file : null },
        setProgress,
        controller.signal,
      );
      if (request.current !== current) return;
      setOutput(result);
      setProgress("Converted");
    } catch (caught) {
      if (request.current !== current) return;
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
      setProgress("Needs attention");
      void logError(`converter ${id}`, caught);
    } finally {
      if (request.current === current) {
        abortController.current = null;
        setBusy(false);
      }
    }
  };

  const cancel = () => {
    request.current += 1;
    abortController.current?.abort();
    abortController.current = null;
    setBusy(false);
    setProgress("Cancelled");
  };

  const copy = async () => {
    if (!output?.text) return;
    try {
      await navigator.clipboard.writeText(output.text);
      toast.success(`Copied ${definition.outputLabel}`);
    } catch {
      toast.error("Oleafly couldn't copy the converted source.");
    }
  };

  const save = async () => {
    if (!output) return;
    try {
      await saveOutput(output);
    } catch (caught) {
      void logError(`save converter output ${id}`, caught);
      toast.error(
        caught instanceof Error
          ? caught.message
          : "Oleafly couldn't save the converted file.",
      );
    }
  };

  const createProject = async () => {
    if (!output || !definition.projectTarget || !output.text || projectBusy) return;
    setProjectBusy(true);
    try {
      const projectName = stem(file?.name ?? "")
        || (id === "arxiv-to-latex" && text.trim()
          ? `arXiv ${text.trim()}`
          : `${definition.title} result`);
      const projectId = await createProjectFromAdHoc({
        name: projectName,
        target: definition.projectTarget,
        text:
          output.kind === "bundle"
            ? undefined
            : projectReadySource(definition.projectTarget, output.text),
        mainFile: output.kind === "bundle" ? output.mainFile : undefined,
        files: output.files,
      });
      await useFilesStore.getState().refreshProjects();
      await useFilesStore.getState().openProject(projectId);
      toast.success("Project created from the conversion.");
    } catch (caught) {
      void logError(`create project from ${id}`, caught);
      toast.error(caught instanceof Error ? caught.message : "Oleafly couldn't create the project.");
    } finally {
      setProjectBusy(false);
    }
  };

  return (
    <ToolPageShell
      page="converter"
      title={definition.title}
      subtitle={definition.subtitle}
      icon={catalogTool.icon}
      showTheme
      testId="converter-tool-view"
      status={
        <ToolStatus state={busy ? "busy" : error ? "error" : "ready"}>
          {progress}
        </ToolStatus>
      }
      actions={
        busy ? (
          <Button variant="outline" size="sm" onClick={cancel} data-testid="converter-cancel">
            <X /> Cancel
          </Button>
        ) : (
          <Button size="sm" disabled={!canConvert} onClick={() => void convert()} data-testid="converter-run">
            <Check /> Convert
          </Button>
        )
      }
    >
      <ToolSplitView storageId={`converter-${id}`}>
        <ToolPane
          title={definition.inputLabel}
          badge={useFile ? "File" : definition.inputKind === "arxiv" ? "arXiv ID" : "Text"}
          actions={
            <div className="flex items-center gap-2">
              {definition.example && !useFile && (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => {
                    resetConversion();
                    setText(definition.example ?? "");
                  }}
                >
                  Load example
                </Button>
              )}
              <Button variant="ghost" size="xs" onClick={clear}>
                <RotateCcw /> Clear
              </Button>
            </div>
          }
          footer={
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>{definition.inputHint}</span>
              {id === "arxiv-to-latex" && !useFile ? (
                <span className="flex items-center gap-1.5 whitespace-nowrap font-medium text-amber-600 dark:text-amber-400">
                  <CloudDownload className="size-3.5" /> Downloads from arXiv
                </span>
              ) : (
                <span className="flex items-center gap-1.5 whitespace-nowrap font-medium text-emerald-600 dark:text-emerald-400">
                  <ShieldCheck className="size-3.5" /> Runs on this device
                </span>
              )}
            </div>
          }
        >
          {allowsModes && (
            <div className="flex shrink-0 items-center border-b px-4 py-2.5">
              <ToolSegmentedControl
                label="Input type"
                value={mode}
                options={
                  definition.inputKind === "arxiv"
                    ? [
                        { value: "text", label: "arXiv ID", testId: "converter-mode-text" },
                        { value: "file", label: "Saved archive", testId: "converter-mode-file" },
                      ]
                    : [
                        { value: "text", label: "Type equation", testId: "converter-mode-text" },
                        { value: "file", label: "Equation image", testId: "converter-mode-file" },
                      ]
                }
                onChange={(next) => {
                  resetConversion();
                  setMode(next);
                }}
              />
            </div>
          )}
          {useFile ? (
            <FileDrop
              file={file}
              accept={definition.accept}
              label={definition.inputLabel}
              onChange={(next) => {
                resetConversion();
                setFile(next);
              }}
            />
          ) : definition.inputKind === "arxiv" ? (
            <div className="flex min-h-64 flex-1 items-center justify-center p-6">
              <div className="w-full max-w-md space-y-3">
                <label htmlFor="arxiv-converter-id" className="text-sm font-medium">
                  arXiv ID
                </label>
                <Input
                  id="arxiv-converter-id"
                  value={text}
                  onChange={(event) => {
                    resetConversion();
                    setText(event.target.value);
                  }}
                  placeholder="1706.03762"
                  data-testid="converter-text-input"
                />
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Looking up an ID needs a network connection. A saved source archive works fully offline.
                </p>
              </div>
            </div>
          ) : (
            <CodeField
              value={text}
              onChange={(next) => {
                resetConversion();
                setText(next);
              }}
              language={sourceLanguage}
              themeId={editorTheme}
              placeholder="Paste or type source here"
              testId="converter-text-input"
              className="min-h-72 flex-1 overflow-auto text-sm [&_.cm-editor]:h-full"
            />
          )}
        </ToolPane>

        <ToolPane
          title={definition.outputLabel}
          badge={output ? (output.kind === "binary" ? "File" : output.kind === "bundle" ? "Bundle" : "Source") : undefined}
          actions={
            output ? (
              <div className="flex flex-wrap items-center gap-1">
                {output.text && (
                  <Button variant="ghost" size="xs" onClick={() => void copy()}>
                    <Copy /> Copy
                  </Button>
                )}
                <Button variant="outline" size="xs" onClick={() => void save()}>
                  {output.kind === "bundle" || output.files.length > 0 ? <FileArchive /> : <Download />}
                  {output.kind === "bundle" || output.files.length > 0 ? "Save ZIP" : "Save"}
                </Button>
                {definition.projectTarget && output.text && (
                  <Button size="xs" disabled={projectBusy} onClick={() => void createProject()}>
                    {projectBusy ? <Loader2 className="animate-spin" /> : <FolderPlus />} Create project
                  </Button>
                )}
              </div>
            ) : null
          }
          footer={
            output?.note ? <p className="text-xs text-muted-foreground">{output.note}</p> : undefined
          }
        >
          {error ? (
            <div className="flex min-h-72 flex-1 items-center justify-center p-8 text-center">
              <div className="max-w-md">
                <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
                  <FileText className="size-5" />
                </div>
                <h2 className="mt-4 text-sm font-semibold">This conversion needs attention</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{error}</p>
                {/ollama|local model|vision model/i.test(error) && (
                  <Button variant="outline" size="sm" className="mt-4" onClick={openLocalModelSettings}>
                    <Settings /> Open AI settings
                  </Button>
                )}
              </div>
            </div>
          ) : output?.kind === "binary" ? (
            <div className="flex min-h-72 flex-1 items-center justify-center p-8 text-center">
              <div>
                <div className="mx-auto flex size-14 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <FileText className="size-6" />
                </div>
                <h2 className="mt-4 text-sm font-semibold">{output.fileName} is ready</h2>
                <p className="mt-2 text-xs text-muted-foreground">Save the Word document when you are ready.</p>
              </div>
            </div>
          ) : output?.text !== null && output ? (
            <CodeField
              value={output.text}
              onChange={(next) => setOutput({ ...output, text: next })}
              language={outputLanguage}
              themeId={editorTheme}
              readOnly={output.kind === "bundle"}
              testId="converter-output"
              className="min-h-72 flex-1 overflow-auto text-sm [&_.cm-editor]:h-full"
            />
          ) : (
            <div className="flex min-h-72 flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
              <div className="max-w-xs">
                <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-lg bg-muted">
                  <FileText className="size-4" />
                </div>
                Your converted result will appear here.
              </div>
            </div>
          )}
        </ToolPane>
      </ToolSplitView>
    </ToolPageShell>
  );
}

export function ConverterToolView() {
  const page = useHomeViewStore((state) => state.page);
  const id = useHomeViewStore((state) => state.activeConverter);
  if (page !== "converter" || !id) return null;
  return <ConverterWorkspace key={id} id={id} />;
}
