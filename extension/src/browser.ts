/**
 * Chromium: `chrome`. Firefox MV3: `browser` (chrome is a callback-era alias).
 * Always use this handle so one bundle loads in both.
 */
type Ext = typeof chrome;

export const ext: Ext = (() => {
  const g = globalThis as { browser?: Ext; chrome?: Ext };
  const api = g.browser ?? g.chrome;
  if (!api) throw new Error("no WebExtension API");
  return api;
})();
