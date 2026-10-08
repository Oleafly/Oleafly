import { describe, expect, it } from "vitest";
import { plainText } from "./rich-text";

describe("plainText", () => {
  it("drops the rich-text markup Zotero keeps in titles", () => {
    expect(plainText("The ASA Statement on <i>p</i> -Values: Context, Process, and Purpose")).toBe(
      "The ASA Statement on p -Values: Context, Process, and Purpose",
    );
    expect(plainText("<b>Bold</b> and CO<sub>2</sub> at 10<sup>3</sup> K")).toBe("Bold and CO2 at 103 K");
    expect(plainText('<span style="font-variant:small-caps;">Lisp</span> in <span class="nocase">iOS</span>')).toBe(
      "Lisp in iOS",
    );
    expect(plainText("<I>Upper</I> <em>em</em> <strong>strong</strong> <sc>caps</sc> line<br/>break")).toBe(
      "Upper em strong caps linebreak",
    );
  });

  it("decodes entities once, after the markup is gone", () => {
    expect(plainText("Fish &amp; chips &lt;i&gt; &quot;quoted&quot; it&#39;s&nbsp;here")).toBe(
      "Fish & chips <i> \"quoted\" it's here",
    );
    expect(plainText("&amp;lt; stays &#x27;hex&#x27; &#8211; dash")).toBe("&lt; stays 'hex' \u2013 dash");
    expect(plainText("&unknown; &#0; &#x110000;")).toBe("&unknown; &#0; &#x110000;");
  });

  it("collapses whitespace and leaves comparison signs alone", () => {
    expect(plainText("  Deep\n\tlearning   for  <i> all </i>  ")).toBe("Deep learning for all");
    expect(plainText("When n < 5 and m > 3")).toBe("When n < 5 and m > 3");
    expect(plainText("Generic <T> types and a<b and c>d")).toBe("Generic <T> types and a<b and c>d");
    expect(plainText("")).toBe("");
  });
});
