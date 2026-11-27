// ADV-005 (owner correction #3) - "A shallow object merge is not
// sufficient if it overwrites fields that the user previously changed."
// This is the precedence-aware merge that replaces a naive
// `{ ...existing, ...incoming }` for product metadata specifically.
//
// Tracks, per field, the value the AI last proposed (`aiSourceSnapshot`,
// persisted as part of the strategy's own `productInfo` JSONB blob under
// the reserved key `aiSourceSnapshot` - no new column, no migration).
// Zustand's existing setProductInfo/ProductSetupModal's metadata-only Save
// (ADV-004-FIX-3) already spread-merge productInfo, so this extra key
// survives a user's own edits untouched automatically - no other code
// needed to change for it to persist correctly across sessions.
//
// Precedence rule, per field:
//   - No new AI value offered for this field at all -> never touched.
//   - No snapshot recorded yet (first import ever, OR a pre-ADV-005
//     strategy with no snapshot) -> safe to set ONLY if currently empty;
//     a non-empty value with unknown provenance is conservatively treated
//     as user-owned and left alone FOREVER from this point on (the
//     snapshot is only started once a refresh actually happens) - "never
//     overwrite a field that might be user-edited" wins over "always sync
//     the latest AI content" when provenance is ambiguous.
//   - A snapshot exists and the CURRENT value still matches it exactly ->
//     the user hasn't touched this field since the last import set it -
//     safe to refresh to the new AI value.
//   - A snapshot exists and the CURRENT value has DIVERGED from it -> the
//     user edited it since - never overwritten, snapshot left as-is.
const TRACKED_FIELDS = ['name', 'description', 'audience', 'goal'];

export function mergeProductMetadata(existingProductInfo, newAiValues) {
  const existing = existingProductInfo || {};
  const aiSourceSnapshot = existing.aiSourceSnapshot || {};
  const productInfo = { ...existing };
  const nextSnapshot = { ...aiSourceSnapshot };

  for (const field of TRACKED_FIELDS) {
    const newValue = newAiValues?.[field];
    if (!newValue) continue; // nothing new to offer for this field - never touched

    const hasSnapshot = Object.prototype.hasOwnProperty.call(aiSourceSnapshot, field);
    const currentValue = existing[field];
    const safeToRefresh = hasSnapshot ? currentValue === aiSourceSnapshot[field] : !currentValue;

    if (safeToRefresh) {
      productInfo[field] = newValue;
      nextSnapshot[field] = newValue;
    }
    // else: left completely untouched - the user's own edit (or a
    // pre-existing value of unknown provenance) wins.
  }

  productInfo.aiSourceSnapshot = nextSnapshot;
  return productInfo;
}
