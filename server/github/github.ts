import { UserFacingError } from '../lib/util.js';

// Read-only GitHub access. Write operations (branches, commits, PRs) must go through
// a "dangerous" tool so they get the approval dialog.

export const GITHUB_ACTIONS = ['listRepos', 'getRepo', 'listBranches', 'listCommits', 'listIssues', 'listPulls', 'activity'] as const;
export type GithubAction = (typeof GITHUB_ACTIONS)[number];

async function gh(path: string) {
  const token = process.env.GITHUB_TOKEN;
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'jarvis', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) throw new UserFacingError('GitHub says that repository or user does not exist (or is private).');
  if (res.status === 403 || res.status === 429) throw new UserFacingError('GitHub rate limit reached. Add GITHUB_TOKEN to raise it.');
  if (!res.ok) throw new UserFacingError(`GitHub returned an error (${res.status}).`);
  return res.json();
}

const day = (iso: string) => iso?.slice(0, 10);

export async function github(input: { action: GithubAction; repo?: string; limit?: number }): Promise<string> {
  const user = process.env.GITHUB_USERNAME;
  const n = Math.min(input.limit ?? 10, 30);
  const repo = input.repo?.includes('/') ? input.repo : input.repo && user ? `${user}/${input.repo}` : input.repo;
  const needRepo = () => {
    if (!repo) throw new UserFacingError('Which repository? Use "owner/name".');
    return repo;
  };
  switch (input.action) {
    case 'listRepos': {
      if (!process.env.GITHUB_TOKEN && !user) throw new UserFacingError('Set GITHUB_USERNAME or GITHUB_TOKEN to list repositories.');
      const repos = await gh(process.env.GITHUB_TOKEN ? `/user/repos?sort=pushed&per_page=${n}` : `/users/${user}/repos?sort=pushed&per_page=${n}`);
      return repos.map((r: any) => `${r.full_name}${r.private ? ' (private)' : ''} — ${r.description ?? 'no description'} · pushed ${day(r.pushed_at)}`).join('\n') || 'No repositories.';
    }
    case 'getRepo': {
      const r = await gh(`/repos/${needRepo()}`);
      return `${r.full_name}: ${r.description ?? 'no description'}\nLanguage ${r.language ?? '?'} · ★${r.stargazers_count} · ${r.open_issues_count} open issues/PRs · default branch ${r.default_branch} · last push ${day(r.pushed_at)}`;
    }
    case 'listBranches':
      return (await gh(`/repos/${needRepo()}/branches?per_page=${n}`)).map((b: any) => b.name).join('\n') || 'No branches.';
    case 'listCommits':
      return (await gh(`/repos/${needRepo()}/commits?per_page=${n}`))
        .map((c: any) => `${c.sha.slice(0, 7)} ${day(c.commit.author?.date)} ${c.commit.author?.name}: ${c.commit.message.split('\n')[0]}`)
        .join('\n') || 'No commits.';
    case 'listIssues':
      return (await gh(`/repos/${needRepo()}/issues?state=open&per_page=${n}`))
        .filter((i: any) => !i.pull_request)
        .map((i: any) => `#${i.number} ${i.title} (${day(i.created_at)})`)
        .join('\n') || 'No open issues.';
    case 'listPulls':
      return (await gh(`/repos/${needRepo()}/pulls?state=open&per_page=${n}`))
        .map((p: any) => `#${p.number} ${p.title} by ${p.user?.login} (${p.head?.ref} → ${p.base?.ref})`)
        .join('\n') || 'No open pull requests.';
    case 'activity': {
      if (!user) throw new UserFacingError('Set GITHUB_USERNAME to see recent activity.');
      return (await gh(`/users/${user}/events?per_page=${n}`))
        .map((e: any) => `${day(e.created_at)} ${e.type.replace(/Event$/, '')} ${e.repo?.name}`)
        .join('\n') || 'No recent activity.';
    }
  }
}
