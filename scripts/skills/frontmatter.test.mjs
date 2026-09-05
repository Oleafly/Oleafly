import assert from "node:assert/strict";
import test from "node:test";
import {
  injectOleaflyMetadata,
  parseFrontmatterMapping,
  readFrontmatterField,
  validateSkillMarkdown,
  YamlSubsetError,
} from "./frontmatter.mjs";

const OLEAFLY = {
  tier: "shelf",
  phase: "domain",
  domain: "data-tools",
  origin: { repo: "https://example.invalid/repo", commit: "1e5eeff" },
};

const METADATA_LAST = `---
name: alpha
description: An alpha skill.
license: MIT
metadata:
  version: "1.1"
  skill-author: K-Dense Inc.
---

# Alpha
`;

const METADATA_IN_THE_MIDDLE = `---
name: vaexish
description: A skill whose frontmatter ends with another key.
allowed-tools: Read Write
license: MIT license
metadata:
  version: "1.1"
  skill-author: K-Dense Inc.
compatibility: Requires Python 3.10+.
---

# Vaexish
`;

const NO_METADATA = `---
name: bare
description: A skill with no metadata block.
license: MIT
---

# Bare
`;

test("injection keeps a metadata-last frontmatter parseable", () => {
  const output = injectOleaflyMetadata(METADATA_LAST, OLEAFLY);
  const mapping = parseFrontmatterMapping(output);
  assert.equal(mapping.metadata.oleafly.tier, "shelf");
  assert.equal(mapping.metadata.oleafly.origin.commit, "1e5eeff");
  assert.equal(mapping.metadata.version, "1.1");
});

test("injection lands inside metadata when another key follows it", () => {
  const output = injectOleaflyMetadata(METADATA_IN_THE_MIDDLE, OLEAFLY);
  const mapping = parseFrontmatterMapping(output);
  assert.equal(mapping.metadata.oleafly.domain, "data-tools");
  assert.equal(mapping.compatibility, "Requires Python 3.10+.");
  assert.match(output, /metadata:\n {2}version: "1.1"\n {2}skill-author: K-Dense Inc\.\n {2}oleafly:/);
  assert.match(output, /\n {6}commit: 1e5eeff\ncompatibility:/);
});

test("injection creates a metadata block when the frontmatter has none", () => {
  const output = injectOleaflyMetadata(NO_METADATA, OLEAFLY);
  const mapping = parseFrontmatterMapping(output);
  assert.equal(mapping.metadata.oleafly.phase, "domain");
  assert.equal(mapping.license, "MIT");
});

test("injection preserves the upstream bytes ahead of the metadata block", () => {
  const output = injectOleaflyMetadata(METADATA_IN_THE_MIDDLE, OLEAFLY);
  assert.ok(output.startsWith("---\nname: vaexish\n"));
  assert.ok(output.includes('  version: "1.1"\n'));
  assert.ok(output.endsWith("---\n\n# Vaexish\n"));
});

test("the naive splice this replaced produced invalid YAML", () => {
  const closing = METADATA_IN_THE_MIDDLE.lastIndexOf("---\n");
  const spliced = `${METADATA_IN_THE_MIDDLE.slice(0, closing)}  oleafly:\n    tier: shelf\n${METADATA_IN_THE_MIDDLE.slice(closing)}`;
  assert.throws(() => parseFrontmatterMapping(spliced), YamlSubsetError);
});

test("a folded description resolves to its text, not the indicator", () => {
  const folded = `---
name: bids
description: >
  Use this skill when working with BIDS datasets:
  organizing neuroscience data and validating compliance.
license: https://creativecommons.org/licenses/by/4.0/
metadata:
  version: "1.1"
---

# BIDS
`;
  assert.equal(
    readFrontmatterField(folded, "description"),
    "Use this skill when working with BIDS datasets: organizing neuroscience data and validating compliance.",
  );
});

test("a literal description resolves to its text", () => {
  const literal = `---
name: literal
description: |
  First line.
  Second line.
license: MIT
---

# Literal
`;
  assert.equal(readFrontmatterField(literal, "description"), "First line. Second line.");
});

test("block scalars with chomping indicators resolve too", () => {
  const chomped = `---
name: chomped
description: A skill.
compatibility: >-
  Requires Python 3.10+
  and a network connection.
license: MIT
---

# Chomped
`;
  assert.equal(
    readFrontmatterField(chomped, "compatibility"),
    "Requires Python 3.10+ and a network connection.",
  );
});

test("sequences at the parent key indentation parse", () => {
  const withSequence = `---
name: modalish
description: A skill with env vars.
license: Apache-2.0
metadata:
  version: "1.3"
  openclaw:
    envVars:
    - name: MODAL_TOKEN_ID
      required: true
      description: Modal token id.
    - name: MODAL_TOKEN_SECRET
      required: true
      description: Modal token secret.
---

# Modalish
`;
  const mapping = parseFrontmatterMapping(withSequence);
  assert.equal(mapping.metadata.openclaw.envVars.length, 2);
  assert.equal(mapping.metadata.openclaw.envVars[1].name, "MODAL_TOKEN_SECRET");
  const output = injectOleaflyMetadata(withSequence, OLEAFLY);
  assert.equal(parseFrontmatterMapping(output).metadata.oleafly.tier, "shelf");
});

test("quoted scalars keep their escapes", () => {
  const quoted = `---
name: quoted
description: "Trigger when the user says \\"deck\\" or \\"slides\\"."
license: 'Zotero library type: ''user'' or ''group'''
---

# Quoted
`;
  const mapping = parseFrontmatterMapping(quoted);
  assert.equal(mapping.description, 'Trigger when the user says "deck" or "slides".');
  assert.equal(mapping.license, "Zotero library type: 'user' or 'group'");
});

test("validateSkillMarkdown mirrors the Rust field rules", () => {
  assert.doesNotThrow(() => validateSkillMarkdown(METADATA_LAST, "alpha"));
  assert.throws(
    () => validateSkillMarkdown("no frontmatter here\n", "bare"),
    /front matter could not be parsed/,
  );
  const missingDescription = `---
name: alpha
license: MIT
---

# Alpha
`;
  assert.throws(() => validateSkillMarkdown(missingDescription, "alpha"), /missing the field "description"/);
  const multiline = `---
name: alpha
description: |
  First line.
  Second line.
license: MIT
---

# Alpha
`;
  assert.throws(() => validateSkillMarkdown(multiline, "alpha"), /non-empty single line/);
});
