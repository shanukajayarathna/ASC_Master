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

## Platform docs sync
Beyond uploads, the knowledge base can hold the platform's own documentation (`docs/*.md` — every module guide) so the AI Assistant can answer "how does ASC Hub work" questions grounded in these docs, not from guesswork.

- **Trigger**: the "Sync platform docs" button on `/knowledge` (`POST api/v1/documents/sync-platform-docs`, `ManageKnowledgeBase` policy). Deliberately not run at startup — embedding costs money and needs the OpenAI key, so it stays an explicit admin action.
- **Pipeline**: same as uploads — `DocumentTextExtractor.Chunk` → `IEmbeddingProvider` → `documents`/`documentChunks`. The synced docs are ordinary `KnowledgeDocument`s (category `Reference`), so search, the Knowledge page list, and `search_knowledge_base` see them with no special-casing.
- **Idempotency**: each file's document id is deterministic (MD5 of its lowercased name, the `SaleFileStore` identity pattern), and a stored `ContentHash` (SHA-256 of the text) skips unchanged files — re-running after doc edits re-embeds only what changed; nothing ever duplicates. An edited doc is replaced in place (same id, fresh chunks).
- **Failures**: one unreadable/unembeddable file is reported in the result's `Failed` list without stopping the pass. See `PlatformDocsSyncService`.
- **Not fine-tuning**: this is retrieval, not model training. Facts live in the knowledge base and the structured tools, so answers stay current as data and docs change — a fine-tuned model would bake in stale facts and is deliberately not part of this design.

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
