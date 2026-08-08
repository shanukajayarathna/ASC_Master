# 26 — Testing Strategy

## Purpose
Define the platform's target testing approach, and honestly record what exists today vs. what doesn't, so test coverage is built deliberately rather than assumed.

## Scope
Testing across frontend and backend. Manual QA/acceptance criteria are included since, as of this writing, they are the platform's primary verification method.

## Responsibilities
- State current testing reality without overstating coverage.
- Define what each test layer should cover as the platform matures.
- Set acceptance-criteria expectations for new features.

## Architecture
No automated test suite (unit, integration, or UI) was confirmed present in either `frontend/` or `backend/Asc.Api` as part of the codebase survey behind this documentation set. `DevSeedController` (`api/dev`, Admin-only) exists as a dev/test seam for manual verification, not automated testing. **This is the single largest gap this documentation set surfaces** — treat closing it as a priority alongside, not after, new feature work.

## UI behaviour
Not applicable.

## Business rules

### Unit testing
Not present today. Target: backend service-layer logic (`CatalogueImportService`'s column/type detection, any future Shared Analytics Engine / Metrics Registry calculations — see [06_Shared_Analytics_Engine.md](06_Shared_Analytics_Engine.md), [07_Metrics_Registry.md](07_Metrics_Registry.md)) is the highest-value place to start, since a wrong metric calculation silently propagates to the dashboard, reports, and the AI Assistant simultaneously.

### Integration testing
Not present today. Target: import → valuation → analytics round-trip (the same flow the root README describes verifying "by hand against a real local MongoDB") is the platform's core happy path and the best candidate for an automated integration test.

### UI testing
Not present today. Target: Valuation Centre's tablet focus mode (highest business-criticality UI path) and the Catalogue Manager grid (most complex UI component) are the best first candidates if UI testing is introduced.

### Accessibility testing
Not present today. No automated accessibility audit tooling confirmed. See [02_UI_UX_Design_System.md](02_UI_UX_Design_System.md)'s accessibility section for baseline expectations that should eventually be checked automatically (contrast, keyboard operability).

### Performance testing
Not present today. See [19_Performance.md](19_Performance.md) — known seams (AG Grid row ceiling, uncached aggregations) are documented qualitatively, not measured via load testing.

### Regression testing
Not present today beyond manual verification. Given the "one number, one source" principle ([00_Project_Vision.md](00_Project_Vision.md)), a regression test that checks a given metric returns the same value across dashboard/report/AI-assistant surfaces would directly protect the platform's core trust property.

### Manual QA
Currently the platform's primary verification method — the root README documents a specific manual verification (import → list → paged/filtered lot query → valuation update → dashboard aggregates recompute → delete) that should be repeated after any change touching that path until automated coverage exists.

### Acceptance criteria
For any new feature built against this `/docs` set: (1) the relevant module doc is updated in the same change, (2) the feature's `NAV_ITEMS` `status` accurately reflects whether it's genuinely live, (3) any new/changed metric is traceable to a single calculation (registry entry once it exists, or clearly the sole computation site today), (4) the manual QA path relevant to the change has been walked through by hand.

## Dependencies
[06_Shared_Analytics_Engine.md](06_Shared_Analytics_Engine.md), [07_Metrics_Registry.md](07_Metrics_Registry.md) (highest-value unit test targets), [10_Valuation_Centre.md](10_Valuation_Centre.md) (highest-value integration/UI test target), [19_Performance.md](19_Performance.md).

## Future expansion
Stand up a test project for `backend/Asc.Api` (xUnit is the conventional choice for .NET) and a test setup for `frontend/` (Vitest/Jest + Testing Library are conventional choices for Next.js/React) as the first concrete step; prioritise the integration and unit targets named above over broad UI test coverage initially, given team size and the platform's current maturity.

## Implementation notes
Not applicable — no test infrastructure exists yet to describe.

## Open questions
- No decision recorded on test framework choice for either side of the stack — flagged here as a decision that should be made explicitly, not left to whoever adds the first test file.

## Best practices
- Don't let "no test suite exists yet" become a reason to skip the manual QA path described above — it's the only verification the platform currently has.
- When automated testing is introduced, start with the Shared Analytics Engine / Metrics Registry and the import→valuation→analytics round trip — both protect the platform's core trust property and its core workflow respectively.
