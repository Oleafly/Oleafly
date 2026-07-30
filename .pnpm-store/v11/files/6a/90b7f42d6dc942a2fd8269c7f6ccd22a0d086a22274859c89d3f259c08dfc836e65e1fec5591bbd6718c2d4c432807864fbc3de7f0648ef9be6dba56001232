import * as React from 'react';
import { pickProps } from "../../../utils/miscUtil";
const propNames = ['onMouseEnter', 'onMouseLeave'];
export default function useRootProps(props) {
  return React.useMemo(() => pickProps(props, propNames), [props]);
}