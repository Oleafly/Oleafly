import { describe, it, expect } from "vitest";
import { parseZoteroRdf } from "./zotero-rdf";

const SAMPLE = `<?xml version="1.0"?>
<rdf:RDF xmlns:z="http://www.zotero.org/namespaces/export#"
  xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:dcterms="http://purl.org/dc/terms/"
  xmlns:bib="http://purl.org/net/biblio#"
  xmlns:foaf="http://xmlns.com/foaf/0.1/">
  <bib:Article rdf:about="#item1">
    <z:itemType>journalArticle</z:itemType>
    <dc:title>A Great Paper</dc:title>
    <bib:authors>
      <rdf:Seq>
        <rdf:li>
          <foaf:Person>
            <foaf:surname>Smith</foaf:surname>
            <foaf:givenname>Jane</foaf:givenname>
          </foaf:Person>
        </rdf:li>
        <rdf:li>
          <foaf:Person>
            <foaf:surname>Doe</foaf:surname>
            <foaf:givenname>John</foaf:givenname>
          </foaf:Person>
        </rdf:li>
      </rdf:Seq>
    </bib:authors>
    <dcterms:isPartOf>
      <bib:Journal rdf:about="#journal1">
        <dc:title>Journal of Things</dc:title>
      </bib:Journal>
    </dcterms:isPartOf>
    <dc:date>2021</dc:date>
    <dc:identifier>DOI 10.1000/xyz</dc:identifier>
  </bib:Article>
  <bib:Book rdf:about="#item2">
    <z:itemType>book</z:itemType>
    <dc:title>A Great Book</dc:title>
    <bib:authors>
      <rdf:Seq>
        <rdf:li>
          <foaf:Person>
            <foaf:surname>Lee</foaf:surname>
            <foaf:givenname>Ann</foaf:givenname>
          </foaf:Person>
        </rdf:li>
      </rdf:Seq>
    </bib:authors>
    <dc:date>2019</dc:date>
    <dc:publisher>
      <foaf:Organization>
        <foaf:name>Some Press</foaf:name>
      </foaf:Organization>
    </dc:publisher>
  </bib:Book>
</rdf:RDF>
`;

describe("parseZoteroRdf", () => {
  it("parses multiple top-level bibliographic records", () => {
    expect(parseZoteroRdf(SAMPLE)).toHaveLength(2);
  });

  it("maps z:itemType to a bibtex type and extracts authors, journal, DOI", () => {
    const [first] = parseZoteroRdf(SAMPLE);
    expect(first.type).toBe("article");
    expect(first.fields.title).toBe("A Great Paper");
    expect(first.fields.author).toBe("Smith, Jane and Doe, John");
    expect(first.fields.year).toBe("2021");
    expect(first.fields.journal).toBe("Journal of Things");
    expect(first.fields.doi).toBe("10.1000/xyz");
  });

  it("handles a record with no journal (book) and reads publisher", () => {
    const [, book] = parseZoteroRdf(SAMPLE);
    expect(book.type).toBe("book");
    expect(book.fields.title).toBe("A Great Book");
    expect(book.fields.author).toBe("Lee, Ann");
    expect(book.fields.year).toBe("2019");
    expect(book.fields.publisher).toBe("Some Press");
    expect(book.fields.journal).toBeUndefined();
  });

  it("returns nothing for non-RDF input rather than throwing", () => {
    expect(() => parseZoteroRdf("not rdf at all")).not.toThrow();
    expect(parseZoteroRdf("not rdf at all")).toEqual([]);
  });
});
