import { analyze, writeFacet } from "@oleafly/search-query";
import { isValidElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { i18n } from "@/i18n";
import type { NoteTagCount } from "@/lib/tauri";
import {
  activeFilterCount,
  buildNoteSearchSchema,
  type NoteSearchState,
  selectedTag,
  tagFilterKey,
  VAULT_FACETS,
  type VaultItem,
  vaultPlan,
  writeTagFilter,
} from "./note-query";
import { tagTone } from "./note-tags";
import type { ArtifactItem, NoteItem } from "./types";
import "./tests/setup";

const CONTEXT = { now: 0 };

function note(id: string, extra: Partial<NoteItem> = {}): NoteItem {
  return { id, title: id, project: "Vision", updatedAt: 0, author: "you", summary: "", ...extra };
}

function artifact(id: string, extra: Partial<ArtifactItem> = {}): ArtifactItem {
  return {
    id,
    taskId: "t",
    path: `${id}.out`,
    title: id,
    kind: "figure",
    projectId: "p-vision",
    project: "Vision",
    updatedAt: 0,
    chat: "c",
    summary: "",
    ...extra,
  };
}

const ITEMS: readonly VaultItem[] = [
  note("masking", { title: "Masking ablation", author: "agent", aliases: ["MAE run"], tags: ["ml"], relatedProjectId: "p-vision" }),
  note("reading", { title: "Reading list", project: "Language", preview: "## Loss curve", tags: ["ml/vision"] }),
  note("lab", { title: "Lab protocol", summary: "Étude du café", tags: ["draft"] }),
  artifact("loss", { title: "Loss curve" }),
  artifact("attention", { title: "Attention map", kind: "html" }),
  artifact("metrics", { title: "Metrics table", kind: "data", project: "Language", projectId: "p-language" }),
];

const TAGS: NoteTagCount[] = [
  { tag: "ml", label: "ML", count: 1, notes: ["masking"] },
  { tag: "ml/vision", label: "ML/Vision", count: 1, notes: ["reading"] },
  { tag: "draft", label: "draft", count: 1, notes: ["lab"] },
];

const STATE: NoteSearchState = { favorites: new Set(["reading"]), tags: TAGS, projects: ["Language", "Vision"] };

function schemaFor(state: Partial<NoteSearchState> = {}) {
  return buildNoteSearchSchema(i18n.t.bind(i18n) as never, { ...STATE, ...state });
}

function planFor(source: string, state: Partial<NoteSearchState> = {}) {
  const schema = schemaFor(state);
  const query = analyze(source, schema, CONTEXT);
  return { schema, query, plan: vaultPlan(query, schema, CONTEXT) };
}

function shown(source: string, state: Partial<NoteSearchState> = {}): string[] {
  const { plan } = planFor(source, state);
  return ITEMS.filter(plan.test).map((item) => item.id);
}

describe("note search schema", () => {
  it("offers the note qualifiers with their values", () => {
    const schema = schemaFor();
    expect(schema.fields.map((field) => field.key)).toEqual(["is", "tag", "kind", "author", "project", "title"]);
    expect(schema.field("is")?.options?.map((option) => option.value)).toEqual(["favorite"]);
    expect(schema.field("tag")?.options?.map((option) => [option.value, option.meta?.label])).toEqual([
      ["ml", "#ML"],
      ["ml/vision", "#ML/Vision"],
      ["draft", "#draft"],
    ]);
    expect(schema.field("kind")?.options?.map((option) => option.value)).toEqual(["note", "figure", "report", "data", "notebook"]);
    expect(schema.field("author")?.options?.map((option) => option.value)).toEqual(["agent", "you"]);
    expect(schema.field("project")?.options?.map((option) => option.value)).toEqual(["Language", "Vision"]);
    expect(schema.field("tags")).toBe(schema.field("tag"));
  });

  it("colours each suggested tag's icon with that tag's tone", () => {
    const classOf = (icon: ReactNode) => (isValidElement<{ className?: string }>(icon) ? icon.props.className : undefined);
    expect(schemaFor().field("tag")?.options?.map((option) => classOf(option.meta?.icon))).toEqual(
      ["ml", "ml/vision", "draft"].map((tag) => `size-4 ${tagTone(tag).icon}`),
    );
  });

  it("offers favorite as the only is: flag and no has: field", () => {
    expect(schemaFor().field("is")?.options?.map((option) => option.value)).toEqual(["favorite"]);
    expect(schemaFor().field("has")).toBeUndefined();
  });
});

describe("note search filters", () => {
  it("keeps or drops favorites, however favorite is spelled", () => {
    expect(shown("is:favorite")).toEqual(["reading"]);
    expect(shown("IS:Favourites")).toEqual(["reading"]);
    expect(shown("-is:starred")).toEqual(["masking", "lab", "loss", "attention", "metrics"]);
  });

  it("matches a tag and the tags under it, from the index or the note heads", () => {
    expect(shown("tag:ml")).toEqual(["masking", "reading"]);
    expect(shown("tag:#ML/")).toEqual(["masking", "reading"]);
    expect(shown("tag:ml/vision")).toEqual(["reading"]);
    expect(shown("tag:mlops")).toEqual([]);
    expect(shown("-tag:ml")).toEqual(["lab", "loss", "attention", "metrics"]);
    expect(shown("tag:draft", { tags: [] })).toEqual([]);
    expect(shown("tag:ml", { tags: null })).toEqual(["masking", "reading"]);
    expect(shown("tag:#")).toHaveLength(ITEMS.length);
  });

  it("filters by kind, counting interactive figures as figures", () => {
    expect(shown("kind:note")).toEqual(["masking", "reading", "lab"]);
    expect(shown("kind:figure")).toEqual(["loss", "attention"]);
    expect(shown("type:data")).toEqual(["metrics"]);
    expect(shown("kind:figure,data")).toEqual(["loss", "attention", "metrics"]);
  });

  it("counts every artifact as made by an agent", () => {
    expect(shown("author:you")).toEqual(["reading", "lab"]);
    expect(shown("author:agent")).toEqual(["masking", "loss", "attention", "metrics"]);
    expect(shown("by:me")).toEqual(["reading", "lab"]);
  });

  it("matches a project by name or by id", () => {
    expect(shown("project:language")).toEqual(["reading", "metrics"]);
    expect(shown("project:p-vision")).toEqual(["masking", "loss", "attention"]);
    expect(shown('project:"vis"')).toEqual([]);
  });

  it("matches titles and aliases with title:", () => {
    expect(shown("title:mask")).toEqual(["masking"]);
    expect(shown("title:mae")).toEqual(["masking"]);
  });

  it("matches words against the title, aliases and preview, or the summary without one", () => {
    expect(shown("  MASK ")).toEqual(["masking"]);
    expect(shown("loss")).toEqual(["reading", "loss"]);
    expect(shown("etude cafe")).toEqual(["lab"]);
    expect(shown('"mae run"')).toEqual(["masking"]);
    expect(shown("lab OR metrics")).toEqual(["lab", "metrics"]);
    expect(shown("")).toHaveLength(ITEMS.length);
  });
});

describe("note search plan", () => {
  it("sends every query the index understood before, minus what is filtered here", () => {
    const { plan } = planFor('Masking "Exact  Phrase" -drop -"no way" tag:#ML/ -TAG:old title:"Big plan" project:p_9 is:Favorite unknown:x');
    expect(plan.fullText).toBe(true);
    expect(plan.searches).toEqual(['Masking "Exact  Phrase" -drop -"no way" tag:#ML/ -tag:old title:"Big plan" unknown:x']);
    expect(planFor("mask is:favorite").plan.searches).toEqual(["mask"]);
    expect(planFor('"open').plan.searches).toEqual(['"open"']);
  });

  it("needs the index only when the query has words", () => {
    for (const source of ["", "is:favorite", "tag:ml", "kind:note author:you", "title:mask", "is:"]) {
      expect(planFor(source).plan.fullText).toBe(false);
    }
    expect(planFor("-draft").plan.fullText).toBe(true);
  });

  it("splits OR, grouped NOT and lists of tags into separate searches", () => {
    expect(planFor("mask OR read").plan.searches).toEqual(["mask", "read"]);
    expect(planFor("(mask OR read) tag:ml").plan.searches).toEqual(["mask tag:ml", "read tag:ml"]);
    expect(planFor("-(mask OR read)").plan.searches).toEqual(["-mask -read"]);
    expect(planFor("-(mask read)").plan.searches).toEqual(["-mask", "-read"]);
    expect(planFor("NOT -mask").plan.searches).toEqual(["mask"]);
    expect(planFor("mask tag:ml,draft").plan.searches).toEqual(["mask tag:ml", "mask tag:draft"]);
    expect(planFor("mask -tag:ml,draft").plan.searches).toEqual(["mask -tag:ml -tag:draft"]);
    expect(planFor("mask OR mask").plan.searches).toEqual(["mask"]);
    expect(planFor("a OR b OR c OR d OR e OR f OR g OR h OR i OR j").plan.branches).toHaveLength(10);
  });

  it("says when a query had more combinations than it searches", () => {
    expect(planFor("(a OR b OR c) (d OR e OR f)").plan.truncated).toBe(false);
    const { plan } = planFor("(a OR b OR c OR d OR e OR f) (g OR h OR i OR j OR k OR l)");
    expect(plan.branches).toHaveLength(32);
    expect(plan.truncated).toBe(true);
  });

  it("keeps each branch's own filters for its hits", () => {
    const { plan } = planFor("(mask is:favorite) OR read OR kind:note");
    expect(plan.branches.map((branch) => branch.search)).toEqual(["mask", "read", null]);
    const reading = ITEMS[1];
    const masking = ITEMS[0];
    expect(plan.branches.map((branch) => branch.keep(reading))).toEqual([true, true, true]);
    expect(plan.branches.map((branch) => branch.keep(masking))).toEqual([false, true, true]);
  });

  it("ignores terms it can't use", () => {
    expect(planFor("is: mask").plan.searches).toEqual(["mask"]);
    expect(planFor("kind:poem").plan.branches).toEqual([]);
  });
});

describe("note search facets", () => {
  function written(source: string, tag: string | null): string {
    const { query } = planFor(source);
    return writeTagFilter(source, query, tag);
  }

  it("reads the one tag the query filters by", () => {
    expect(selectedTag(planFor("mask tag:ML").query)).toBe("ml");
    expect(selectedTag(planFor("tag:#ml/vision/").query)).toBe("ml/vision");
    expect(selectedTag(planFor("tag:ml tag:draft").query)).toBeNull();
    expect(selectedTag(planFor("-tag:ml").query)).toBeNull();
    expect(selectedTag(planFor("tag:ml,draft").query)).toBeNull();
    expect(selectedTag(planFor("mask").query)).toBeNull();
  });

  it("swaps the tag filter in and out of the query", () => {
    expect(written("", "#ML/Vision")).toBe("tag:ml/vision");
    expect(written("mask", "ml")).toBe("mask tag:ml");
    expect(written("mask tag:draft", "ml")).toBe("mask tag:ml");
    expect(written("mask tag:ml", null)).toBe("mask");
    expect(written("a OR b", "ml")).toBe("(a OR b) tag:ml");
    expect(tagFilterKey(" ##Draft/ ")).toBe("draft");
  });

  it("writes kind and author chips into the query and counts the filters", () => {
    const { query } = planFor("mask");
    const kind = writeFacet("mask", query, VAULT_FACETS.kind, "figure");
    expect(kind).toBe("mask kind:figure");
    const both = writeFacet(kind, planFor(kind).query, VAULT_FACETS.author, "you");
    expect(both).toBe("mask kind:figure author:you");
    expect(activeFilterCount(planFor(both).query)).toBe(2);
    expect(activeFilterCount(planFor("mask is: tag:ml").query)).toBe(1);
  });
});
