# @rc-component/input ⌨️

[![NPM version][npm-image]][npm-url]
[![npm download][download-image]][download-url]
[![build status][github-actions-image]][github-actions-url]
[![Codecov][codecov-image]][codecov-url]
[![bundle size][bundlephobia-image]][bundlephobia-url]
[![dumi][dumi-image]][dumi-url]

[npm-image]: http://img.shields.io/npm/v/@rc-component/input.svg?style=flat-square
[npm-url]: http://npmjs.org/package/@rc-component/input
[travis-image]: https://img.shields.io/travis/react-component/input/master?style=flat-square
[travis-url]: https://travis-ci.com/react-component/input
[github-actions-image]: https://github.com/react-component/input/actions/workflows/main.yml/badge.svg
[github-actions-url]: https://github.com/react-component/input/actions/workflows/main.yml
[codecov-image]: https://img.shields.io/codecov/c/github/react-component/input/master.svg?style=flat-square
[codecov-url]: https://app.codecov.io/gh/react-component/input
[david-url]: https://david-dm.org/react-component/input
[david-image]: https://david-dm.org/react-component/input/status.svg?style=flat-square
[david-dev-url]: https://david-dm.org/react-component/input?type=dev
[david-dev-image]: https://david-dm.org/react-component/input/dev-status.svg?style=flat-square
[download-image]: https://img.shields.io/npm/dm/@rc-component/input.svg?style=flat-square
[download-url]: https://npmjs.org/package/@rc-component/input
[bundlephobia-url]: https://bundlephobia.com/package/@rc-component/input
[bundlephobia-image]: https://img.shields.io/bundlephobia/minzip/@rc-component/input?style=flat-square
[dumi-url]: https://github.com/umijs/dumi
[dumi-image]: https://img.shields.io/badge/docs%20by-dumi-blue?style=flat-square

## Install

[![@rc-component/input](https://nodei.co/npm/@rc-component/input.png)](https://npmjs.org/package/@rc-component/input)

## Usage

```js
import Input from '@rc-component/input';
import { render } from 'react-dom';

render(<Input placeholder="input" allowClear />, mountNode);
```

```js
import { TextArea } from '@rc-component/input';
import { render } from 'react-dom';

render(<TextArea autoSize showCount />, mountNode);
```

## API

| Property              | Type                                                                                              | Default  | Description                                                                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| prefixCls             | string                                                                                            | rc-input |                                                                                                                                                                                |
| className             | string                                                                                            | ''       | additional class name of input                                                                                                                                                 |
| style                 | React.CSSProperties                                                                               |          | style properties of input                                                                                                                                                      |
| affixWrapperClassName | string                                                                                            | -        | className with '@rc-component/input-affix-wrapper'                                                                                                                             |
| groupClassName        | string                                                                                            | -        | className with '@rc-component/input-group-wrapper'                                                                                                                             |
| wrapperClassName      | string                                                                                            | -        | className with '@rc-component/input-wrapper'                                                                                                                                   |
| addonAfter            | ReactNode                                                                                         | -        | The label text displayed after (on the right side of) the input field                                                                                                          |
| addonBefore           | ReactNode                                                                                         | -        | The label text displayed before (on the left side of) the input field                                                                                                          |
| allowClear            | boolean &#124; { clearIcon: ReactNode }                                                           | false    | If allow to remove input content with clear icon                                                                                                                               |
| bordered              | boolean                                                                                           | true     | Whether has border style                                                                                                                                                       |
| defaultValue          | string                                                                                            | -        | The initial input content                                                                                                                                                      |
| disabled              | boolean                                                                                           | false    | Whether the input is disabled                                                                                                                                                  |
| id                    | string                                                                                            | -        | The ID for input                                                                                                                                                               |
| maxLength             | number                                                                                            | -        | The max length                                                                                                                                                                 |
| showCount             | boolean &#124; { formatter: ({ value: string, count: number, maxLength?: number }) => ReactNode } | false    | Whether show text count                                                                                                                                                        |
| prefix                | ReactNode                                                                                         | -        | The prefix icon for the Input                                                                                                                                                  |
| suffix                | ReactNode                                                                                         | -        | The suffix icon for the Input                                                                                                                                                  |
| type                  | string                                                                                            | `text`   | The type of input, see: [MDN](https://developer.mozilla.org/docs/Web/HTML/Element/input#Form_%3Cinput%3E_types) (use the named `TextArea` export instead of `type="textarea"`) |
| value                 | string                                                                                            | -        | The input content value                                                                                                                                                        |
| onChange              | function(e)                                                                                       | -        | Callback when user input                                                                                                                                                       |
| onPressEnter          | function(e)                                                                                       | -        | The callback function that is triggered when Enter key is pressed                                                                                                              |

## TextArea

`rc-textarea` has been migrated into `@rc-component/input`. Use the named `TextArea` export for all textarea-related features.

```js
import { TextArea } from '@rc-component/input';

<TextArea showCount maxLength={100} />;
<TextArea allowClear autoSize />;
```

| Property     | Type                        | Default     | Description                                                                                    |
| ------------ | --------------------------- | ----------- | ---------------------------------------------------------------------------------------------- |
| prefixCls    | string                      | rc-textarea |                                                                                                |
| className    | string                      | ''          | additional class name of textarea                                                              |
| style        | React.CSSProperties         | -           | style properties of textarea                                                                   |
| autoSize     | boolean \| object           | -           | Height autosize feature, can be set to `true\|false` or an object `{ minRows: 2, maxRows: 6 }` |
| allowClear   | boolean \| { clearIcon }    | false       | If allow to remove textarea content with clear icon                                            |
| showCount    | boolean \| { formatter }    | false       | Whether show text count                                                                        |
| count        | CountConfig                 | -           | Custom count strategy / max / exceed formatter                                                 |
| onPressEnter | function(e)                 | -           | The callback function that is triggered when Enter key is pressed                              |
| onResize     | function({ width, height }) | -           | The callback function that is triggered when resize                                            |

## inputRef

```tsx | pure
const inputRef = useRef(null);

useEffect(() => {
  inputRef.current.focus(); // the input will get focus
  inputRef.current.blur(); // the input will lose focus
  console.log(inputRef.current.input); // The origin input element
}, []);
// ....
<Input ref={inputRef} />;
```

| Property | Type                                    | Description                       |
| -------- | --------------------------------------- | --------------------------------- |
| focus    | `(options?: InputFocusOptions) => void` | The input get focus when called   |
| blur     | `() => void`                            | The input loses focus when called |
| input    | `HTMLInputElement \| null`              | The origin input element          |

## textareaRef

```tsx | pure
const textareaRef = useRef(null);

useEffect(() => {
  textareaRef.current.focus();
  textareaRef.current.blur();
  console.log(textareaRef.current.resizableTextArea);
}, []);

<TextArea ref={textareaRef} />;
```

| Property          | Type                   | Description                              |
| ----------------- | ---------------------- | ---------------------------------------- |
| focus             | `() => void`           | The textarea get focus when called       |
| blur              | `() => void`           | The textarea loses focus when called     |
| resizableTextArea | `ResizableTextAreaRef` | Wrapped resizable textarea instance      |
| nativeElement     | `HTMLElement \| null`  | The outer holder element or textarea DOM |

## Development

```
npm install
npm start
```

## License

@rc-component/input is released under the MIT license.
