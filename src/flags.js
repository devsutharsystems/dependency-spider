// Diagnosis switches: `?off=tilt,dust,vignette,glow,additive,halo,fog,glints,sparks,countup,idle` turns single effects
// off so their cost can be measured one at a time (scripts/perf-headed.mjs). Not used in normal operation.
const raw = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('off') || '' : '';
export const off = new Set(raw.split(',').filter(Boolean));
export const isOff = (k) => off.has(k);
