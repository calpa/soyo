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
 * GET /jobs
 * Enqueues batch jobs for updating share counts.
 * @route GET /jobs
 * @returns {object} 200 - Success and number of jobs enqueued.
 */
app.get("/jobs", async (c) => {
  const urls = ["https://calpa.me/blog/vitest-modern-testing-framework/"];

  const messages = urls.map((url) => ({
    body: {
      task: "UPDATE_SHARE_COUNT",
      url,
    },
  }));

  await c.env.soyo_queue.sendBatch(messages);

  return c.json({
    success: true,
    data: {
      jobs: messages.length,
    },
  });
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
};

export default exportHandler;
