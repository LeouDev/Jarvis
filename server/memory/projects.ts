import type { SupabaseClient } from '@supabase/supabase-js';
import { UserFacingError } from '../lib/util.js';

export interface Project {
  id: string;
  name: string;
  aliases: string[];
  path: string | null;
  website: string | null;
  repo: string | null;
  description: string | null;
}

const FIELDS = 'id, name, aliases, path, website, repo, description';
const MISSING_TABLE = /projects|PGRST205|42P01/;
export const PROJECTS_SETUP = 'Projects need a one-time database update: run supabase/migrations/20261005020000_projects.sql in the Supabase SQL editor.';

/** All projects (empty if the table doesn't exist yet, so JARVIS keeps working before the migration). */
export async function listProjects(db: SupabaseClient): Promise<Project[]> {
  const { data, error } = await db.from('projects').select(FIELDS).order('updated_at', { ascending: false }).limit(30);
  if (error && !MISSING_TABLE.test(error.message + error.code)) console.error('[projects]', error.message);
  return (data ?? []) as Project[];
}

/** One compact line per project for the system prompt. */
export const projectLine = (p: Project) =>
  [
    p.name + (p.aliases.length ? ` (aka ${p.aliases.join(', ')})` : ''),
    p.description,
    p.path && `folder ${p.path}`,
    p.website && `site ${p.website}`,
    p.repo && `repo ${p.repo}`,
  ]
    .filter(Boolean)
    .join(' · ');

export type ProjectInput = Partial<Omit<Project, 'id'>> & { name: string };

/** Creates the project, or updates only the given fields of an existing one (matched case-insensitively). */
export async function saveProject(db: SupabaseClient, input: ProjectInput): Promise<Project> {
  const name = input.name.trim();
  const { data: rows, error: findError } = await db.from('projects').select(FIELDS).ilike('name', name.replace(/[%_\\]/g, '\\$&'));
  if (findError) throw new UserFacingError(MISSING_TABLE.test(findError.message + findError.code) ? PROJECTS_SETUP : findError.message);
  const fields: Record<string, unknown> = Object.fromEntries(Object.entries({ ...input, name }).filter(([, v]) => v !== undefined && v !== ''));
  const existing = rows?.[0] as Project | undefined;
  const query = existing
    ? db.from('projects').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', existing.id)
    : db.from('projects').insert(fields);
  const { data, error } = await query.select(FIELDS).single();
  if (error) throw new UserFacingError(`I couldn't save that project: ${error.message}`);
  return data as Project;
}
