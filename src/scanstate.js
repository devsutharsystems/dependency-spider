// How complete was the scan? Three states, and the wording that goes with each. Pure: no DOM.
//   complete  at least 95% of the eligible source files were read      -> no banner
//   partial   25% to under 95%                                         -> neutral info banner
//   weak      under 25%                                                -> one-line neutral banner (same style as partial), "unverified"
//                                                                         badge on every candidate, and the shed headline says "up to"
// N (read) and M (eligible) always come from the real scan; nothing here is a default.
export const COMPLETE_FROM = 0.95;
export const WEAK_BELOW = 0.25;

export function scanState(read, eligible) {
  if (!eligible) return { read, eligible, ratio: 1, percentText: '100', state: 'complete' };
  const ratio = Math.min(1, read / eligible);
  const percentText = ratio < 0.01 && read > 0 ? '<1' : String(Math.round(ratio * 100));
  return { read, eligible, ratio, percentText, state: ratio >= COMPLETE_FROM ? 'complete' : ratio >= WEAK_BELOW ? 'partial' : 'weak' };
}

// null when the scan is complete, else { level: 'info', text }. (Only the early-stop banner below is 'strong'.)
export function scanBanner(scan) {
  if (!scan || scan.state === 'complete') return null;
  const facts = `${scan.read} of ${scan.eligible} source files (${scan.percentText}%)`;
  if (scan.state === 'partial') return { level: 'info', text: `Scanned ${facts}. Candidates may include false ghosts; verify each one.` };
  // under 25%: the same neutral style as the partial banner, one short line (the badge and the "up to" headline carry the weight)
  return { level: 'info', text: `Partial scan: ${scan.read} of ${scan.eligible} files (${scan.percentText}%) read. Candidates may include false ghosts; verify each.` };
}

export const abortedBanner = (read) => ({ level: 'strong', text: `Stopped reading files early after 3 failures in a row (a rate limit or the network). The result uses the ${read} files read so far.` });

// The headline number: plain "-N packages", or "up to -N packages if all candidates are truly unused" for a weak scan.
export function shedHeadline(combinedShed, state) {
  const noun = combinedShed === 1 ? 'package' : 'packages';
  return state === 'weak' ? { prefix: 'up to -', n: combinedShed, suffix: ` ${noun} if all candidates are truly unused` } : { prefix: '-', n: combinedShed, suffix: ` ${noun}` };
}
