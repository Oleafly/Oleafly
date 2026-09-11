import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useFilesStore } from "@/store/files";
import { resolveEffectiveMainDoc } from "@/lib/tex-root";
import { canPrepareAccessible, gateDocument, prepGate } from "./prep-capability";

describe("accessible source preparation capability", () => {
  it("is strictly LaTeX-only and fail closed", () => {
    expect(canPrepareAccessible(true, "latex")).toBe(true);
    expect(canPrepareAccessible(true, "none")).toBe(false);
    expect(canPrepareAccessible(false, "latex")).toBe(false);
  });
});

describe("prepGate", () => {
  it("does not offer preparation for a class that cannot be tagged, and names it", () => {
    const gate = prepGate("\\documentclass{IEEEtran}\n\\begin{document}x\\end{document}");
    expect(gate.offer).toBe(false);
    expect(gate.classSeverity).toBe("block");
    expect(gate.classNotice).toContain("IEEEtran");
  });

  it("does not offer preparation for a class the LaTeX Project will not support", () => {
    const gate = prepGate("\\documentclass{beamer}");
    expect(gate.offer).toBe(false);
    expect(gate.classNotice).toContain("beamer");
    expect(gate.classNotice).toContain("ltx-talk");
  });

  it("offers preparation for a compatible class and lists packages that will not tag", () => {
    const gate = prepGate("\\documentclass{article}\n\\usepackage{float}\n\\usepackage{amsmath}");
    expect(gate.offer).toBe(true);
    expect(gate.classSeverity).toBeNull();
    expect(gate.classNotice).toBeNull();
    expect(gate.packageNotice).toContain("float");
    expect(gate.packageNotice).not.toContain("amsmath");
  });

  it("offers preparation with a caution for a partially compatible class", () => {
    const gate = prepGate("\\documentclass{acmart}");
    expect(gate.offer).toBe(true);
    expect(gate.classSeverity).toBe("caution");
    expect(gate.classNotice).toContain("acmart");
  });

  it("says nothing about packages when every one of them tags", () => {
    const gate = prepGate("\\documentclass{article}\n\\usepackage{booktabs}");
    expect(gate.packageNotice).toBeNull();
    expect(gate.packageCautionNotice).toBeNull();
  });

  it("shows the cautions for packages that only partly tag", () => {
    const gate = prepGate("\\documentclass{article}\n\\usepackage{enumitem}\n\\usepackage{amsmath}");
    expect(gate.offer).toBe(true);
    expect(gate.packageNotice).toContain("enumitem");
    expect(gate.packageCautionNotice).toContain("amsmath");
    expect(gate.packageCautionNotice).toContain("only partly tag");
  });

  it("cautions about a package with no recorded verdict instead of passing it", () => {
    const gate = prepGate("\\documentclass{article}\n\\usepackage{oleafly-invented-package}");
    expect(gate.packageNotice).toBeNull();
    expect(gate.packageCautionNotice).toContain("No tagging verdict is recorded");
    expect(gate.packageCautionNotice).toContain("oleafly-invented-package");
    expect(gate.packageCautionNotice).toMatch(/^[A-Z]/);
  });

  it("ignores a class and a package that are only there in a comment", () => {
    const gate = prepGate("% \\documentclass{IEEEtran}\n\\documentclass{article}\n% \\usepackage{float}");
    expect(gate.offer).toBe(true);
    expect(gate.classNotice).toBeNull();
    expect(gate.packageNotice).toBeNull();
  });

  it("carries the provenance of the compatibility data", () => {
    const gate = prepGate("\\documentclass{article}");
    expect(gate.source).toContain("latex3/tagging-project");
    expect(gate.retrieved).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("gateDocument", () => {
  const chapter = "\\section{Results}\nSome prose with no class of its own.";
  const stored = (files: Record<string, string>) =>
    Object.fromEntries(Object.entries(files).map(([path, content]) => [path, { content, dirty: false }]));

  it("gates on the main document, not on the chapter that is open", () => {
    const gated = gateDocument(
      "main.tex",
      stored({ "main.tex": "\\documentclass{IEEEtran}\n\\begin{document}\\input{chapter}\\end{document}" }),
      chapter,
    );
    expect(gated.origin).toBe("main");
    expect(prepGate(gated.source).offer).toBe(false);
    expect(prepGate(gated.source).classNotice).toContain("IEEEtran");
  });

  it("does not let an included chapter look like a clean document", () => {
    expect(prepGate(chapter).offer).toBe(true);
    expect(
      prepGate(gateDocument("main.tex", stored({ "main.tex": "\\documentclass{IEEEtran}" }), chapter).source).offer,
    ).toBe(false);
  });

  it("falls back to the open file when the main document is not loaded", () => {
    expect(gateDocument("main.tex", {}, chapter)).toEqual({ source: chapter, origin: "active" });
    expect(gateDocument("main.tex", stored({ "main.tex": "   " }), chapter)).toEqual({
      source: chapter,
      origin: "active",
    });
    expect(gateDocument("", stored({ "main.tex": "\\documentclass{IEEEtran}" }), chapter)).toEqual({
      source: chapter,
      origin: "active",
    });
  });

  it("ignores a class and a package the main document only mentions in a comment", () => {
    const gated = gateDocument(
      "main.tex",
      stored({
        "main.tex": "% \\documentclass{IEEEtran}\n\\documentclass{article}\n% \\usepackage{float}\n",
      }),
      chapter,
    );
    expect(prepGate(gated.source).offer).toBe(true);
    expect(prepGate(gated.source).classNotice).toBeNull();
    expect(prepGate(gated.source).packageNotice).toBeNull();
  });

  it("reads the class and the packages out of a preamble that is split across files", () => {
    const gated = gateDocument(
      "main.tex",
      stored({
        "main.tex": "\\input{setup/class}\n\\input{setup/packages.tex}\n\\begin{document}\\input{body}\\end{document}",
        "setup/class.tex": "\\documentclass{IEEEtran}\n",
        "setup/packages.tex": "\\usepackage{float}\n% \\usepackage{amsmath}\n",
        "body.tex": "\\documentclass{article}\n",
      }),
      chapter,
    );
    const gate = prepGate(gated.source);
    expect(gate.offer).toBe(false);
    expect(gate.classNotice).toContain("IEEEtran");
    expect(gate.packageNotice).toContain("float");
    expect(gate.packageCautionNotice).toBeNull();
  });

  it("reads the preamble past a body marker that is only there in a comment", () => {
    const gated = gateDocument(
      "main.tex",
      stored({
        "main.tex":
          "% \\begin{document}\n\\documentclass{IEEEtran}\n\\usepackage{float}\n\\begin{document}\nBody\n\\end{document}\n",
      }),
      chapter,
    );
    const gate = prepGate(gated.source);
    expect(gate.offer).toBe(false);
    expect(gate.classNotice).toContain("IEEEtran");
    expect(gate.packageNotice).toContain("float");
  });

  it("keeps an escaped percent from hiding the real body marker", () => {
    const gated = gateDocument(
      "main.tex",
      stored({
        "main.tex":
          "\\documentclass{article}\n\\title{100\\% faster} \\begin{document}\n\\usepackage{float}\n\\end{document}\n",
      }),
      chapter,
    );
    const gate = prepGate(gated.source);
    expect(gate.offer).toBe(true);
    expect(gate.packageNotice).toBeNull();
  });

  it("does not loop forever on a preamble that includes itself", () => {
    const gated = gateDocument(
      "main.tex",
      stored({
        "main.tex": "\\documentclass{article}\n\\input{setup}\n",
        "setup.tex": "\\usepackage{float}\n\\input{main}\n",
      }),
      chapter,
    );
    expect(prepGate(gated.source).packageNotice).toContain("float");
  });
});

describe("gateDocument on the project the compile path would use", () => {
  const resetState = {
    projectId: null,
    projectName: "",
    mainDoc: "main.tex",
    activePath: null,
    tree: [],
    files: {},
  };

  beforeEach(() => useFilesStore.setState(resetState));
  afterEach(() => useFilesStore.setState(resetState));

  const gateForProject = (activeContent: string) =>
    gateDocument(resolveEffectiveMainDoc().mainDoc, useFilesStore.getState().files, activeContent);

  it("follows a magic root comment to the document that really compiles", () => {
    const chapter = "% !TEX root = ../thesis.tex\n\\section{Results}\n";
    useFilesStore.setState({
      projectId: "project",
      mainDoc: "main.tex",
      activePath: "chapters/ch1.tex",
      tree: [
        { path: "chapters/ch1.tex", is_dir: false },
        { path: "main.tex", is_dir: false },
        { path: "thesis.tex", is_dir: false },
      ],
      files: {
        "chapters/ch1.tex": { content: chapter, dirty: false },
        "main.tex": { content: "\\documentclass{article}\n", dirty: false },
        "thesis.tex": { content: "\\documentclass{IEEEtran}\n", dirty: false },
      },
    });

    const gated = gateForProject(chapter);
    expect(gated.origin).toBe("main");
    expect(prepGate(gated.source).offer).toBe(false);
    expect(prepGate(gated.source).classNotice).toContain("IEEEtran");
  });

  it("gates on the open file, and says so, when no main document is loaded", () => {
    const open = "\\documentclass{article}\n";
    useFilesStore.setState({
      projectId: "project",
      mainDoc: "",
      activePath: "scratch.tex",
      tree: [{ path: "scratch.tex", is_dir: false }],
      files: { "scratch.tex": { content: open, dirty: false } },
    });

    expect(gateForProject(open)).toEqual({ source: open, origin: "active" });
  });
});
