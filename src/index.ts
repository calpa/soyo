import { Hono } from "hono";
import { z } from "zod";
import { fetchShareThisCounts } from "./fetchShareThisCounts";

const TASK_UPDATE_SHARE_COUNT = "UPDATE_SHARE_COUNT" as const;
const KV_PREFIX = "share-count:";
const ADMIN_HEADER = "Authorization";
const ADMIN_TOKEN_HEADER_PREFIX = "Bearer ";
const ADMIN_TOKEN_ERROR = "Unauthorized";
const MISSING_URL_ERROR = "Missing url parameter";
const NOT_FOUND_ERROR = "Not found";
const PARSE_ERROR = "Failed to parse cached value";

/**
 * Zod schema for update task messages.
 */
const UpdateTaskSchema = z.object({
  task: z.enum([TASK_UPDATE_SHARE_COUNT]),
  url: z.string().url(),
});

/**
 * Hono app configured for Cloudflare Workers.
 */
const app = new Hono<{ Bindings: CloudflareBindings }>();

/**
 * GET /
 * Basic health check endpoint.
 */
app.get("/", async (c) => c.text("Hello World")!);

/**
 * GET /share-count
 * Returns the social share counts for the provided URL.
 */
app.get("/share-count", async (c) => {
  const url = c.req.query("url");
  if (!url) return c.json({ error: MISSING_URL_ERROR }, 400);
  try {
    const data = await fetchShareThisCounts(url);
    return c.json(data);
  } catch (e: any) {
    if (e instanceof z.ZodError) {
      return c.json({ error: "Validation failed", issues: e.issues }, 422);
    }
    return c.json({ error: e.message }, 500);
  }
});

/**
 * GET /cached-share-count
 * Returns the cached share count for the provided URL from KV.
 */
app.get("/cached-share-count", async (c) => {
  const url = c.req.query("url");
  if (!url) return c.json({ error: MISSING_URL_ERROR }, 400);

  const raw = await c.env.soyo_kv_store.get(`${KV_PREFIX}${url}`);
  if (!raw) return c.json({ error: NOT_FOUND_ERROR }, 404);

  try {
    return c.json(JSON.parse(raw));
  } catch {
    return c.json({ error: PARSE_ERROR }, 500);
  }
});

/**
 * GET /admin/urls
 * Returns all key-value entries from the KV store as JSON.
 * Requires an admin token in the Authorization header.
 */
app.get("/admin/urls", async (c) => {
  const auth = c.req.header(ADMIN_HEADER) ?? "";
  const token = auth.replace(ADMIN_TOKEN_HEADER_PREFIX, "");
  if (token !== c.env.ADMIN_TOKEN) return c.json({ error: ADMIN_TOKEN_ERROR }, 401);

  try {
    const result = await c.env.soyo_kv_store.list();
    const entries: Record<string, any> = {};
    for (const { name } of result.keys) {
      const value = await c.env.soyo_kv_store.get(name);
      const url = name.split(KV_PREFIX)[1];
      let parsed: any;
      try {
        parsed = JSON.parse(value ?? "");
      } catch {
        parsed = value;
      }
      entries[url] = parsed;
    }
    return c.json({ success: true, data: entries });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

/**
 * POST /admin/urls
 * Saves a list of URLs to the KV store if not already present.
 * Requires an admin token in the Authorization header.
 */
app.post("/admin/urls", async (c) => {
  const auth = c.req.header(ADMIN_HEADER) ?? "";
  const token = auth.replace(ADMIN_TOKEN_HEADER_PREFIX, "");
  if (token !== c.env.ADMIN_TOKEN) return c.json({ error: ADMIN_TOKEN_ERROR }, 401);

  const body = await c.req.json();
  const schema = z.object({ urls: z.array(z.string().url()) });

  try {
    const { urls } = schema.parse(body);
    let saved = 0;
    for (const url of urls) {
      const key = `${KV_PREFIX}${url}`;
      const existing = await c.env.soyo_kv_store.get(key);
      if (existing === null) {
        await c.env.soyo_kv_store.put(key, "0");
        saved++;
      }
    }
    return c.json({ success: true, saved, total: urls.length });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return c.json({ error: "Validation failed", issues: err.issues }, 422);
    }
    return c.json({ error: err.message }, 500);
  }
});

/**
 * Processes a single queue message for share count updates.
 */
async function messageHandler(
  message: { body: unknown; ack: () => void },
  env: CloudflareBindings
): Promise<void> {
  try {
    const body = UpdateTaskSchema.parse(message.body);
    if (body.task === TASK_UPDATE_SHARE_COUNT) {
      const count = await fetchShareThisCounts(body.url);
      await env.soyo_kv_store.put(`${KV_PREFIX}${body.url}`, String(count.total));
    }
    message.ack();
  } catch (e) {
    console.error(e);
  }
}

/**
 * Cloudflare Worker export handler including fetch and queue event handlers.
 */
const exportHandler: ExportedHandler<CloudflareBindings> = {
  fetch: app.fetch,
  async queue(batch, env, ctx) {
    for await (const message of batch.messages) {
      await messageHandler(message, env);
    }
  },
  async scheduled(controller, env, ctx) {
    const result = await env.soyo_kv_store.list({ prefix: KV_PREFIX });
    for (const key of result.keys) {
      const url = key.name.split(KV_PREFIX)[1];
      const count = await fetchShareThisCounts(url);
      await env.soyo_kv_store.put(key.name, String(count.total));
    }
  },
};

export default exportHandler;
