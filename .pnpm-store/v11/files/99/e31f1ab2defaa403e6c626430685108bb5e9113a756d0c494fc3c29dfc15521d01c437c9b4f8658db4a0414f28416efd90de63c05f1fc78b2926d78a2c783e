[![npm version](https://img.shields.io/npm/v/rehype-github-alerts.svg?style=flat)](https://www.npmjs.com/package/rehype-github-alerts)
[![GitHub license](https://img.shields.io/github/license/chrisweb/rehype-github-alerts?style=flat)](https://github.com/chrisweb/rehype-github-alerts/blob/master/LICENSE)

# rehype-github-alerts

## Introduction

rehype plugin to create alerts (admonitions/callouts), mimicking the way alerts get rendered on github.com (based on this [GitHub community "Alerts" discussion](https://github.com/orgs/community/discussions/16925)), currently 5 types of alerts are supported:

> [!NOTE]  
> Highlights information that users should take into account, even when skimming.

> [!TIP]  
> Optional information to help a user be more successful.

> [!IMPORTANT]  
> Crucial information necessary for users to succeed.

> [!WARNING]  
> Critical content demanding immediate user attention due to potential risks.

> [!CAUTION]  
> Negative potential consequences of an action.

the markdown syntax for the 5 examples above is as follows:

```md
> [!NOTE]  
> Highlights information that users should take into account, even when skimming.

> [!TIP]  
> Optional information to help a user be more successful.

> [!IMPORTANT]  
> Crucial information necessary for users to succeed.

> [!WARNING]  
> Critical content demanding immediate user attention due to potential risks.

> [!CAUTION]  
> Negative potential consequences of an action.
```

this is a zero configuration package as all [options](#options) have defaults, but you can use them if you wish to modify default behavior, like for example by default 5 alerts are defined (with a default icon for each), use `options.alerts` to replace them with your own setup, there is also a default build that will create an HTML output that mimics what GitHub does, but you can change the build to create whatever HTML suits your needs best, check out the ["options" chapter](#options) to learn more about customization

## installation

To install rehype-github-alerts:

```shell
npm i rehype-github-alerts --save-exact
```

## examples

### Rehype example

For a simple example have a look at the ["rehype example" README](./examples/simple-rehype-example/README.md) (the source code is located in `examples/simple-rehype-example/`)

### Next.js tutorial

I published a Next.js [Next.js MDX tutorial](https://chris.lu/web_development/tutorials/next-js-static-first-mdx-starterkit) on my blog, the tutorial has a page about [using the **rehype-github-alerts** plugin with **Next.js**](https://chris.lu/web_development/tutorials/next-js-static-first-mdx-starterkit/github-like-alerts-plugin)

### Customized plugin Demo

You can now see a live demo of this plugin on my blog, especially in my web_development [chris.lu/web_development](https://chris.lu/web_development) section, the source code is in the [chris.lu repository](https://github.com/chrisweb/chris.lu), the configuration I used can be found in the next.config.ts file and the styling is in /app/global.css

### How does GitHub render alerts

I created [an issue on github](https://github.com/chrisweb/rehype-github-alerts/issues/1) to check how github is rendering alerts (will add more examples over time, based on feedback)

## styling

If you want to add styling / CSS similar to what GitHub uses, then you can get started by using the stylesheet that is included in the build of this package. The stylesheet is in [dist/styling/css/index.css](/dist/styling/css/index.css).

You can either open the file and copy what you need and paste it into your own CSS file

Or you could import the stylesheet in a Next.js layout file like this:

```js
import '@/node_modules/rehype-github-alerts/dist/styling/css/index.css'
```

There is an example in the layout file of the [Next.js MDX starterkit](https://github.com/chrisweb/next-js-static-first-mdx-starterkit_tutorial_chris.lu/blob/92500597d8152910aabec0bf9ea56477dca3e1b0/app/layout.tsx) repository

Another option is to use the [webpack CSS loader](https://www.npmjs.com/package/css-loader) to include the css file into your builds

### icons

In v4 we switched to using the [GitHub Primer Octicons](https://primer.style/foundations/icons/)

If you prefer using other icons like the [twbs icons](https://icons.getbootstrap.com/), then have a look at the [v3 icons build](#v3-icons-build) chapter

## options

`options` (optional)

all options have default values which for most use cases should be enough, meaning there is zero configuration to do, unless you want to customize something

- `alerts` (`IAlert[]`)
- `supportLegacy` (`boolean`, default: false)
- `build` (`DefaultBuildType`)

### build option

the build option can be used to customize how alerts get rendered, this can be useful if you want to modify what css classes the elements have

the build option accepts a function that has two parameters:

alertOptions: this is an object of type **IAlert**, meaning it contains the options of the alert that got matched, like the keyword, icon and title
originalChildren: an array of type **DefaultBuildType**, containing the original children (body content of the alert)

for example in your configuration file create a rehype-github-alerts **build** option like this:

```mjs
/**
 * @typedef {import('rehype-github-alerts').IOptions} IOptions
 * @typedef {import('rehype-github-alerts').DefaultBuildType} DefaultBuildType
 */

/** @type { DefaultBuildType } */
const myGithubAlertBuild = (alertOptions, originalChildren) => {
    const alert = {
        type: 'element',
        tagName: 'div',
        properties: {
            className: [
                `markdown-alert-${alertOptions.keyword.toLowerCase()}`,
            ],
        },
        children: [
            ...originalChildren
        ],
    }

    return alert
}

/** @type { IOptions } */
const rehypeGithubAlertsOptions = {
    build: myGithubAlertBuild,
}
```

then use the following markdown code (important: there are two spaces after `[!NOTE]  ` to create a hard line break, see the ["about soft line breaks" chapter](#about-soft-line-breaks-support) for a more detailed explanation):

```md
> [!NOTE]  
> I'm a note (created using a custom build)  
```

will yield the following HTML output:

```html
<div class="markdown-alert-note">
    I'm a note (created using a custom build)
</div>
```

#### v3 icons build

If you migrate from a previous version to v4 and want to keep the [twbs icons](https://icons.getbootstrap.com/), then you need to update your build (in the plugin options) like this:

```js
alerts: [
    {
        keyword: 'NOTE',
        // bootstrap icon: info-circle
        icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16"/><path d="m8.93 6.588-2.29.287-.082.38.45.083c.294.07.352.176.288.469l-.738 3.468c-.194.897.105 1.319.808 1.319.545 0 1.178-.252 1.465-.598l.088-.416c-.2.176-.492.246-.686.246-.275 0-.375-.193-.304-.533zM9 4.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0"/></svg>',
        title: 'Note',
    },
    {
        keyword: 'IMPORTANT',
        // bootstrap icon: exclamation-square
        icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M14 1a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1zM2 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2z"/><path d="M7.002 11a1 1 0 1 1 2 0 1 1 0 0 1-2 0zM7.1 4.995a.905.905 0 1 1 1.8 0l-.35 3.507a.552.552 0 0 1-1.1 0z"/></svg>',
        title: 'Important',
    },
    {
        keyword: 'WARNING',
        // bootstrap icon: exclamation-triangle
        icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M7.938 2.016A.13.13 0 0 1 8.002 2a.13.13 0 0 1 .063.016.146.146 0 0 1 .054.057l6.857 11.667c.036.06.035.124.002.183a.163.163 0 0 1-.054.06.116.116 0 0 1-.066.017H1.146a.115.115 0 0 1-.066-.017.163.163 0 0 1-.054-.06.176.176 0 0 1 .002-.183L7.884 2.073a.147.147 0 0 1 .054-.057zm1.044-.45a1.13 1.13 0 0 0-1.96 0L.165 13.233c-.457.778.091 1.767.98 1.767h13.713c.889 0 1.438-.99.98-1.767L8.982 1.566z"/><path d="M7.002 12a1 1 0 1 1 2 0 1 1 0 0 1-2 0zM7.1 5.995a.905.905 0 1 1 1.8 0l-.35 3.507a.552.552 0 0 1-1.1 0z"/></svg>',
        title: 'Warning',
    },
    {
        keyword: 'TIP',
        // bootstrap icon: lightbulb
        icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M2 6a6 6 0 1 1 10.174 4.31c-.203.196-.359.4-.453.619l-.762 1.769A.5.5 0 0 1 10.5 13a.5.5 0 0 1 0 1 .5.5 0 0 1 0 1l-.224.447a1 1 0 0 1-.894.553H6.618a1 1 0 0 1-.894-.553L5.5 15a.5.5 0 0 1 0-1 .5.5 0 0 1 0-1 .5.5 0 0 1-.46-.302l-.761-1.77a1.964 1.964 0 0 0-.453-.618A5.984 5.984 0 0 1 2 6m6-5a5 5 0 0 0-3.479 8.592c.263.254.514.564.676.941L5.83 12h4.342l.632-1.467c.162-.377.413-.687.676-.941A5 5 0 0 0 8 1"/></svg>',
        title: 'Tip',
    },
    {
        keyword: 'CAUTION',
        // bootstrap icon: exclamation-octagon
        icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M4.54.146A.5.5 0 0 1 4.893 0h6.214a.5.5 0 0 1 .353.146l4.394 4.394a.5.5 0 0 1 .146.353v6.214a.5.5 0 0 1-.146.353l-4.394 4.394a.5.5 0 0 1-.353.146H4.893a.5.5 0 0 1-.353-.146L.146 11.46A.5.5 0 0 1 0 11.107V4.893a.5.5 0 0 1 .146-.353L4.54.146zM5.1 1 1 5.1v5.8L5.1 15h5.8l4.1-4.1V5.1L10.9 1z"/><path d="M7.002 11a1 1 0 1 1 2 0 1 1 0 0 1-2 0zM7.1 4.995a.905.905 0 1 1 1.8 0l-.35 3.507a.552.552 0 0 1-1.1 0z"/></svg>',
        title: 'Caution',
    },
],
```

> [!TIP]  
> you are not limited to using the [twbs icons](https://icons.getbootstrap.com/), if you prefer you could use the [lucide icons](https://lucide.dev/packages) or the [Material Symbols icons (google font)](https://fonts.google.com/icons) or the [Font Awesome Free icons](https://github.com/FortAwesome/Font-Awesome)


## about "soft line breaks" support

> [!IMPORTANT]  
> GitHub turns soft line breaks into hard line breaks by default, this plugin does NOT  

**option 1:** If you are using rehype-github-alerts, then **you need to add two spaces at the end of each line** if you want to have a line break (same as you would do for markdown outside of an alert), which is the [markdown syntax for a hard linebreak](https://daringfireball.net/projects/markdown/syntax#p), like so:

```md
> [!NOTE]  
> you MUST add 2 spaces (to all 3 lines of this example, including the first one) to create line breaks  
> if you don't want to manually add two spaces after each line, then you need to install the [remark-breaks](https://github.com/remarkjs/remark-breaks) plugin  
```

**option 2:** If you do NOT want to have to add two spaces manually after each line, then I recommend you install the plugin called [remark-breaks](https://github.com/remarkjs/remark-breaks), **remark-breaks** will mimic the behavior you experience on GitHub, by automatically turning a soft line break (when you hit `Enter` at the end of a line) into hard line breaks  

As noted in the readme of the [remark-breaks](https://github.com/remarkjs/remark-breaks) package README, the purpose of the **remark-breaks** is to:

> remark-breaks turns enters into `<br>`s
> GitHub does this in a few places (comments, issues, PRs, and releases)

## paragraphs separation

If in your markdown, you add two spaces at the end of a line, like this:

```md
> [!TIP]  
> first paragraph  
> second paragraph  
```

Then the resulting HTML will only have **one paragraph**, in which both parts of your text are separated by a `<br>` element:

```html
<div class="markdown-alert markdown-alert-tip">
    <p class="markdown-alert-title">(...)</p>
    <p>first paragraph<br>
    second paragraph</p>
</div>
```

To create **two separate paragraphs** (no matter if you are using remark-breaks or not) you need to add an empty line into your markdown (same as you would do outside of a blockquote), like so:

```md
> [!TIP]  
> first paragraph  
>
> second paragraph  
```

Which will result in the following HTML:

```html
<div class="markdown-alert markdown-alert-tip">
    <p class="markdown-alert-title">(...)</p>
    <p>first paragraph</p>
    <p>second paragraph</p>
</div>
```

## tests

For our tests we use the [test-runner that is built in node.js](https://nodejs.org/api/test.html)

All tests are located in the `/test` directory

### run tests

To run the tests use the following command:

```shell
npm run test
```

> [!NOTE]  
> this will build the plugin and then run the test coverage command  

### github token to create new test fixtures

To create new fixtures, we use a the [create-gfm-fixtures](https://github.com/wooorm/create-gfm-fixtures) package, to be able to use this package locally you will need a **personal GitHub access token**, because the tool will create gists on GitHub, insert the markdown from the test into the gist file, then the tool will read the converted HTML from GitHub and finally create a fixture HTML file. The fixture HTML file can then be used to compare the fixture HTML with the HTML output that gets created by this plugin. If the HTML from GitHub and the HTML produced by this plugin match then the test will pass, else it will fail.

To create a new token visit the GitHub ["New fine-grained personal access token"](https://github.com/settings/personal-access-tokens/new) page. There you need to create a new token, then under **Permissions** you need to set the **Gists** permission to read/write, then click on **Generate token** to create your new token.  

When you have your token, make a copy of the `.env.example` and rename it to `.env`, then insert your token and save it

> [!TIP]  
>  if you new to GitHub tokens, then you may want to check out the [GitHub documentation "Creating a fine-grained personal access token"](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#creating-a-fine-grained-personal-access-token)

## types

If you use typescript and intend to edit the options, for example to create custom alerts, then you may want to use the types provided by this library:

```ts
import { rehypeGithubAlerts, IOptions } from 'rehype-github-alerts'

const myOptions: IOptions = {
    alerts: [
        {
            keyword: 'MY_ALERT',
            icon: '<svg width="16" height="16" viewBox="0 0 16 16"/></svg>',
            title: 'My Alert',
        },
    ],
}
```

If your configuration file is written in javascript, then you can use the types likes this:

on top of your file add this jsdoc **typedef** at the beginning of the file:

```js
/**
 * @typedef {import('rehype-github-alerts').IOptions} IOptions
 */
```

and then in your code use the rehype-github-alerts type by placing a jsdoc @type tag over the options, like so:

```js
/** @type { IOptions } */
const rehypeGithubAlertsOptions = {
    supportLegacy: false,
}
```

<details>
    <summary>here is a full example of a next.js next.config.mjs configuration file</summary>

```mjs
/**
 * @typedef {import('rehype-github-alerts').IOptions} IOptions
 */

import WithMDX from '@next/mdx'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import { rehypeGithubAlerts }  from 'rehype-github-alerts'

const nextConfig = (/*phase*/) => {

    // https://github.com/remarkjs/remark-gfm
    // If you use remark-gfm, you'll need to use next.config.mjs
    // as the package is ESM only
    const remarkGfmOptions = {
        singleTilde: false,
    }

    // https://github.com/chrisweb/rehype-github-alerts
    /** @type { IOptions } */
    const rehypeGithubAlertsOptions = {
        supportLegacy: false,
    }

    const withMDX = WithMDX({
        extension: /\.mdx?$/,
        options: {
            remarkPlugins: [remarkBreaks, [remarkGfm, remarkGfmOptions]],
            rehypePlugins: [[rehypeGithubAlerts, rehypeGithubAlertsOptions]],
        },
    })

    /** @type {import('next').NextConfig} */
    const nextConfig = {
        experimental: {
            // experimental use rust compiler for MDX
            // as of now (07.10.2023) there is no support for rehype plugins
            // this is why it is currently disabled
            mdxRs: false,
        },
        // configure pageExtensions to include md and mdx
        pageExtensions: ['ts', 'tsx', 'js', 'jsx', 'md', 'mdx'],
    }

    return withMDX(nextConfig)

}

export default nextConfig
```

The Next.js configuration example above assumes that you have installed the packages [@next/mdx](https://www.npmjs.com/package/@next/mdx), [@mdx-js/loader](https://www.npmjs.com/package/@mdx-js/loader), [remark-breaks](https://www.npmjs.com/package/remark-breaks), [remark-gfm](https://www.npmjs.com/package/remark-gfm) and [rehype-github-alerts](https://www.npmjs.com/package/rehype-github-alerts)

</details>

## legacy syntax

as of 14 November 2023 GitHub has removed support for legacy syntax, the legacy syntax is supported by this plugin but as of now turned off by default

legacy markdown (mdx) syntax:

```md
> **!Note**  
> I'm a note :wave:  

> **!Important**  
> I'm important  

> **!Warning**  
> I'm a warning  
```

you can turn **ON** legacy support via the options like so:

```js
const myRehypeGithubAlertsOptions = {
    supportLegacy: true,
}
```

## bug reports / issues

if you find a bug, please open an issue in the [rehype-github-alerts issues page on github](https://github.com/chrisweb/rehype-github-alerts/issues), try to describe the bug you encountered as best as you can and if possible add some examples of the markdown / mdx content or code that you used when you found the bug, I or a contributor will try to look into it asap

## feedback / ideas

If you have an idea to improve this project please use the ["NEW Feature Request"](https://github.com/chrisweb/rehype-github-alerts/issues/new/choose) issue template or if you have any feedback about this package you may want to post it in the [rehype discussion about this plugin](https://github.com/orgs/rehypejs/discussions/157)

## contributing

PRs are always welcome 😉

To get started, please check out the [CONTRIBUTING.md](CONTRIBUTING.md) guide of this project

## alternatives

* One alternative to this package if you want to have github like alerts but do it with a **remark plugin** instead of a **rehype plugin** is [remark-github-beta-blockquote-admonitions](https://www.npmjs.com/package/remark-github-beta-blockquote-admonitions)  
* Another alternative is to use the [rehype-github-alert](https://www.npmjs.com/package/rehype-github-alert) (the name is similar to this plugin but minus the "s"), it is the official package from the [rehype-github](https://github.com/rehypejs/rehype-github) repository  
* A different approach is being used in [rehype-callouts](https://github.com/lin-stephanie/rehype-callouts), which is NOT about mimicking GitHub (even though the blockquote usage is similar) but the package has nice features like nestable callouts and also custom callout titles  

## additional packages

if you use this package, there are other packages you might want to install too, for example:

- [remark-gfm](https://github.com/remarkjs/remark-gfm), adds support for [GitHub Flavored Markdown (GFM)](https://github.github.com/gfm/) (autolink literals, footnotes, strikethrough, tables, task lists)
- [remark-breaks](https://github.com/remarkjs/remark-breaks), turns soft line endings (enters) into hard breaks (`<br>`s). GitHub does this in a few places (comments, issues, PRs, and releases)
