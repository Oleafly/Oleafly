import { FastColor } from '@ant-design/fast-color';
export const getAsSolidColor = (color, background) => {
  if (color?.startsWith('var(') || background?.startsWith('var(')) {
    return color;
  }
  return new FastColor(color).onBackground(background).toHexString();
};