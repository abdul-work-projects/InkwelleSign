import { NextResponse } from 'next/server';
import { authenticate, requestMeta, roleAtLeast } from './auth.js';

export function json(data, init = {}) {
  return NextResponse.json(data, init);
}

export function fail(message, status = 400, extra = {}) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

/**
 * Wraps a route handler with authentication, tenant scoping and uniform error
 * handling. `minRole` is checked against the caller's org role; API keys act as
 * `admin` within their own organisation only.
 */
export function withAuth(handler, { minRole = 'viewer' } = {}) {
  return async (request, context) => {
    try {
      const actor = await authenticate();
      if (!actor) return fail('Authentication required', 401);
      if (!roleAtLeast(actor.role, minRole)) return fail('Insufficient permissions', 403);
      const meta = await requestMeta();
      const params = context?.params ? await context.params : {};
      return await handler({ request, actor, meta, params, orgId: actor.orgId });
    } catch (err) {
      if (err?.statusCode === 413) return fail('Payload too large', 413);
      console.error('[api]', err);
      return fail(err?.message || 'Unexpected server error', err?.status || 400);
    }
  };
}

/** Public (token-authenticated) routes: no org session, but still uniform errors. */
export function withPublic(handler) {
  return async (request, context) => {
    try {
      const meta = await requestMeta();
      const params = context?.params ? await context.params : {};
      return await handler({ request, meta, params });
    } catch (err) {
      console.error('[api:public]', err);
      return fail(err?.message || 'Unexpected server error', err?.status || 400);
    }
  };
}

export async function readJson(request) {
  try { return await request.json(); } catch { return {}; }
}

export function pdfResponse(buffer, filename, { download = false } = {}) {
  return new NextResponse(buffer, {
    headers: {
      'content-type': 'application/pdf',
      'content-length': String(buffer.length),
      'content-disposition': `${download ? 'attachment' : 'inline'}; filename="${filename.replace(/"/g, '')}"`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
