import { describe, expect, it } from "vitest";
import { linkKey, parseAppLink, pastedProjectLink, sameServer } from "./app-link";

const PROJECT = "01920000-0000-7000-8000-0000000000aa";
const OPEN = `oleafly://open?server=https%3A%2F%2Fwww.cs.uni.edu%2Foleafly&project=${PROJECT}`;
const FILE = "01920000-0000-7000-8000-0000000000f1";
const THREAD = "01920000-0000-7000-8000-0000000000c1";

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

  it("reads the file and thread out of a link to a comment", () => {
    const link = `${OPEN}&file=${FILE}&thread=${THREAD}`;
    expect(parseAppLink(link)).toEqual({
      kind: "openProject",
      server: "https://www.cs.uni.edu/oleafly",
      project: PROJECT,
      link,
      comment: { fileId: FILE, threadId: THREAD },
    });
  });

  it("opens just the project when the comment part of a link is broken", () => {
    for (const tail of [
      `&thread=${THREAD}`,
      `&file=${FILE}`,
      `&file=${FILE}&thread=not-a-thread`,
      `&file=..%2Fsecret&thread=${THREAD}`,
    ]) {
      const parsed = parseAppLink(`${OPEN}${tail}`);
      expect(parsed, tail).toEqual({
        kind: "openProject",
        server: "https://www.cs.uni.edu/oleafly",
        project: PROJECT,
        link: `${OPEN}${tail}`,
      });
      expect(parsed, tail).not.toHaveProperty("comment");
    }
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
      `${OPEN}&file=${FILE}&thread=${THREAD}`,
      `${OPEN}&file=${FILE}&thread=${other}`,
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

describe("pastedProjectLink", () => {
  const project = "0192A0B0-0000-7000-8000-0000000000AA";
  const id = project.toLowerCase();

  it("turns the web address of a project page into the app link that opens it", () => {
    const opened = pastedProjectLink(`https://collab.uni.edu/p/${project}`);
    expect(opened).toBe(`oleafly://open?server=https%3A%2F%2Fcollab.uni.edu&project=${id}`);
    expect(parseAppLink(opened ?? "")).toMatchObject({ kind: "openProject", server: "https://collab.uni.edu", project: id });
  });

  it("keeps a server that lives under a path, and a comment the link points at", () => {
    const file = "01920000-0000-7000-8000-0000000000f1";
    const thread = "01920000-0000-7000-8000-0000000000c1";
    const opened = pastedProjectLink(`https://uni.edu/oleafly/p/${id}/?file=${file}&thread=${thread}`);
    expect(parseAppLink(opened ?? "")).toEqual({
      kind: "openProject",
      server: "https://uni.edu/oleafly",
      project: id,
      link: opened,
      comment: { fileId: file, threadId: thread },
    });
  });

  it("passes an app link through unchanged", () => {
    const link = `oleafly://open?server=https%3A%2F%2Fcollab.uni.edu&project=${id}`;
    expect(pastedProjectLink(`  ${link} `)).toBe(link);
  });

  it("says no to anything that isn't a link to a shared project", () => {
    for (const text of [
      "",
      `collab.uni.edu/p/${id}`,
      "https://collab.uni.edu/p/0192a0b0",
      `https://collab.uni.edu/projects/${id}`,
      `ftp://collab.uni.edu/p/${id}`,
      "oleafly://server/add?url=https%3A%2F%2Fcollab.uni.edu",
      "not a link",
    ]) {
      expect(pastedProjectLink(text), text).toBeNull();
    }
  });
});
