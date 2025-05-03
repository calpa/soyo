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
  if (token !== c.env.ADMIN_TOKEN)
    return c.json({ error: ADMIN_TOKEN_ERROR }, 401);

  try {
    const result = await c.env.soyo_kv_store.list();
    const entries: Record<string, unknown> = {};
    await Promise.all(
      result.keys.map(async ({ name }) => {
        const value = await c.env.soyo_kv_store.get(name);
        const url = name.slice(KV_PREFIX.length);
        if (value && value !== "0") {
          entries[url] = Number(value);
        }
      })
    );
    const values = Object.values(entries);
    return c.json({
      success: true,
      data: {
        articles: values.length,
        totalCount: values.reduce((acc, val) => Number(acc) + Number(val), 0),
        entries,
      },
    });
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
  if (token !== c.env.ADMIN_TOKEN) {
    console.warn("Unauthorized admin access attempt");
    return c.json({ error: ADMIN_TOKEN_ERROR }, 401);
  }

  let body: unknown;
  try {
    body = await c.req.json();
    console.log("Received body for /admin/urls POST:", body);
  } catch (err) {
    console.error("Failed to parse JSON body:", err);
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const schema = z.object({ urls: z.array(z.string().url()) });

  try {
    const { urls } = schema.parse(body);
    console.log(`Validated URLs: ${urls.join(", ")}`);
    let saved = 0;
    await Promise.all(
      urls.map(async (url) => {
        const key = `${KV_PREFIX}${url}`;
        const existing = await c.env.soyo_kv_store.get(key);
        if (existing === null) {
          await c.env.soyo_kv_store.put(key, "0");
          saved++;
          console.log(`Saved new URL to KV: ${url}`);
        } else {
          console.log(`URL already exists in KV: ${url}`);
        }
      })
    );
    console.info(`Processed ${urls.length} URLs, saved ${saved}`);
    return c.json({ success: true, saved, total: urls.length });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      console.warn("Validation failed for /admin/urls POST:", err.issues);
      return c.json({ error: "Validation failed", issues: err.issues }, 422);
    }
    console.error("Error in /admin/urls POST:", err);
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
      await env.soyo_kv_store.put(
        `${KV_PREFIX}${body.url}`,
        String(count.total)
      );
    }
    message.ack();
  } catch (e) {
    console.error(e);
  }
}

async function updateAll(env: CloudflareBindings) {
  // Retrieve all keys with the specified prefix from the KV store
  const result = await env.soyo_kv_store.list({ prefix: KV_PREFIX });

  // Construct messages for each URL to update share counts
  const messages = result.keys.map((key) => {
    const url = key.name.split(KV_PREFIX)[1];
    return { body: { task: TASK_UPDATE_SHARE_COUNT, url } };
  });

  // Send messages in batches of 100
  for (let i = 0; i < messages.length; i += 100) {
    const batch = messages.slice(i, i + 100);
    await env.soyo_queue.sendBatch(batch);
  }

  console.log(`All tasks have been sent`);
}

/**
 * POST /admin/update-all
 * Manually update share counts for all cached URLs.
 * Requires an admin token in the Authorization header.
 */
app.post("/admin/update-all", async (c) => {
  const auth = c.req.header(ADMIN_HEADER) ?? "";
  const token = auth.replace(ADMIN_TOKEN_HEADER_PREFIX, "");
  if (token !== c.env.ADMIN_TOKEN)
    return c.json({ error: ADMIN_TOKEN_ERROR }, 401);

  try {
    await updateAll(c.env);
    return c.json({ success: true });
  } catch (err: any) {
    console.error("Error in /admin/update-all POST:", err);
    return c.json({ error: err.message }, 500);
  }
});

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
    await updateAll(env);
  },
};

export default exportHandler;
