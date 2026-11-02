import { createElement } from "react";
import { Users } from "@/components/icons/pack";
import { readFacet, writeFacet, type Facet, type FacetState } from "@oleafly/search-query";
import type { CollabLibraryKit, CollabTranslate, ProjectQuery } from "@/components/collab/CollabSlots";

function single(id: string, value: string, negated = false) {
  return { id, term: { key: "is", values: [value], negated } };
}

const SHARED_LOCATION = {
  keys: ["is"],
  values: ["library", "folder", "shared"],
  options: [single("external", "folder"), single("shared", "shared")],
} as const satisfies Facet;

const IN_LIBRARY = { keys: ["is"], values: ["library"], options: [single("library", "library")] } as const satisfies Facet;
const IN_FOLDER = { keys: ["is"], values: ["folder"], options: [single("external", "folder")] } as const satisfies Facet;
const SHARED_FLAG = {
  keys: ["is"],
  values: ["shared"],
  options: [single("shared", "shared"), single("unshared", "shared", true)],
} as const satisfies Facet;

const LOCATION_STATES: Readonly<Record<string, string>> = {
  "library||unshared": "library",
  "|external|": "external",
  "||shared": "shared",
};

function readLocation(query: ProjectQuery): FacetState {
  const parts = [IN_LIBRARY, IN_FOLDER, SHARED_FLAG].map((facet) => readFacet(query, facet));
  if (parts.some((part) => part.kind === "custom")) return { kind: "custom" };
  const key = parts.map((part) => (part.kind === "option" ? part.id : "")).join("|");
  if (key === "||") return { kind: "none" };
  const id = LOCATION_STATES[key];
  return id ? { kind: "option", id } : { kind: "custom" };
}

function writeLocation(
  source: string,
  query: ProjectQuery,
  optionId: string | null,
  reanalyze: (source: string) => ProjectQuery,
): string {
  const cleared = writeFacet(source, query, SHARED_LOCATION, null);
  if (optionId === null) return cleared;
  if (optionId !== "library") return writeFacet(cleared, reanalyze(cleared), SHARED_LOCATION, optionId);
  const library = writeFacet(cleared, reanalyze(cleared), IN_LIBRARY, "library");
  return writeFacet(library, reanalyze(library), SHARED_FLAG, "unshared");
}

export function libraryKit(t: CollabTranslate): CollabLibraryKit {
  return {
    kind: t(($) => $.collab.library.kind),
    share: t(($) => $.collab.share.button),
    copyAndShare: t(($) => $.collab.share.copyAndShare),
    location: t(($) => $.collab.library.location),
    libraryLocation: t(($) => $.collab.library.locationNotShared),
    openLink: t(($) => $.collab.library.openLink.menu),
    extension: {
      is: [
        {
          value: "shared",
          meta: { label: t(($) => $.collab.library.flag), icon: createElement(Users, { className: "size-4" }) },
          test: (project) => Boolean(project.shared),
        },
      ],
    },
    readLocation,
    writeLocation,
  };
}
