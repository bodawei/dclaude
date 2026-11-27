// LAYER 2: TRANSFORMATION. Costs.
//
// Prices API calls with the rates lib/load/prices.mjs decoded. A cost is a number of dollars,
// or null when it cannot be known; how null is shown ("?") is up to lib/present/.
//
// Pure functions: no I/O. Imports nothing from lib/present/.

/** Flags that don't change the price of a call. */
const UNPRICED_FLAGS = new Set(["fallback"]);

/**
 * Dollar cost of some calls, or null when a call with tokens uses a model missing from the
 * table, or has a flag (batch, fast, us-inference, ...) its model gives no multiplier for.
 */
function costOf(calls, rates) {
  let total = 0;
  for (const call of calls) {
    const m = rates[call.model];
    if (!m) {
      if (call.input + call.output > 0) return null;
      continue;
    }
    // Priced per call by its whole prompt: call.input = new-input + cache_write + cache_read.
    const r = m.tiers.find((t) => call.input > t.over)?.rates ?? m.base;
    let x = 1;
    for (const f of call.flags) {
      if (UNPRICED_FLAGS.has(f)) continue;
      if (!(f in m.multipliers)) return null;
      x *= m.multipliers[f];
    }
    total +=
      x *
      (call.new_input * r.input +
        call.output * r.output +
        call.cache_write_5m * r["5mPromptCacheWrite"] +
        call.cache_write_1h * r["60mPromptCacheWrite"] +
        call.cache_read * r.hitAndRefresh);
  }
  return total;
}

/** The sum of some costs, or null if any of them is unknown (null). */
const sumCosts = (costs) => (costs.includes(null) ? null : costs.reduce((a, b) => a + b, 0));

export { costOf, sumCosts };
