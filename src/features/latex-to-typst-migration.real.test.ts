import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import type { AdHocConversionRequest, CompileResult, CreateAdHocProjectRequest } from "@/lib/tauri";
import { runLatexToTypstMigration, type MigrationDeps } from "./latex-to-typst-migration";

const REAL = process.env.OLEAFLY_MIGRATION_REAL === "1";
const SEEDS = join(__dirname, "..", "..", "fixtures", "research-seeds");

function walk(root: string, directory = root): { path: string; is_dir: boolean }[] {
  return readdirSync(directory).flatMap((name) => {
    const full = join(directory, name);
    const path = relative(root, full).split("\\").join("/");
    return statSync(full).isDirectory() ? [{ path, is_dir: true }, ...walk(root, full)] : [{ path, is_dir: false }];
  });
}

function pandocReport(stderr: string): string[] {
  return stderr
    .split("\n")
    .filter((line) => line.startsWith("[INFO] Skipped") || line.startsWith("[WARNING]"))
    .map((line) => line.replace(/^\[(?:INFO|WARNING)\] /u, "").replace(/ at source\.tex line/u, " at line"));
}

function realDeps(fixture: string): MigrationDeps & { output: () => string } {
  let output = "";
  return {
    output: () => output,
    listFiles: async () => walk(fixture),
    readFileBase64: async (_id, path) => readFileSync(join(fixture, path)).toString("base64"),
    ensurePandoc: async () => true,
    convert: async (request: AdHocConversionRequest) => {
      const workspace = mkdtempSync(join(tmpdir(), "oleafly-migration-pandoc-"));
      writeFileSync(join(workspace, "source.tex"), request.text ?? "");
      const run = spawnSync(
        "pandoc",
        ["--verbose", "--from=latex", "--to=typst", "--standalone", "--number-sections", "--sandbox", "-o", "converted.typ", "--", "source.tex"],
        { cwd: workspace, encoding: "utf8" },
      );
      if (run.status !== 0) throw new Error(run.stderr);
      return {
        kind: "text",
        text: readFileSync(join(workspace, "converted.typ"), "utf8"),
        dataBase64: null,
        fileName: "converted.typ",
        mediaType: "text/x-typst",
        files: [],
        report: pandocReport(run.stderr),
      };
    },
    createProject: async (request: CreateAdHocProjectRequest) => {
      output = mkdtempSync(join(tmpdir(), "oleafly-migration-project-"));
      for (const file of request.files) {
        mkdirSync(dirname(join(output, file.path)), { recursive: true });
        writeFileSync(join(output, file.path), Buffer.from(file.dataBase64, "base64"));
      }
      return output;
    },
    compile: async (projectId: string, mainDoc: string): Promise<CompileResult> => {
      const run = spawnSync("typst", ["compile", mainDoc, "--root", projectId, "--diagnostic-format", "short"], {
        cwd: projectId,
        encoding: "utf8",
      });
      const errors = run.stderr
        .split("\n")
        .map((line) => /^(.+?):(\d+):\d+: (error|warning): (.*)$/u.exec(line))
        .filter((match): match is RegExpExecArray => match !== null)
        .map((match) => ({ file: match[1], line: Number(match[2]), message: match[4], kind: match[3], explanation: null }));
      return {
        ok: run.status === 0,
        has_pdf: run.status === 0,
        output_id: null,
        output_revision: null,
        log: run.stderr,
        errors,
        synctex_path: null,
        out_dir: null,
        compile_time_ms: 0,
      };
    },
  };
}

function available(command: string): boolean {
  try {
    execFileSync(command, ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!REAL || !available("pandoc") || !available("typst"))("LaTeX to Typst migration with real tools", () => {
  it.each(["computational-physics-phd-thesis", "ieee-two-column-journal-article"])(
    "converts the %s seed into a Typst project",
    async (seed) => {
      const deps = realDeps(join(SEEDS, seed));
      const report = await runLatexToTypstMigration(
        { projectId: seed, mainDoc: "main.tex", name: seed, typstVersion: "0.15.1" },
        deps,
      );
      const summary = process.env.OLEAFLY_MIGRATION_SUMMARY;
      if (summary) {
        writeFileSync(
          join(summary, `${seed}.json`),
          JSON.stringify({ output: deps.output(), converted: report.converted, attention: report.attention, compile: report.compile }, null, 2),
        );
      }
      expect(report.converted.sources.length).toBeGreaterThan(1);
      expect(report.compile).not.toBeNull();
    },
    120_000,
  );
});
