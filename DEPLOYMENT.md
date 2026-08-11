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

## What's intentionally not here

- **No reverse proxy / TLS termination** — put this behind whatever the deployment target
  already provides (a platform load balancer, Caddy, nginx-ingress). Out of scope for these
  Dockerfiles.
- **No Kubernetes manifests** — two services, one Atlas dependency, doesn't warrant it yet;
  `docker-compose.yml` is the right size for the current scale.
- **No CI/CD pipeline** — building/pushing these images and deploying them is a separate,
  deliberately unstarted piece of work.
