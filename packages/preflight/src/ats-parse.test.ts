import { describe, it, expect } from "vitest";
import { simulateAtsParse, atsParseFindings } from "./ats-parse";

const RESUME = [
  "Jane Doe",
  "jane@doe.com | +1 555 123 4567 | https://github.com/jane",
  "Experience",
  "Acme Corp, Software Engineer, 2020-2024",
  "Education",
  "MIT, BS Computer Science, 2016-2020",
  "Skills",
  "TypeScript, Rust, LaTeX",
].join("\n");

const PAPER = ["A Study of Things", "Abstract", "We present a study.", "Introduction", "Prior work..."].join("\n");

describe("simulateAtsParse: field extraction", () => {
  it("pulls out name, email, phone, and links from a resume", () => {
    const p = simulateAtsParse(RESUME);
    expect(p.name).toBe("Jane Doe");
    expect(p.email).toBe("jane@doe.com");
    expect(p.phone).toBeTruthy();
    expect(p.links.some((l) => l.includes("github.com/jane"))).toBe(true);
  });

  it("detects the standard resume sections", () => {
    const p = simulateAtsParse(RESUME);
    const present = (name: string) => p.sections.find((s) => s.name === name)?.present;
    expect(present("Experience")).toBe(true);
    expect(present("Education")).toBe(true);
    expect(present("Skills")).toBe(true);
  });

  it("marks a document with contact + resume sections as a resume", () => {
    expect(simulateAtsParse(RESUME).isResume).toBe(true);
  });

  it("does not treat a research paper as a resume", () => {
    expect(simulateAtsParse(PAPER).isResume).toBe(false);
  });

  it("reports a missing section as not present", () => {
    const noSkills = RESUME.replace("Skills\n", "").replace("TypeScript, Rust, LaTeX", "");
    const p = simulateAtsParse(noSkills);
    expect(p.sections.find((s) => s.name === "Skills")?.present).toBe(false);
  });

  it.each([
    "Projects",
    "Project",
    "PROJECTS",
    "Projects:",
    "Personal Projects",
    "Academic Projects",
    "Selected Projects",
    "Key Projects",
    "Notable Projects",
    "Side Projects",
    "Technical Projects",
    "Relevant Projects",
    "Open Source Projects",
  ])("recognizes %s as a Projects heading", (heading) => {
    const withProjects = `${RESUME}\n${heading}\nBuilt a thing.`;
    const p = simulateAtsParse(withProjects);
    expect(p.sections.find((s) => s.name === "Projects")?.present).toBe(true);
  });
});

describe("atsParseFindings", () => {
  it("emits nothing for a non-resume document", () => {
    expect(atsParseFindings(simulateAtsParse(PAPER))).toHaveLength(0);
  });

  it("is quiet for a clean, complete resume", () => {
    const errors = atsParseFindings(simulateAtsParse(RESUME)).filter((f) => f.severity === "error");
    expect(errors).toHaveLength(0);
  });

  it("flags a resume whose email a parser cannot find", () => {
    const noEmail = RESUME.replace("jane@doe.com | ", "");
    const f = atsParseFindings(simulateAtsParse(noEmail));
    expect(f.some((x) => x.id === "ats-no-email")).toBe(true);
  });

  it("flags a resume whose extracted text has no plausible name", () => {
    const noName = RESUME.replace("Jane Doe\n", "");
    const f = atsParseFindings(simulateAtsParse(noName));
    expect(f.some((x) => x.id === "ats-no-name")).toBe(true);
  });

  it("flags a resume with no detectable Experience section", () => {
    const noExp = RESUME.replace("Experience\n", "").replace("Acme Corp, Software Engineer, 2020-2024", "");
    const f = atsParseFindings(simulateAtsParse(noExp));
    expect(f.some((x) => x.id === "ats-no-experience")).toBe(true);
  });
});
