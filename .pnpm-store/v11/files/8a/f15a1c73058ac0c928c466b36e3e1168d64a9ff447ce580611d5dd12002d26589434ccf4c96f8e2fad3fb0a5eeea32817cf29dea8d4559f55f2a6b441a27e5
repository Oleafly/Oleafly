export const genNoMotionStyle = () => {
  return {
    '@media (prefers-reduced-motion: reduce)': {
      '&, &::before, &::after': {
        transition: 'none',
        animation: 'none'
      }
    }
  };
};
/**
 * For call sites already nested inside a pseudo-element selector.
 */
export const genNoMotionRawStyle = () => {
  return {
    '@media (prefers-reduced-motion: reduce)': {
      transition: 'none',
      animation: 'none'
    }
  };
};