# 15 — Knowledge Base

## Purpose
Define the module that makes uploaded documents (circulars, SOPs, policies) searchable by every user — the platform's institutional-memory store, complementary to the data-grounded AI Assistant.

## Scope
The `/knowledge` route and `Modules/Documents`. Shares the OpenAI dependency with [08_AI_Assistant.md](08_AI_Assistant.md) but is a distinct data source (documents, not sale data).

## Responsibilities
- Accept document uploads.
- Index them (via OpenAI embeddings) for semantic search.
- Serve search results to users directly and, potentially, to the AI Assistant as an additional tool source.

## Architecture
Frontend: `frontend/src/app/(app)/knowledge/`. Backend: `Modules/Documents` (`api/v1/documents` — upload/search). Documents and their embedded chunks persist to MongoDB (`documents`/`documentChunks`). Requires the same `OpenAI:ApiKey` user secret as the AI Assistant — see root README §1b.

## UI behaviour
Upload a document → search across all uploaded documents by natural-language query → view matching chunks/documents. Should degrade clearly (not silently) if `OpenAI:ApiKey` isn't configured, since upload/search both depend on it.

## Business rules
- Documents are org-wide/shared by default (searchable by every user), not per-user private — confirm this against `Modules/Documents`'s actual access model before building any feature that assumes otherwise.
- Embedding + chunking strategy should stay consistent across documents so search relevance doesn't degrade for documents uploaded at different times with different logic.

## Dependencies
[08_AI_Assistant.md](08_AI_Assistant.md) (shared OpenAI dependency, potential future tool integration), [18_Security.md](18_Security.md) (upload access control).

## Future expansion
Wiring Knowledge Base search into the AI Assistant as a callable tool, so a chat answer can cite an uploaded SOP directly rather than the two features being used separately.

## Implementation notes
Backend routes: `api/v1/documents/*`. Requires `OpenAI:ApiKey`.

## Open questions
- Document access control (all users vs. role-scoped) isn't documented — verify against `Modules/Documents` and [17_User_Management.md](17_User_Management.md)'s role model.

## Best practices
Don't duplicate document-search logic in the AI Assistant module — if/when the Assistant should search documents, it should call into `Modules/Documents`, not reimplement embedding search.
