// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { linkHrefForPath, markdownLinkDestination, readableLinkHref } from "../link-destination";
import { createWysiwygExtensions } from "../schema";
import { parseMarkdownBody } from "./parse";
import { serializeMarkdownBody } from "./serialize";

const editors: Editor[] = [];

afterEach(() => {
  while (editors.length > 0) editors.pop()?.destroy();
});

function linksIn(source: string): string[] {
  const hrefs: string[] = [];
  const visit = (node: { marks?: { type: string; attrs?: Record<string, unknown> }[]; content?: unknown[] }) => {
    for (const mark of node.marks ?? []) if (mark.type === "link") hrefs.push(String(mark.attrs?.href));
    for (const child of node.content ?? []) visit(child as typeof node);
  };
  visit(parseMarkdownBody(source).doc);
  return hrefs;
}

describe("Markdown link destinations", () => {
  it("wraps a destination in angle brackets only when Markdown needs it", () => {
    expect(markdownLinkDestination("notes/plan.md")).toBe("notes/plan.md");
    expect(markdownLinkDestination("Сведения о земельном участке.md")).toBe("<Сведения о земельном участке.md>");
    expect(markdownLinkDestination("Сведения.md")).toBe("<Сведения.md>");
    expect(markdownLinkDestination("a (1).md")).toBe("<a (1).md>");
    expect(markdownLinkDestination("a<b>.md")).toBe(String.raw`<a\<b\>.md>`);
    expect(markdownLinkDestination(String.raw`a\b.md`)).toBe(String.raw`a\\b.md`);
    expect(markdownLinkDestination("")).toBe("<>");
  });

  it("keeps hrefs encoded in the document and readable in the note", () => {
    expect(linkHrefForPath("Сведения о.md")).toBe("%D0%A1%D0%B2%D0%B5%D0%B4%D0%B5%D0%BD%D0%B8%D1%8F%20%D0%BE.md");
    expect(linkHrefForPath("a#b?.md", "#план")).toBe("a%23b%3F.md#%D0%BF%D0%BB%D0%B0%D0%BD");
    expect(readableLinkHref("a%23b%3F.md#%D0%BF%D0%BB%D0%B0%D0%BD")).toBe("a%23b%3F.md#план");
    expect(readableLinkHref("https://example.com/a%20b")).toBe("https://example.com/a%20b");
    expect(readableLinkHref("100%.md")).toBe("100%.md");
    expect(linksIn("[land](<Сведения о.md>) [c](https://example.com/a b)")).toEqual([
      "%D0%A1%D0%B2%D0%B5%D0%B4%D0%B5%D0%BD%D0%B8%D1%8F%20%D0%BE.md",
    ]);
  });

  it("writes an edited paragraph's links back the way the note had them", () => {
    const body =
      'See [the land notes](<Сведения о земельном участке.md>), [c](<c d.md> "Title"), [d](notes/plan.md#Goals) and <https://example.com>.';
    expect(serializeMarkdownBody(parseMarkdownBody(body).doc)).toBe(body);
  });

  it("makes percent-encoded paths readable without changing what they point to", () => {
    expect(serializeMarkdownBody(parseMarkdownBody("[b](a%20b.md) [c](a%23b.md) [d](https://example.com/a%20b)").doc)).toBe(
      "[b](<a b.md>) [c](a%23b.md) [d](https://example.com/a%20b)",
    );
  });

  it("writes angle brackets for a destination that needs them", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "go", marks: [{ type: "link", attrs: { href: "My File.md" } }] }],
        },
      ],
    };
    expect(serializeMarkdownBody(doc)).toBe("[go](<My File.md>)");
  });

  it("still refuses script links", () => {
    expect(linksIn("[x](javascript:alert(1)) [y](JAVASCRIPT:alert(1))")).toEqual([]);
  });
});

describe("links on the app's own origin in Visual mode", () => {
  function visualEditor(): Editor {
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: createWysiwygExtensions({
        localizeLinkHref: (href) =>
          href.startsWith("http://tauri.localhost/")
            ? linkHrefForPath(decodeURIComponent(href.slice("http://tauri.localhost/".length)))
            : null,
      }),
      content: "<p>hello world</p>",
    });
    editors.push(editor);
    return editor;
  }

  function hrefs(editor: Editor): string[] {
    const found: string[] = [];
    editor.state.doc.descendants((node) => {
      for (const mark of node.marks) if (mark.type.name === "link") found.push(String(mark.attrs.href));
    });
    return found;
  }

  it("stores a relative path when a link is set from the link field", () => {
    const editor = visualEditor();
    editor.chain().setTextSelection({ from: 1, to: 6 }).setLink({ href: "http://tauri.localhost/notes/b%20c.md" }).run();
    expect(hrefs(editor)).toEqual(["notes/b%20c.md"]);
    expect(editor.storage.markdown.getMarkdown()).toBe("[hello](<notes/b c.md>) world");
  });

  it("stores a relative path when a copied or dragged preview link arrives as HTML", () => {
    const editor = visualEditor();
    editor.commands.insertContentAt(
      7,
      '<a href="http://tauri.localhost/%D0%A1%D0%B2.md">Св</a> <a href="https://example.com/x">site</a>',
    );
    expect(hrefs(editor)).toEqual(["%D0%A1%D0%B2.md", "https://example.com/x"]);
    expect(editor.storage.markdown.getMarkdown()).toContain("[Св](<Св.md>)");
  });
});

