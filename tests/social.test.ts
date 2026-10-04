import { afterEach, describe, expect, it, vi } from 'vitest';
import { FacebookProvider } from '../server/social';

const graphReturns = (body: object) => vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body))));
afterEach(() => vi.unstubAllGlobals());

describe('Facebook connection check', () => {
  it('accepts a Page token for the matching Page ID', async () => {
    graphReturns({ id: '111', name: '13C', category: 'Brand' });
    await expect(FacebookProvider.getAccount('page-token', '111')).resolves.toEqual({ platform: 'facebook', id: '111', name: '13C' });
  });

  it('rejects user tokens and app/other IDs', async () => {
    graphReturns({ id: '999', name: 'Leou' });
    await expect(FacebookProvider.getAccount('user-token', '999')).rejects.toThrow(/user token/);
    graphReturns({ id: '111', name: '13C', category: 'Brand' });
    await expect(FacebookProvider.getAccount('page-token', '555')).rejects.toThrow(/belongs to the Page "13C" \(ID 111\)/);
  });
});
