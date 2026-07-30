import { E as useStoreContext, R as Row, L as Label, P as Portal, O as Overlay, a7 as String, a8 as Number, a9 as Boolean, aa as Select, a as Vector, ab as InnerLabel } from '../../dist/vector-plugin-5e122f40.esm.js';
export { a1 as LevaInputs, v as SpecialInputs, h as clamp, ae as createPlugin, U as debounce, ad as evaluate, aj as formatVector, g as getVectorPlugin, ag as getVectorSchema, ah as getVectorType, j as invertedRange, af as keyframes, n as normalizeKeyedNumberSettings, ak as normalizeVector, ac as pad, r as range, ai as sanitizeVector, s as styled, F as useCanvas2d, e as useDrag, G as useInput, u as useInputContext, A as useInputSetters, E as useStoreContext, d as useTh, b as useTransform } from '../../dist/vector-plugin-5e122f40.esm.js';
export { colord } from 'colord';
export { dequal } from 'dequal/lite';
import 'react';
import shallow from 'zustand/shallow';
import '@radix-ui/react-portal';
import 'v8n';
import '@stitches/react';
import '@use-gesture/react';
import '@radix-ui/react-tooltip';

function mergeRefs(refs) {
  return value => {
    refs.forEach(ref => {
      if (typeof ref === 'function') ref(value);else if (ref != null) {
        ref.current = value;
      }
    });
  };
}

const useValue = path => {
  return useValues([path])[path];
};
const useValues = paths => {
  const store = useStoreContext();
  const value = store.useStore(({
    data
  }) => paths.reduce((acc, path) => {
    if (data[path] && 'value' in data[path]) return Object.assign(acc, {
      [path]: data[path].value
    });
    return acc;
  }, {}), shallow);
  return value;
};

const Components = {
  Row,
  Label,
  Portal,
  Overlay,
  String,
  Number,
  Boolean,
  Select,
  Vector,
  InnerLabel
};

export { Components, mergeRefs, useValue, useValues };
