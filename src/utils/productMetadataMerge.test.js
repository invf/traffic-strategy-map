// ADV-005 (owner correction #3) - "a shallow object merge is not
// sufficient if it overwrites fields that the user previously changed."
// Pure unit tests for the per-field precedence rule mergeProductMetadata
// implements - no store, no network.
import { describe, it, expect } from 'vitest';
import { mergeProductMetadata } from './productMetadataMerge';

describe('mergeProductMetadata (ADV-005)', () => {
  it('first import: fills in every offered field on a genuinely empty productInfo, and starts tracking provenance for each', () => {
    const result = mergeProductMetadata({}, { name: 'SentiPulse', description: 'Sentiment analysis', audience: 'PMs', goal: 'signups' });
    expect(result).toMatchObject({ name: 'SentiPulse', description: 'Sentiment analysis', audience: 'PMs', goal: 'signups' });
    expect(result.aiSourceSnapshot).toEqual({ name: 'SentiPulse', description: 'Sentiment analysis', audience: 'PMs', goal: 'signups' });
  });

  it('re-import, field UNCHANGED since the last import set it: safely refreshes to the new AI value', () => {
    const existing = { name: 'Old Name', aiSourceSnapshot: { name: 'Old Name' } };
    const result = mergeProductMetadata(existing, { name: 'New AI Name' });
    expect(result.name).toBe('New AI Name');
    expect(result.aiSourceSnapshot.name).toBe('New AI Name');
  });

  it('re-import, field MANUALLY EDITED by the user since the last import: never overwritten, snapshot left as-is', () => {
    const existing = { name: 'My Custom Name', aiSourceSnapshot: { name: 'Old AI Name' } };
    const result = mergeProductMetadata(existing, { name: 'Newer AI Name' });
    expect(result.name).toBe('My Custom Name'); // the user's edit wins
    expect(result.aiSourceSnapshot.name).toBe('Old AI Name'); // snapshot untouched too
  });

  it('a field the package offers NOTHING for is never touched, regardless of snapshot state', () => {
    const existing = { name: 'Real Name', audience: 'My audience', aiSourceSnapshot: { name: 'Real Name' } };
    const result = mergeProductMetadata(existing, { name: 'Refreshed Name' /* no description/audience/goal offered at all */ });
    expect(result.audience).toBe('My audience'); // completely untouched
    expect(result.aiSourceSnapshot.audience).toBeUndefined(); // never started tracking a field that was never offered
  });

  it('a pre-ADV-005 strategy (no snapshot at all) with an existing non-empty value: conservatively preserved forever, never overwritten by unknown provenance', () => {
    const legacy = { name: 'Legacy Project Name' }; // no aiSourceSnapshot key at all
    const result = mergeProductMetadata(legacy, { name: 'Shiny New AI Name' });
    expect(result.name).toBe('Legacy Project Name');
    expect(result.aiSourceSnapshot.name).toBeUndefined(); // still not tracked - stays frozen on every future call too
  });

  it('a pre-ADV-005 strategy with no snapshot but a genuinely EMPTY existing value: safe to fill in, and starts tracking from here', () => {
    const legacy = { name: '' };
    const result = mergeProductMetadata(legacy, { name: 'First Real Name' });
    expect(result.name).toBe('First Real Name');
    expect(result.aiSourceSnapshot.name).toBe('First Real Name');
  });

  it('missing resource information: an undefined AI value for a field is never applied, even on first import', () => {
    const result = mergeProductMetadata({}, { name: 'SentiPulse', description: undefined, audience: undefined, goal: undefined });
    expect(result.description).toBeUndefined();
    expect(result.audience).toBeUndefined();
    expect(result.goal).toBeUndefined();
    expect(result.aiSourceSnapshot).toEqual({ name: 'SentiPulse' });
  });

  it('repeated explicit imports with IDENTICAL AI content: idempotent - the second call produces the same result as the first', () => {
    const first = mergeProductMetadata({}, { name: 'SentiPulse', audience: 'PMs' });
    const second = mergeProductMetadata(first, { name: 'SentiPulse', audience: 'PMs' });
    expect(second.name).toBe('SentiPulse');
    expect(second.audience).toBe('PMs');
    expect(second.aiSourceSnapshot).toEqual({ name: 'SentiPulse', audience: 'PMs' });
  });

  it('mixed scenario: one field refreshed (unchanged since import), one field preserved (user-edited), in the SAME call', () => {
    const existing = {
      name: 'My Custom Name', // user edited this
      audience: 'Old AI Audience', // user never touched this
      aiSourceSnapshot: { name: 'Old AI Name', audience: 'Old AI Audience' },
    };
    const result = mergeProductMetadata(existing, { name: 'Newer AI Name', audience: 'Newer AI Audience' });
    expect(result.name).toBe('My Custom Name'); // preserved
    expect(result.audience).toBe('Newer AI Audience'); // refreshed
  });

  it('never mutates the existingProductInfo object passed in', () => {
    const existing = { name: 'Original', aiSourceSnapshot: { name: 'Original' } };
    const frozen = JSON.parse(JSON.stringify(existing));
    mergeProductMetadata(existing, { name: 'Changed' });
    expect(existing).toEqual(frozen);
  });
});
