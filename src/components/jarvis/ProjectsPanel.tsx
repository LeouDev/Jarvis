import { FolderGit2, Globe, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../../lib/supabase';

interface Project { id: string; name: string; aliases: string[]; path: string | null; website: string | null; repo: string | null; description: string | null }
type Draft = { name: string; aliases: string; path: string; website: string; repo: string; description: string };

const FIELDS = 'id, name, aliases, path, website, repo, description';
const field = 'w-full rounded-lg border border-line bg-black/30 px-3 py-2 text-sm text-white placeholder:text-faint focus:border-glow/50 focus:outline-none';
const toDraft = (p?: Project): Draft => ({
  name: p?.name ?? '', aliases: p?.aliases.join(', ') ?? '', path: p?.path ?? '', website: p?.website ?? '', repo: p?.repo ?? '', description: p?.description ?? '',
});

function ProjectForm({ initial, onSave, onCancel }: { initial: Draft; onSave: (d: Draft) => Promise<void>; onCancel: () => void }) {
  const [d, setD] = useState(initial);
  const [error, setError] = useState('');
  const set = (k: keyof Draft) => (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    await onSave(d).catch((err: Error) => setError(err.message));
  };
  return (
    <form onSubmit={submit} className="glass grid gap-2 p-4 sm:grid-cols-2">
      <input className={field} required maxLength={80} value={d.name} onChange={set('name')} placeholder="Name, e.g. 13C" aria-label="Project name" />
      <input className={field} value={d.aliases} onChange={set('aliases')} placeholder="Aliases, e.g. thirteen c" aria-label="Aliases" />
      <input className={`${field} font-mono sm:col-span-2`} value={d.path} onChange={set('path')} placeholder="Folder, e.g. /Volumes/Mac Storage/Development/13c" aria-label="Folder path" />
      <input className={field} type="url" value={d.website} onChange={set('website')} placeholder="Website, e.g. https://13c.online" aria-label="Website" />
      <input className={field} pattern="[\w.-]+/[\w.-]+" value={d.repo} onChange={set('repo')} placeholder="Repo, e.g. LeouDev/13c" aria-label="GitHub repo" />
      <input className={`${field} sm:col-span-2`} maxLength={500} value={d.description} onChange={set('description')} placeholder="What it is, in a sentence" aria-label="Description" />
      {error && <p className="text-sm text-danger sm:col-span-2">{error}</p>}
      <div className="flex justify-end gap-2 sm:col-span-2">
        <button type="button" onClick={onCancel} className="rounded-lg px-3 py-2 text-sm text-dim ring-1 ring-line hover:bg-white/5">Cancel</button>
        <button className="rounded-lg bg-arc px-4 py-2 text-sm font-medium text-white hover:bg-arc/85">Save</button>
      </div>
    </form>
  );
}

/** Where each project lives, so JARVIS opens the right folder, site or repo without guessing. */
export function ProjectsPanel({ version }: { version: number }) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [missingTable, setMissingTable] = useState(false);
  const [editing, setEditing] = useState<string | null>(null); // project id or 'new'

  const load = () =>
    supabase.from('projects').select(FIELDS).order('name').then(({ data, error }) => {
      setMissingTable(Boolean(error));
      setProjects(data ?? []);
    });
  useEffect(() => void load(), [version]);

  const save = async (id: string | null, d: Draft) => {
    const row = {
      name: d.name.trim(),
      aliases: d.aliases.split(',').map((a) => a.trim()).filter(Boolean),
      path: d.path.trim() || null,
      website: d.website.trim() || null,
      repo: d.repo.trim() || null,
      description: d.description.trim() || null,
      updated_at: new Date().toISOString(),
    };
    const { error } = id ? await supabase.from('projects').update(row).eq('id', id) : await supabase.from('projects').insert(row);
    if (error) throw new Error(error.code === '23505' ? 'A project with that name already exists.' : error.message);
    setEditing(null);
    await load();
  };

  const remove = async (p: Project) => {
    if (!confirm(`Remove ${p.name} from JARVIS? (Nothing on disk is touched.)`)) return;
    await supabase.from('projects').delete().eq('id', p.id);
    await load();
  };

  if (missingTable)
    return (
      <div className="glass p-4 text-sm text-dim">
        Projects need a one-time database update: run <code className="font-mono text-glow">supabase/migrations/20261005020000_projects.sql</code> in the Supabase SQL editor, then reload.
      </div>
    );

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="hud-label">Projects</h2>
        <button onClick={() => setEditing('new')} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-glow ring-1 ring-glow/25 hover:bg-glow/5">
          <Plus className="size-4" /> Add project
        </button>
      </div>
      {editing === 'new' && <ProjectForm initial={toDraft()} onSave={(d) => save(null, d)} onCancel={() => setEditing(null)} />}
      {projects?.length === 0 && editing !== 'new' && (
        <p className="text-sm text-faint">No projects yet. Add one, or tell JARVIS: “13C's website is 13c.online and it's in my Development folder.”</p>
      )}
      {projects?.map((p) =>
        editing === p.id ? (
          <ProjectForm key={p.id} initial={toDraft(p)} onSave={(d) => save(p.id, d)} onCancel={() => setEditing(null)} />
        ) : (
          <div key={p.id} className="glass group flex items-start gap-4 !rounded-xl p-4">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="text-[15px] text-white">
                {p.name}
                {p.aliases.length > 0 && <span className="ml-2 text-xs text-faint">aka {p.aliases.join(', ')}</span>}
              </div>
              {p.description && <p className="text-sm text-dim">{p.description}</p>}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                {p.path && <span className="truncate font-mono text-white/60">{p.path}</span>}
                {p.website && (
                  <a href={p.website} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-glow hover:underline"><Globe className="size-3" />{p.website.replace(/^https?:\/\//, '')}</a>
                )}
                {p.repo && (
                  <a href={`https://github.com/${p.repo}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-glow hover:underline"><FolderGit2 className="size-3" />{p.repo}</a>
                )}
              </div>
            </div>
            <div className="flex opacity-60 transition group-hover:opacity-100">
              <button onClick={() => setEditing(p.id)} aria-label={`Edit ${p.name}`} className="rounded-lg p-2 text-faint hover:bg-white/5 hover:text-white"><Pencil className="size-4" /></button>
              <button onClick={() => remove(p)} aria-label={`Remove ${p.name}`} className="rounded-lg p-2 text-faint hover:bg-danger/10 hover:text-danger"><Trash2 className="size-4" /></button>
            </div>
          </div>
        ),
      )}
    </section>
  );
}
