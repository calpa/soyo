# 🧃 soyo

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-orange?logo=cloudflare)](https://workers.cloudflare.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-4.x-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Hono](https://img.shields.io/badge/Hono-4.x-green?logo=hono)](https://hono.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> 🍹 **soyo** — A fast, serverless API for fetching and caching social share counts using Cloudflare Workers, Hono, and KV storage. Includes scheduled updates, admin endpoints, and queue processing for scalable analytics.

---

## 🚀 Features

- Fetch real-time social share counts for any URL via ShareThis
- Cache share counts in Cloudflare KV for fast retrieval
- Admin endpoints to manage and list cached URLs
- Serverless architecture with Cloudflare Workers & Hono
- Scheduled cron jobs to refresh share counts
- Queue-based updates for scalability
- TypeScript + Zod for type safety and validation

## 🛣️ API Endpoints

### Health Check
- `GET /` — Returns `Hello World` for health check

### Public Endpoints
- `GET /share-count?url=...` — Fetch live share counts for a URL
- `GET /cached-share-count?url=...` — Retrieve cached share counts from KV

### Admin Endpoints *(require `ADMIN_TOKEN`)*
- `GET /admin/urls` — List all cached URLs and their share counts
- `POST /admin/urls` — Add new URLs to be tracked
- `DELETE /admin/urls` — Remove URLs from tracking

> **Note:** Admin endpoints require an `Authorization: Bearer <ADMIN_TOKEN>` header.

## 🛠️ Tech Stack

- [Cloudflare Workers](https://workers.cloudflare.com/)
- [Hono](https://hono.dev/) (web framework)
- [TypeScript](https://www.typescriptlang.org/)
- [Zod](https://zod.dev/) (validation)
- Cloudflare KV (key-value storage)
- Cloudflare Queues (background processing)
- Wrangler (deployment & local dev)

## ⚡ Quick Start

```bash
# 1. Install dependencies
yarn install

# 2. Configure environment variables
cp .dev.vars.example .dev.vars  # Edit as needed

# 3. Start local dev server
yarn dev

# 4. Deploy to Cloudflare
yarn deploy
```

## ⚙️ Environment Variables

- `ADMIN_TOKEN` — Secret token for admin endpoints
- `soyo_kv_store` — Cloudflare KV namespace binding
- `soyo_queue` — Cloudflare Queue binding

Configure these in your `.dev.vars` or via Wrangler configuration.

## 📝 Example Usage

```bash
curl 'https://<your-worker-url>/share-count?url=https://example.com'
```

## ⏰ Scheduled Tasks & Queues
- **Cron:** Refreshes share counts every hour (`0 * * * *`)
- **Queue:** Handles batch updates for URLs

## 📁 Project Structure

```
src/
  ├── index.ts                # Main worker entry (routes, handlers)
  └── fetchShareThisCounts.ts # Fetch & validate share counts from ShareThis
wrangler.jsonc                # Cloudflare Worker config
package.json                  # Project metadata & scripts
tsconfig.json                 # TypeScript config
```

## 🤝 Contributing

PRs and issues welcome! Please open an issue to discuss major changes first.

## 📄 License

MIT

## 👤 Author

- Maintained by Calpa Liu

---

> Made with ❤️, Cloudflare, and 🍹 Soyo!
