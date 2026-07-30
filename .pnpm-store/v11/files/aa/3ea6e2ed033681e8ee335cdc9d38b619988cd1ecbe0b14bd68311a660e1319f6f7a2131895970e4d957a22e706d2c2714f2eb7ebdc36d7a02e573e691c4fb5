# remark-breaks

[![Build][build-badge]][build]
[![Coverage][coverage-badge]][coverage]
[![Downloads][downloads-badge]][downloads]
[![Size][size-badge]][size]
[![Sponsors][sponsors-badge]][collective]
[![Backers][backers-badge]][collective]
[![Chat][chat-badge]][chat]

**[remark][]** plugin to support hard breaks without needing spaces or escapes
(turns enters into `<br>`s).

## Contents

*   [What is this?](#what-is-this)
*   [When should I use this?](#when-should-i-use-this)
*   [Install](#install)
*   [Use](#use)
*   [API](#api)
    *   [`unified().use(remarkBreaks)`](#unifieduseremarkbreaks)
*   [Syntax](#syntax)
*   [Syntax tree](#syntax-tree)
*   [Types](#types)
*   [Compatibility](#compatibility)
*   [Security](#security)
*   [Related](#related)
*   [Contribute](#contribute)
*   [License](#license)

## What is this?

This package is a [unified][] ([remark][]) plugin to turn soft line endings
(enters) into hard breaks (`<br>`s)

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
npm install remark-breaks
```

In Deno with [`esm.sh`][esmsh]:

```js
import remarkBreaks from 'https://esm.sh/remark-breaks@4'
```

In browsers with [`esm.sh`][esmsh]:

```html
<script type="module">
  import remarkBreaks from 'https://esm.sh/remark-breaks@4?bundle'
</script>
```

## Use

Say we have the following file `example.md` (note: there are no spaces after
`a`):

```markdown
Mars is
the fourth planet
```

…and a module `example.js`:

```js
import rehypeStringify from 'rehype-stringify'
import remarkBreaks from 'remark-breaks'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import {read} from 'to-vfile'
import {unified} from 'unified'

const file = await unified()
  .use(remarkParse)
  .use(remarkBreaks)
  .use(remarkRehype)
  .use(rehypeStringify)
  .process(await read('example.md'))

console.log(String(file))
```

…then running `node example.js` yields:

```html
<p>Mars is<br>
the fourth planet</p>
```

> 👉 **Note**: Without `remark-breaks`, you’d get:
>
> ```html
> <p>Mars is
> the fourth planet</p>
> ```

## API

This package exports no identifiers.
The default export is [`remarkBreaks`][api-remark-breaks].

### `unified().use(remarkBreaks)`

Support hard breaks without needing spaces or escapes (turns enters into
`<br>`s).

###### Parameters

There are no parameters.

###### Returns

Transform ([`Transformer`][unified-transformer]).

## Syntax

This plugin looks for markdown line endings (`\r`, `\n`, and `\r\n`) preceded
by zero or more spaces and tabs.

## Syntax tree

This plugin adds mdast [`Break`][mdast-break] nodes to the syntax tree.
These are the same nodes that represent breaks with spaces or escapes.

## Types

This package is fully typed with [TypeScript][].
It exports no additional types.

## Compatibility

Projects maintained by the unified collective are compatible with maintained
versions of Node.js.

When we cut a new major release, we drop support for unmaintained versions of
Node.
This means we try to keep the current release line, `remark-breaks@^4`,
compatible with Node.js 16.

This plugin works with `unified` version 6+ and `remark` version 7+.

## Security

Use of `remark-breaks` does not involve **[rehype][]** (**[hast][]**) or user
content so there are no openings for [cross-site scripting (XSS)][wiki-xss]
attacks.

## Related

*   [`remark-gfm`](https://github.com/remarkjs/remark-gfm)
    — support GFM (autolink literals, footnotes, strikethrough, tables,
    tasklists)
*   [`remark-github`](https://github.com/remarkjs/remark-github)
    — link references to commits, issues, and users, in the same way that
    GitHub does
*   [`remark-directive`](https://github.com/remarkjs/remark-directive)
    — support directives
*   [`remark-frontmatter`](https://github.com/remarkjs/remark-frontmatter)
    — support frontmatter (YAML, TOML, and more)
*   [`remark-math`](https://github.com/remarkjs/remark-math)
    — support math

## Contribute

See [`contributing.md`][contributing] in [`remarkjs/.github`][health] for ways
to get started.
See [`support.md`][support] for ways to get help.

This project has a [code of conduct][coc].
By interacting with this repository, organization, or community you agree to
abide by its terms.

## License

[MIT][license] © [Titus Wormer][author]

<!-- Definitions -->

[build-badge]: https://github.com/remarkjs/remark-breaks/workflows/main/badge.svg

[build]: https://github.com/remarkjs/remark-breaks/actions

[coverage-badge]: https://img.shields.io/codecov/c/github/remarkjs/remark-breaks.svg

[coverage]: https://codecov.io/github/remarkjs/remark-breaks

[downloads-badge]: https://img.shields.io/npm/dm/remark-breaks.svg

[downloads]: https://www.npmjs.com/package/remark-breaks

[size-badge]: https://img.shields.io/bundlejs/size/remark-breaks

[size]: https://bundlejs.com/?q=remark-breaks

[sponsors-badge]: https://opencollective.com/unified/sponsors/badge.svg

[backers-badge]: https://opencollective.com/unified/backers/badge.svg

[collective]: https://opencollective.com/unified

[chat-badge]: https://img.shields.io/badge/chat-discussions-success.svg

[chat]: https://github.com/remarkjs/remark/discussions

[npm]: https://docs.npmjs.com/cli/install

[esm]: https://gist.github.com/sindresorhus/a39789f98801d908bbc7ff3ecc99d99c

[esmsh]: https://esm.sh

[health]: https://github.com/remarkjs/.github

[contributing]: https://github.com/remarkjs/.github/blob/main/contributing.md

[support]: https://github.com/remarkjs/.github/blob/main/support.md

[coc]: https://github.com/remarkjs/.github/blob/main/code-of-conduct.md

[license]: license

[author]: https://wooorm.com

[hast]: https://github.com/syntax-tree/hast

[mdast-break]: https://github.com/syntax-tree/mdast#break

[rehype]: https://github.com/rehypejs/rehype

[remark]: https://github.com/remarkjs/remark

[typescript]: https://www.typescriptlang.org

[unified]: https://github.com/unifiedjs/unified

[unified-transformer]: https://github.com/unifiedjs/unified#transformer

[wiki-xss]: https://en.wikipedia.org/wiki/Cross-site_scripting

[api-remark-breaks]: #unifieduseremarkbreaks
