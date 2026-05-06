/**
 * Session-tracking middleware.
 *
 * Records the last authenticated API action for each user in the
 * SESSIONS KV namespace. The write is non-blocking (`waitUntil`)
 * so it never adds latency to the API response.
 *
 * KV entry shape:
 *   key   = userSub
 *   value = JSON { email, action, timestamp }
 *
 * @module
 */

import type { MiddlewareHandler } from "hono";
import type { AuthVariables } from "@lib/cloudflare-auth";

/** Value stored in the SESSIONS KV namespace for each user. */
export interface SessionEntry {
  email: string;
  action: string;
  timestamp: string;
}

/**
 * Hono middleware that writes a session entry to KV after the route
 * handler has executed. Runs for every `/api` request regardless of
 * response status.
 */
export const sessionTracker: MiddlewareHandler<{
  Bindings: Env;
  Variables: AuthVariables;
}> = async (c, next) => {
  await next();

  const userSub = c.get("userSub");
  if (!userSub) return;

  const entry: SessionEntry = {
    email: c.get("userEmail"),
    action: new URL(c.req.url).pathname,
    timestamp: new Date().toISOString()
  };

  c.executionCtx.waitUntil(c.env.SESSIONS.put(userSub, JSON.stringify(entry)));
};
