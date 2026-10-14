import { describe, expect, it } from 'vitest';

import { parseProfileResolution, PROFILE_RESOLUTIONS } from './profile-panel';

// A entrada do resolveProfileReport (seção 29, 29.6), puro: o uid chega já
// conferido pelo targetFanUid.

describe('a entrada do resolveProfileReport', () => {
  it('as duas resoluções: "Manter" e "Resolver"', () => {
    expect(PROFILE_RESOLUTIONS).toEqual(['kept', 'actioned']);
  });

  it.each([
    [
      { resolution: 'kept', round: 1 },
      { uid: 'uidPromo', resolution: 'kept', round: 1 },
    ],
    [
      { resolution: 'actioned', round: 7 },
      { uid: 'uidPromo', resolution: 'actioned', round: 7 },
    ],
  ])('%j vale', (fields, input) => {
    expect(parseProfileResolution('uidPromo', fields)).toEqual(input);
  });

  it.each([
    [{ round: 1 }, 'resolution'],
    [{ resolution: 'hidden', round: 1 }, 'resolution'],
    [{ resolution: 'withdrawn', round: 1 }, 'resolution'],
    [{ resolution: 'author_deleted', round: 1 }, 'resolution'],
    [{ resolution: 'kept' }, 'round'],
    [{ resolution: 'kept', round: 0 }, 'round'],
    [{ resolution: 'kept', round: -1 }, 'round'],
    [{ resolution: 'kept', round: 1.5 }, 'round'],
    [{ resolution: 'kept', round: '1' }, 'round'],
    [{ resolution: 'kept', round: Number.MAX_SAFE_INTEGER + 1 }, 'round'],
    [{ resolution: 'kept', round: null }, 'round'],
  ])('%j é invalid-request com o campo %s', (fields, field) => {
    expect(() => parseProfileResolution('uidPromo', fields)).toThrow(
      expect.objectContaining({ details: { reason: 'invalid-request', field } }),
    );
  });
});
