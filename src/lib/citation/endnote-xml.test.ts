import { describe, it, expect } from "vitest";
import { parseEndNoteXml } from "./endnote-xml";

const SAMPLE = `<?xml version="1.0"?>
<xml>
<records>
<record>
  <ref-type name="Journal Article">17</ref-type>
  <contributors>
    <authors>
      <author>Smith, Jane</author>
      <author>Doe, John</author>
    </authors>
  </contributors>
  <titles>
    <title>A Great Paper</title>
    <secondary-title>Journal of Things</secondary-title>
  </titles>
  <pages>100-110</pages>
  <volume>10</volume>
  <number>2</number>
  <dates>
    <year>2021</year>
  </dates>
  <electronic-resource-num>10.1000/xyz</electronic-resource-num>
</record>
<record>
  <ref-type name="Book">6</ref-type>
  <contributors>
    <authors>
      <author>Lee, Ann</author>
    </authors>
  </contributors>
  <titles>
    <title>A Great Book</title>
  </titles>
  <publisher>Some Press</publisher>
  <dates>
    <year>2019</year>
  </dates>
</record>
</records>
</xml>
`;

describe("parseEndNoteXml", () => {
  it("parses multiple <record> elements", () => {
    const entries = parseEndNoteXml(SAMPLE);
    expect(entries).toHaveLength(2);
  });

  it("maps ref-type name to a bibtex type and extracts fields", () => {
    const [first] = parseEndNoteXml(SAMPLE);
    expect(first).toMatchObject({
      type: "article",
      fields: {
        title: "A Great Paper",
        author: "Smith, Jane and Doe, John",
        year: "2021",
        journal: "Journal of Things",
        volume: "10",
        number: "2",
        pages: "100--110",
        doi: "10.1000/xyz",
      },
    });
  });

  it("falls back to misc for unrecognized ref-type names", () => {
    const xml = `<records><record><ref-type name="Something Odd">99</ref-type><titles><title>X</title></titles></record></records>`;
    expect(parseEndNoteXml(xml)[0].type).toBe("misc");
  });

  it("skips records with neither a title nor authors", () => {
    const xml = `<records><record><ref-type name="Journal Article">17</ref-type></record></records>`;
    expect(parseEndNoteXml(xml)).toEqual([]);
  });

  it("decodes XML entities and escapes LaTeX-special characters in text fields", () => {
    const xml = `<records><record><ref-type name="Journal Article">17</ref-type><titles><title>A &amp; B: 50% &lt;done&gt;</title></titles></record></records>`;
    expect(parseEndNoteXml(xml)[0].fields.title).toBe("A \\& B: 50\\% <done>");
  });
});
