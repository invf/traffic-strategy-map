// AUTH-003A - validates OPENAI_DAILY_QUOTA at startup, strictly. A
// misconfigured value here controls real spending, so this fails
// loudly (throws) rather than silently coercing something nonsensical
// into "use the default" or, worse, into Infinity/NaN/a negative
// number that could mean "no limit" or "always 429."
//
// Bounded at the top (MAX_DAILY_QUOTA) too, not just at the bottom -
// an operator typo like "500000" is far more likely to be a mistake
// than a deliberate decision, and this is a spending control.

const MAX_DAILY_QUOTA = 10000;

export function validateDailyQuota(rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return undefined; // not set at all - caller uses its own default
  }
  // Number("") is 0, Number(" ") is 0, Number("1e3") is 1000 (not an
  // integer in the sense we want) - reject anything that isn't a
  // plain base-10 integer string, rather than trust Number()'s own
  // permissive parsing.
  if (!/^\d+$/.test(String(rawValue).trim())) {
    throw new Error(`OPENAI_DAILY_QUOTA must be a plain positive integer (e.g. "50") - got ${JSON.stringify(rawValue)}.`);
  }
  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`OPENAI_DAILY_QUOTA must be a strictly positive integer (>= 1) - got ${value}.`);
  }
  if (value > MAX_DAILY_QUOTA) {
    throw new Error(`OPENAI_DAILY_QUOTA must be at most ${MAX_DAILY_QUOTA} (got ${value}) - this is a spending control; a value this large is almost certainly a misconfiguration, not a deliberate choice.`);
  }
  return value;
}