describe("links copied from the preview on macOS and Linux", () => {
  const MAC = "tauri://localhost/";
  function visualEditor(open: (href: string) => boolean = () => false): Editor {
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: createWysiwygExtensions({
        localizeLinkHref: (href) =>
          href.startsWith(MAC) && href.length > MAC.length ? linkHrefForPath(decodeURIComponent(href.slice(MAC.length))) : null,
        openLinkHref: open,
      }),
      content: "<p>hello world</p>",
    });
    editors.push(editor);
    return editor;
  }

  it("takes the app's tauri: address from the link field and stores a relative path", () => {
    const editor = visualEditor();
    expect(editor.chain().setTextSelection({ from: 1, to: 6 }).setLink({ href: `${MAC}notes/b%20c.md` }).run()).toBe(true);
    expect(editor.storage.markdown.getMarkdown()).toBe("[hello](<notes/b c.md>) world");
  });

  it("keeps a pasted preview link instead of dropping it", () => {
    const editor = visualEditor();
    editor.commands.insertContentAt(7, `<a href="${MAC}%D0%A1%D0%B2.md">Св</a> `);
    expect(editor.storage.markdown.getMarkdown()).toBe("hello [Св](<Св.md>) world");
  });

  it("still refuses a tauri: address that names no project file", () => {
    const editor = visualEditor();
    expect(editor.chain().setTextSelection({ from: 1, to: 6 }).setLink({ href: MAC }).run()).toBe(false);
    expect(editor.chain().setTextSelection({ from: 1, to: 6 }).setLink({ href: "javascript:alert(1)" }).run()).toBe(false);
  });
});

describe("following links in Visual mode", () => {
  function editorWith(content: string, open: (href: string) => boolean): Editor {
    const editor = new Editor({
      element: document.body.appendChild(document.createElement("div")),
      extensions: createWysiwygExtensions({ openLinkHref: open }),
      content,
    });
    editors.push(editor);
    return editor;
  }

  function click(editor: Editor, selector: string, modifiers: MouseEventInit = {}): boolean {
    const anchor = editor.view.dom.querySelector(selector) as HTMLElement;
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...modifiers });
    let handled = false;
    editor.view.someProp("handleClick", (handle) => {
      handled ||= Boolean(handle(editor.view, 1, Object.defineProperty(event, "target", { value: anchor })));
      return handled;
    });
    return handled;
  }

  it("does not send a project link to the system browser", () => {
    const editor = editorWith('<p><a href="notes/plan.md">plan</a> <a href="https://example.com">site</a></p>', () => true);
    // The shell plugin opens `target="_blank"` links in the browser; a relative
    // href resolves to the app's own address there, a page that does not exist.
    expect(editor.view.dom.querySelector('a[href="notes/plan.md"]')?.getAttribute("target")).toBeNull();
    expect(editor.view.dom.querySelector('a[href="https://example.com"]')?.getAttribute("target")).toBe("_blank");
  });

  it("opens the project file on Mod+click, and leaves a plain click for editing", () => {
    const opened: string[] = [];
    const editor = editorWith('<p><a href="notes/my%20plan.md">plan</a> <a href="https://example.com">site</a></p>', (href) => {
      opened.push(href);
      return true;
    });
    expect(click(editor, 'a[href="notes/my%20plan.md"]')).toBe(false);
    expect(click(editor, 'a[href="notes/my%20plan.md"]', { metaKey: true })).toBe(true);
    expect(click(editor, 'a[href="notes/my%20plan.md"]', { ctrlKey: true })).toBe(true);
    expect(click(editor, 'a[href="https://example.com"]', { metaKey: true })).toBe(false);
    expect(opened).toEqual(["notes/my%20plan.md", "notes/my%20plan.md"]);
  });
});

describe("Markdown image destinations", () => {
  it("writes an edited image's path back the way the note had it", () => {
    const body = '![fig](<figures/my fig.png>)\n\n![р](<рис.png> "Рисунок")\n\n![a](figures/a.png)\n\n![w](https://example.com/a%20b.png)';
    expect(serializeMarkdownBody(parseMarkdownBody(body).doc)).toBe(body);
  });

  it("makes a percent-encoded image path readable and keeps parentheses safe", () => {
    expect(serializeMarkdownBody(parseMarkdownBody("![a](a%20b.png)\n\n![b](<c (1).png>)").doc)).toBe(
      "![a](<a b.png>)\n\n![b](<c (1).png>)",
    );
  });
});
