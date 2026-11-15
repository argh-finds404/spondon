/** Shared by the route handlers. The API holds no credentials and keeps nothing, so any origin may call it. */
export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
} as const;

export function jsonError(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: CORS_HEADERS });
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/** A finite number from a query parameter, inside [min, max]; otherwise an error message. */
export function numberParam(
  params: URLSearchParams,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number | string {
  const raw = params.get(name);
  if (raw === null || raw === "") return fallback;
  const v = Number(raw);
  if (!Number.isFinite(v) || v < min || v > max) return `${name} must be a number from ${min} to ${max}.`;
  return v;
}
