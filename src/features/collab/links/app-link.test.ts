import { describe, expect, it } from "vitest";
import { linkKey, parseAppLink, sameServer } from "./app-link";

const PROJECT = "01920000-0000-7000-8000-0000000000aa";
const OPEN = `oleafly://open?server=https%3A%2F%2Fwww.cs.uni.edu%2Foleafly&project=${PROJECT}`;

describe("parseAppLink", () => {
  it("reads the server address out of an Add to Oleafly link", () => {
    expect(parseAppLink("oleafly://server/add?url=https%3A%2F%2Fwww.cs.uni.edu%2Foleafly")).toEqual({
      kind: "addServer",
      url: "https://www.cs.uni.edu/oleafly",
    });
    expect(parseAppLink(" OLEAFLY://Server/add/?url=https%3A%2F%2Funi.edu ")).toEqual({
      kind: "addServer",
      url: "https://uni.edu",
    });
  });

  it("reads the server and project out of an Open in Oleafly link", () => {
    expect(parseAppLink(OPEN)).toEqual({
      kind: "openProject",
      server: "https://www.cs.uni.edu/oleafly",
      project: PROJECT,
      link: OPEN,
    });
    const shouted = `OLEAFLY://OPEN/?server=https%3a%2f%2funi.edu&project=${PROJECT.toUpperCase()}`;
    expect(parseAppLink(shouted)).toEqual({
      kind: "openProject",
      server: "https://uni.edu",
      project: PROJECT,
      link: shouted,
    });
  });

  it("calls everything else malformed", () => {
    for (const link of [
      "oleafly://server/add",
      "oleafly://server/add?url=",
      "oleafly://server/add?url=%20%20",
      "oleafly://server/remove?url=https%3A%2F%2Funi.edu",
      "oleafly://open?path=/srv/x",
      "oleafly://open?server=https%3A%2F%2Funi.edu",
      "oleafly://open?server=https%3A%2F%2Funi.edu&project=x",
      `oleafly://open?project=${PROJECT}`,
      `oleafly://open?server=ftp%3A%2F%2Funi.edu&project=${PROJECT}`,
      `oleafly://elsewhere?server=https%3A%2F%2Funi.edu&project=${PROJECT}`,
      `https://uni.edu/p/${PROJECT}`,
      "oleafly://",
      "not a link",
    ]) {
      expect(parseAppLink(link), link).toEqual({ kind: "malformed", link });
    }
  });
});

describe("linkKey", () => {
  it("gives every spelling of one link the same key", () => {
    const spellings = [
      OPEN,
      `oleafly://open/?server=https%3A%2F%2Fwww.cs.uni.edu%2Foleafly%2F&project=${PROJECT}`,
      `OLEAFLY://open?project=${PROJECT.toUpperCase()}&server=https%3A%2F%2FWWW.cs.uni.edu%2Foleafly`,
    ];
    const keys = new Set(spellings.map((link) => linkKey(parseAppLink(link))));
    expect(keys.size).toBe(1);
  });

  it("keeps different projects, servers and kinds apart", () => {
    const other = "01920000-0000-7000-8000-0000000000bb";
    const keys = [
      OPEN,
      OPEN.replace(PROJECT, other),
      OPEN.replace("www.cs.uni.edu", "lab.uni.edu"),
      "oleafly://server/add?url=https%3A%2F%2Fwww.cs.uni.edu%2Foleafly",
      "oleafly://nonsense",
      "oleafly://other-nonsense",
    ].map((link) => linkKey(parseAppLink(link)));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("sameServer", () => {
  it("matches addresses that differ only in letter case, default port or a trailing slash", () => {
    expect(sameServer("https://Collab.Uni.edu/", "https://collab.uni.edu")).toBe(true);
    expect(sameServer("https://collab.uni.edu:443/oleafly/", "https://collab.uni.edu/oleafly")).toBe(true);
    expect(sameServer("collab.uni.edu", "https://collab.uni.edu")).toBe(true);
  });

  it("tells different servers apart", () => {
    expect(sameServer("https://collab.uni.edu/a", "https://collab.uni.edu/b")).toBe(false);
    expect(sameServer("https://collab.uni.edu:8443", "https://collab.uni.edu")).toBe(false);
    expect(sameServer("http://collab.uni.edu", "https://collab.uni.edu")).toBe(false);
    expect(sameServer("not a server", "https://collab.uni.edu")).toBe(false);
  });
});
