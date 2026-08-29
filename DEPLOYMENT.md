# Deployment

Two containers — `backend` (.NET 9 API) and `frontend` (Next.js 16) — orchestrated by
`docker-compose.yml` at the repo root. There is no MongoDB container: every environment,
dev included, points at the same MongoDB Atlas cluster, so the connection string is just
configuration, not infrastructure this compose file owns.

## Run it

```bash
cp .env.example .env   # fill in MONGO_CONNECTION_STRING, JWT_KEY, and the AI provider keys you have
docker compose up --build
```

Backend: `http://localhost:5058` (health check at `/health`). Frontend: `http://localhost:3000`.

## Environment variables

See `.env.example` for the full list. The two that matter most:

- `MONGO_CONNECTION_STRING` — Atlas SRV connection string. Required; there's no local fallback in a container the way `mongodb://localhost:27017` works for a bare `dotnet run`.
- `JWT_KEY` — 32+ random characters. The backend starts without it (logs a warning) but every issued token fails validation until it's set — this is not optional for anything beyond a smoke test.

`OPENAI_API_KEY` / `GROQ_API_KEY` / `GEMINI_API_KEY` are each independently optional — a
provider with no key simply reports `configured: false` from `GET /api/v1/assistant/providers`
rather than failing startup. At least one should be set for the AI Assistant to do anything.

`SMTP_HOST` / `SMTP_USER` / `SMTP_PASSWORD` are optional too — set all three to enable "Send by
email" on a Saved Report (see `ReportsController.EmailSaved`); without them, that action
returns a clear 503 instead of failing startup. Sends through an already-owned mailbox (Gmail,
Microsoft 365, ...) via SMTP rather than a transactional-email API — those require verifying a
domain, which isn't assumed here. `SMTP_PASSWORD` is an app password once the account has
2FA/MFA on, not its real login password.

## Persistent data

Sale-import Excel files, uploaded Knowledge Base documents, and lot photos/voice notes are
all disk-backed (not in Mongo) — see `SaleFileStore`, `LocalDocumentStore`, and
`LocalLotMediaStore`. In the container they resolve to `/data`, backed by the `asc-data`
named volume declared in `docker-compose.yml`, so they survive a rebuild/restart. Losing
that volume means re-importing sale files and re-uploading documents from scratch.

## Cost tracking

Every AI Gateway call is logged to the `aiUsageLogs` Mongo collection (tokens, provider,
model, success). `GET /api/v1/admin/ai-usage/summary?days=7` (Admin only) reports it grouped
by provider/model. Estimated USD cost is only computed for models with a price entry under
`AiPricing:<model>:PromptPer1M` / `AiPricing:<model>:CompletionPer1M` in configuration — add
those (via an environment variable like `AiPricing__gpt-5.1__PromptPer1M`, or an
`appsettings.Production.json`) if you want dollar figures rather than just token counts; a
model with no configured price simply reports `estimatedCostUsd: null`, never a guessed number.

## Production on a VPS (recommended)

The recommended production target is a single small VPS running this same compose setup —
the workload (a handful of users, weekly import spikes, one persistent `/data` volume,
25-second Excel parses that want RAM and fast local disk, never horizontal scale) fits one
4GB box far better than a PaaS. Concretely: a 2 vCPU / 4GB instance in a region near both
the users and the Atlas cluster (DigitalOcean Bangalore ≈ $24/mo, or Hetzner Singapore as
the budget option). Azure App Service (B2+, Linux containers) works too at roughly 2–4× the
cost — a reasonable trade only if managed infrastructure is a requirement.

`docker-compose.prod.yml` adds Caddy for TLS termination and reverse proxying, with
`deploy/Caddyfile` routing `/api/*` and `/health` to the backend and everything else to the
frontend — one domain, one certificate (automatic via Let's Encrypt), and because the
frontend is built with `PUBLIC_API_BASE_URL` set to that same origin, no CORS in play at all.

### Steps

1. **Provision** — Ubuntu LTS, 2 vCPU / 4GB, in the region closest to the users/Atlas.
   Install Docker (`curl -fsSL https://get.docker.com | sh`).
2. **Firewall** — only SSH and the web ports; the base compose file's dev ports (5058/3000)
   must not be reachable from outside:
   `ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw enable`
3. **DNS** — point the domain (e.g. `hub.example.com`) at the server's IP before first
   start, so Caddy's certificate issuance succeeds immediately.
4. **Atlas** — allow the server's IP in the Atlas cluster's network access list.
5. **Configure** — clone the repo, `cp .env.example .env`, fill in the usual values plus:
   `SITE_ADDRESS=hub.example.com`, `PUBLIC_API_BASE_URL=https://hub.example.com`,
   `CORS_ALLOWED_ORIGINS=https://hub.example.com`.
6. **Launch** —
   `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build`
   Verify `https://hub.example.com/health`, then log in and import a sale file.
7. **Back up `/data`** — the one thing Atlas doesn't cover (sale files, documents, media —
   see "Persistent data" above). Nightly cron on the server, kept off-box:
   `docker run --rm -v asc-data:/data -v /root/backups:/backup alpine tar czf /backup/asc-data-$(date +%F).tar.gz -C /data .`
   plus your provider's weekly machine snapshot.
8. **Update** — `git pull` then re-run the launch command; the named volumes (`asc-data`,
   Caddy's certificates) survive rebuilds.

Keep `Local:Model` unset in production — the Ollama provider is a dev/testing tool and
stays out of the provider list unless explicitly opted into.

## What's intentionally not here

- **No reverse proxy / TLS termination in the Dockerfiles** — TLS lives one level up: the
  production compose override's Caddy container (above), or whatever a different deployment
  target already provides (a platform load balancer, nginx-ingress).
- **No Kubernetes manifests** — two services, one Atlas dependency, doesn't warrant it yet;
  `docker-compose.yml` is the right size for the current scale.
- **No CI/CD pipeline** — building/pushing these images and deploying them is a separate,
  deliberately unstarted piece of work.
