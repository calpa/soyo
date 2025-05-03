import { Hono } from "hono";
import { z } from "zod";
import { fetchShareThisCounts } from "./fetchShareThisCounts";

/**
 * Zod schema for update task messages.
 */
const UpdateTaskSchema = z.object({
  task: z.enum(["UPDATE_SHARE_COUNT"]),
  url: z.string().url(),
});

/**
 * Hono app configured for Cloudflare Workers.
 * @type {Hono<{ Bindings: CloudflareBindings }>}
 */
const app = new Hono<{ Bindings: CloudflareBindings }>();

/**
 * GET /
 * Basic health check endpoint.
 * @route GET /
 * @returns {string} Hello World
 */
app.get("/", async (c) => {
  return c.text("Hello World")!;
});

/**
 * GET /share-count
 * Returns the social share counts for the provided URL.
 * @route GET /share-count
 * @param {string} url - The URL to get share counts for (query).
 * @returns {object} 200 - JSON object with share count data.
 * @returns {object} 400 - Missing url parameter.
 * @returns {object} 422 - Validation failed.
 * @returns {object} 500 - Fetching counts failed.
 */
app.get("/share-count", async (c) => {
  const url = c.req.query("url");
  if (!url) return c.json({ error: "Missing url parameter" }, 400);
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
 * @route GET /cached-share-count
 * @param {string} url - The URL to get cached share count for (query).
 * @returns {object} 200 - Cached share count data.
 * @returns {object} 400 - Missing url parameter.
 * @returns {object} 404 - Not found.
 * @returns {object} 500 - Failed to parse cached value.
 */
app.get('/cached-share-count', async (c) => {
  const url = c.req.query('url');
  if (!url) return c.json({ error: 'Missing url parameter' }, 400);

  const raw = await c.env.soyo_kv_store.get(`share-count:${url}`);
  if (!raw) return c.json({ error: 'Not found' }, 404);

  try {
    return c.json(JSON.parse(raw));
  } catch (e) {
    return c.json({ error: 'Failed to parse cached value' }, 500);
  }
});

/**
 * GET /admin/kv-entries
 * Returns all key-value entries from the KV store as JSON.
 * Requires an admin token in the X-TOKEN header for authorization.
 * 
 * @route GET /admin/kv-entries
 * @header {string} X-TOKEN - Admin token for authentication.
 * @returns {object} 200 - KV entries as JSON.
 * @returns {object} 401 - Unauthorized if token is missing or invalid.
 * @returns {object} 500 - Unexpected error.
 */
app.get("/admin/urls", async (c) => {
  const auth = c.req.header("Authorization") ?? "";
  const token = auth.replace("Bearer ", "");

  if (token !== c.env.ADMIN_TOKEN) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  try {
    const result = await c.env.soyo_kv_store.list();
    const entries: Record<string, any> = {};

    for (const { name } of result.keys) {
      const value = await c.env.soyo_kv_store.get(name);

      const url = name.split('share-count:')[1];

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
 * POST /admin/save-urls
 * Saves a list of URLs to the KV store if not already present.
 * Requires an admin token in the X-TOKEN header for authorization.
 * 
 * @route POST /admin/save-urls
 * @header {string} X-TOKEN - Admin token for authentication.
 * @body {object} urls - Array of valid URLs to be saved.
 * @returns {object} 200 - Success response with count of saved URLs.
 * @returns {object} 401 - Unauthorized if token is missing or invalid.
 * @returns {object} 422 - Validation failed.
 * @returns {object} 500 - Unexpected error.
 */
app.post("/admin/urls", async (c) => {
  const auth = c.req.header("Authorization") ?? "";
  const token = auth.replace("Bearer ", "");

  if (token !== c.env.ADMIN_TOKEN) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const body = await c.req.json();
  const schema = z.object({ urls: z.array(z.string().url()) });

  try {
    const { urls } = schema.parse(body);

    let saved = 0;
    for (const url of urls) {
      const key = `share-count:${url}`;
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
 * @param message - The queue message.
 * @param env - The environment bindings.
 */
async function messageHandler(
  message: { body: unknown; ack: () => void },
  env: CloudflareBindings
): Promise<void> {
  try {
    const body = UpdateTaskSchema.parse(message.body);

    if (body.task === "UPDATE_SHARE_COUNT") {
      const count = await fetchShareThisCounts(body.url);
      await env.soyo_kv_store.put(`share-count:${body.url}`, String(count.total));
    }

    message.ack();
  } catch (e) {
    console.error(e);
  }
}

/**
 * Cloudflare Worker export handler including fetch and queue event handlers.
 * @type {ExportedHandler<CloudflareBindings>}
 */
const exportHandler: ExportedHandler<CloudflareBindings> = {
  fetch: app.fetch,
  /**
   * Processes batch queue messages for share count updates.
   * @param {BatchQueue<unknown>} batch - The batch of messages to process.
   * @param {CloudflareBindings} env - The environment bindings.
   * @param {ExecutionContext} ctx - The execution context.
   */
  async queue(batch, env, ctx) {
    for await (const message of batch.messages) {
      await messageHandler(message, env);
    }
  },
  /**
   * Scheduled handler runs every hour to update share counts.
   * @param {ScheduledController} controller
   * @param {CloudflareBindings} env
   * @param {ExecutionContext} ctx
   */
  async scheduled(controller, env, ctx) {
    const result = await env.soyo_kv_store.list({
      prefix: 'share-count:'
    });
    for (const key of result.keys) {
      const url = key.name.split('share-count:')[1];
      const count = await fetchShareThisCounts(url);
      await env.soyo_kv_store.put(key.name, String(count.total));
    }
  },
};

export default exportHandler;
