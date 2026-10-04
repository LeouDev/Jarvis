import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt } from '../lib/crypto.js';
import { UserFacingError } from '../lib/util.js';

// Official APIs only. Add Instagram / X / LinkedIn / TikTok by implementing SocialProvider
// and registering it in SOCIAL_PROVIDERS; the tools and approval flow pick it up automatically.

export interface SocialAccount { platform: string; id: string; name: string }
export interface SocialDraft { platform: string; caption: string }

export interface SocialProvider {
  platform: string;
  label: string;
  createDraft(caption: string): SocialDraft;
  getAccount(token: string, externalId: string): Promise<SocialAccount>;
  publishPost(token: string, externalId: string, draft: SocialDraft): Promise<{ id: string; url?: string }>;
  uploadMedia?(token: string, externalId: string, mediaUrl: string): Promise<{ id: string }>;
}

const GRAPH = `https://graph.facebook.com/${process.env.FACEBOOK_GRAPH_VERSION || 'v23.0'}`;

async function graph(path: string, init?: RequestInit) {
  const res = await fetch(`${GRAPH}${path}`, { ...init, signal: AbortSignal.timeout(15_000) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new UserFacingError(`Facebook rejected the request: ${json.error?.message ?? res.status}`);
  return json;
}

/** Publishes to a Facebook Page with a Page access token (pages_manage_posts). */
export const FacebookProvider: SocialProvider = {
  platform: 'facebook',
  label: 'Facebook',
  createDraft(caption) {
    const text = caption.trim();
    if (!text) throw new UserFacingError('The post caption is empty.');
    if (text.length > 63_206) throw new UserFacingError('Facebook posts are limited to 63,206 characters.');
    return { platform: 'facebook', caption: text };
  },
  async getAccount(token, pageId) {
    const page = await graph(`/${pageId}?fields=id,name&access_token=${encodeURIComponent(token)}`);
    return { platform: 'facebook', id: page.id, name: page.name };
  },
  async publishPost(token, pageId, draft) {
    const body = new URLSearchParams({ message: draft.caption, access_token: token });
    const { id } = await graph(`/${pageId}/feed`, { method: 'POST', body });
    return { id, url: `https://www.facebook.com/${id}` };
  },
};

export const SOCIAL_PROVIDERS: Record<string, SocialProvider> = { facebook: FacebookProvider };

/** Loads and decrypts the user's connection for a platform, or null if not connected. */
export async function loadConnection(db: SupabaseClient, platform: string) {
  const { data } = await db
    .from('connected_accounts')
    .select('external_id, account_name, token_encrypted')
    .eq('provider', platform)
    .maybeSingle();
  if (!data) return null;
  return { externalId: data.external_id as string, name: data.account_name as string, token: decrypt(data.token_encrypted) };
}
