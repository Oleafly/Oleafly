import { warning } from '@rc-component/util';
export function legacyPropsWarning(props) {
  const {
    picker,
    disabledHours,
    disabledMinutes,
    disabledSeconds
  } = props;
  if (picker === 'time' && (disabledHours || disabledMinutes || disabledSeconds)) {
    warning(false, `'disabledHours', 'disabledMinutes', 'disabledSeconds' will be removed in the next major version, please use 'disabledTime' instead.`);
  }
}