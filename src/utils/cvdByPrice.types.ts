// Bin-size preset for the redesigned CVD-by-Price indicator.
// Owned here (next to the indicator's pure logic) so that `App.tsx`
// doesn't have to export types just for `Toolbar.tsx` to consume them.
//
//  - `auto`   : derived from the candle range + symbol tick
//  - `fine`   : auto / 4   (4× more bins, denser profile)
//  - `medium` : auto       (≈80 visible bins, the auto value)
//  - `coarse` : auto × 4   (4× fewer bins, chunkier profile)
//  - `manual` : use `cvdBinManual` (a number entered by the user)

export type CvdBinMode = 'auto' | 'fine' | 'medium' | 'coarse' | 'manual';

/** Multipliers applied to the `auto` value for each preset. */
export const CVD_BIN_MULTIPLIER: Record<Exclude<CvdBinMode, 'auto' | 'manual'>, number> = {
  fine: 0.25,
  medium: 1,
  coarse: 4,
};
