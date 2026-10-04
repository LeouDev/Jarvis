import { truncate } from '../lib/util.js';

export interface SearchResult { title: string; url: string; snippet: string; source: string }

export interface WebSearchProvider {
  id: string;
  search(query: string, limit: number): Promise<SearchResult[]>;
}

const tavily: WebSearchProvider = {
  id: 'tavily',
  async search(query, limit) {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.TAVILY_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query, max_results: limit }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Tavily ${res.status}`);
    const { results = [] } = await res.json();
    return results.map((r: { title: string; url: string; content: string }) => ({
      title: r.title, url: r.url, snippet: truncate(r.content ?? '', 400), source: new URL(r.url).hostname,
    }));
  },
};

// No-key fallback. Encyclopedic only — set TAVILY_API_KEY for real web results.
const wikipedia: WebSearchProvider = {
  id: 'wikipedia',
  async search(query, limit) {
    const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=${limit}&srsearch=${encodeURIComponent(query)}`;
    const res = await fetch(url, { headers: { 'user-agent': 'JARVIS/0.1 (personal assistant)' }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`Wikipedia ${res.status}`);
    const { query: q } = await res.json();
    return (q?.search ?? []).map((r: { title: string; snippet: string }) => ({
      title: r.title,
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, '_'))}`,
      snippet: r.snippet.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&'),
      source: 'wikipedia.org',
    }));
  },
};

export const webSearchProvider = (): WebSearchProvider => (process.env.TAVILY_API_KEY ? tavily : wikipedia);
