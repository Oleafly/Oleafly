# mdast-util-newline-to-break

[![Build][build-badge]][build]
[![Coverage][coverage-badge]][coverage]
[![Downloads][downloads-badge]][downloads]
[![Size][size-badge]][size]
[![Sponsors][sponsors-badge]][collective]
[![Backers][backers-badge]][collective]
[![Chat][chat-badge]][chat]

**[mdast][]** utility to support hard breaks without needing spaces or
escapes (turns enters into `<br>`s).

## Contents

*   [What is this?](#what-is-this)
*   [When should I use this?](#when-should-i-use-this)
*   [Install](#install)
*   [Use](#use)
*   [API](#api)
    *   [`newlineToBreak(tree)`](#newlinetobreaktree)
*   [Syntax](#syntax)
*   [Syntax tree](#syntax-tree)
*   [Types](#types)
*   [Compatibility](#compatibility)
*   [Security](#security)
*   [Related](#related)
*   [Contribute](#contribute)
*   [License](#license)

## What is this?

This package is a utility that takes an [mdast][] tree and turns soft line
endings (enters) into hard breaks (`<br>`s)

This package is used inside [remark-breaks][], which focusses on making it
easier to transform content by abstracting these internals away.

## When should I use this?

This plugin is useful if you want to display user content closer to how it was
authored, because when a user includes a line ending, it’ll show as such.
GitHub does this in a few places (comments, issues, PRs, and releases), but it’s
not semantic according to HTML and not compliant to markdown.
Markdown already has two ways to include hard breaks, namely trailing spaces and
escapes (note that `␠` represents a normal space):

```markdown
lorem␠␠
ipsum

lorem\
ipsum
```

Both will turn into `<br>`s.
If you control who authors content or can document how markdown works, it’s
recommended to use escapes instead.

## Install

This package is [ESM only][esm].
In Node.js (version 16+), install with [npm][]:

```sh
npm install mdast-util-newline-to-break
```

In Deno with [`esm.sh`][esmsh]:

```js
import {newlineToBreak} from 'https://esm.sh/mdast-util-newline-to-break@2'
```

In browsers with [`esm.sh`][esmsh]:

```html
<script type="module">
  import {newlineToBreak} from 'https://esm.sh/mdast-util-newline-to-break@2?bundle'
</script>
```

## Use

Say we have the following file, `example.md` (note: there are no spaces after
`a`):

```markdown
This is a
paragraph.
```

And our module, `example.js`, looks as follows:

```js
import fs from 'node:fs/promises'
import {fromMarkdown} from 'mdast-util-from-markdown'
import {newlineToBreak} from 'mdast-util-newline-to-break'
import {toMarkdown} from 'mdast-util-to-markdown'

const doc = await fs.readFile('example.md')
const tree = fromMarkdown(doc)

newlineToBreak(tree)

console.log(toMarkdown(tree))
```

Now, running `node example.js` yields:

```md
This is a\
paragraph.
```

## API

This package exports the identifier [`newlineToBreak`][api-newline-to-break].
There is no default export.

### `newlineToBreak(tree)`

Turn normal line endings into hard breaks.

#### Parameters

*   `tree` ([`Node`][node])
    — tree to modify

## Syntax

This utility looks for markdown line endings (`\r`, `\n`, and `\r\n`).

## Syntax tree

This utility adds mdast [`Break`][break] nodes to the syntax tree.
These are the same nodes that represent breaks with spaces or escapes.

## Types

This package is fully typed with [TypeScript][].
There are no extra exported types.

## Compatibility

Projects maintained by the unified collective are compatible with maintained
versions of Node.js.

When we cut a new major release, we drop support for unmaintained versions of
Node.
This means we try to keep the current release line,
`mdast-util-newline-to-break@^2`, compatible with Node.js 16.

## Security

Use of `mdast-util-newline-to-break` does not involve **[hast][]** or user
content so there are no openings for [cross-site scripting (XSS)][xss] attacks.

## Related

*   [`remark-breaks`](https://github.com/remarkjs/remark-breaks)
    — provide this utility as a [unified][] [remark][] plugin.
*   [`remark-gfm`](https://github.com/remarkjs/remark-gfm)
    — support GFM (autolink literals, footnotes, strikethrough, tables,
    tasklists)
*   [`remark-github`](https://github.com/remarkjs/remark-github)
    — link references to commits, issues, and users, in the same way that
    GitHub does

## Contribute

See [`contributing.md`][contributing] in [`syntax-tree/.github`][health] for
ways to get started.
See [`support.md`][support] for ways to get help.

This project has a [code of conduct][coc].
By interacting with this repository, organization, or community you agree to
abide by its terms.

## License

[MIT][license] © [Titus Wormer][author]

<!-- Definitions -->

[build-badge]: https://github.com/syntax-tree/mdast-util-newline-to-break/workflows/main/badge.svg

[build]: https://github.com/syntax-tree/mdast-util-newline-to-break/actions

[coverage-badge]: https://img.shields.io/codecov/c/github/syntax-tree/mdast-util-newline-to-break.svg

[coverage]: https://codecov.io/github/syntax-tree/mdast-util-newline-to-break

[downloads-badge]: https://img.shields.io/npm/dm/mdast-util-newline-to-break.svg

[downloads]: https://www.npmjs.com/package/mdast-util-newline-to-break

[esm]: https://gist.github.com/sindresorhus/a39789f98801d908bbc7ff3ecc99d99c

[size-badge]: https://img.shields.io/badge/dynamic/json?label=minzipped%20size&query=$.size.compressedSize&url=https://deno.bundlejs.com/?q=mdast-util-newline-to-break

[size]: https://bundlejs.com/?q=mdast-util-newline-to-break

[sponsors-badge]: https://opencollective.com/unified/sponsors/badge.svg

[backers-badge]: https://opencollective.com/unified/backers/badge.svg

[collective]: https://opencollective.com/unified

[chat-badge]: https://img.shields.io/badge/chat-discussions-success.svg

[chat]: https://github.com/orgs/syntax-tree/discussions

[mdast]: https://github.com/syntax-tree/mdast

[npm]: https://docs.npmjs.com/cli/install

[esmsh]: https://esm.sh

[health]: https://github.com/syntax-tree/.github

[contributing]: https://github.com/syntax-tree/.github/blob/main/contributing.md

[support]: https://github.com/syntax-tree/.github/blob/main/support.md

[coc]: https://github.com/syntax-tree/.github/blob/main/code-of-conduct.md

[license]: license

[author]: https://wooorm.com

[remark-breaks]: https://github.com/remarkjs/remark-breaks

[node]: https://github.com/syntax-tree/mdast#nodes

[xss]: https://en.wikipedia.org/wiki/Cross-site_scripting

[typescript]: https://www.typescriptlang.org

[hast]: https://github.com/syntax-tree/hast

[break]: https://github.com/syntax-tree/mdast#break

[remark]: https://github.com/remarkjs/remark

[api-newline-to-break]: #newlinetobreaktree

[unified]: https://github.com/unifiedjs/unified
