// Vercel Function entry: every /api/* request is rewritten here (see vercel.json).
import { app } from '../server/app.js';

export const GET = app.fetch;
export const POST = app.fetch;
export const PUT = app.fetch;
export const DELETE = app.fetch;
