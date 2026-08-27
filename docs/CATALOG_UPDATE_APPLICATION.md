# Applying Cost Catalog Updates

## Existing Estimate states

The database stores Estimate `status` as a free-form string. Production creation currently uses `draft`; the shared footer also understands `isLocked`, and existing fixtures expose `ready` and `approved`. There was no durable business-revision lineage before this feature.

The domain policy treats unlocked `draft`, `working`, `active`, `ready`, `unlocked` and empty status as editable. `submitted`, `approved`, `locked`, `closed`, `archived`, an explicit `isLocked`, and unknown non-empty statuses are historical/non-editable. Unknown statuses are conservative to prevent silent history mutation.

## Strategy

- `UPDATE_IN_PLACE`: editable estimate; retains client/database identity and business revision.
- `CREATE_REVISION`: historical estimate; original stays untouched and a new draft is created from the projected preview.

`revision` remains the existing database optimistic-concurrency token. The additive `estimateRevision` is the business revision. New revisions store `parentEstimateId` and `sourceEstimateRevision`; no parallel SQL identity is introduced.

## Preview guard and stale inputs

`prepareCatalogUpdate` returns the preview and a guard containing deterministic fingerprints of the complete Estimate, relevant catalog DTOs and update options. Apply requires that guard. A changed Estimate throws `ESTIMATE_CHANGED_SINCE_PREVIEW`; changed catalog content throws `CATALOG_CHANGED_SINCE_PREVIEW`. In-place persistence additionally reuses the backend's expected `revision`. New historical revisions carry a source guard so the backend can validate the parent revision in the same transaction.

## Applied data and preservation

The applied Estimate comes from `CatalogUpdatePreviewService.projectedEstimate`; its catalog revisions, snapshots, effective pricing and Assembly children therefore match preview. Quantity, Takeoff quantity, project waste, margins, taxes, difficulty, notes and overrides are preserved. Missing, legacy and manual items remain intact.

Partial updates accept `selectedCatalogItemIds` and the Preview options `includePricing`, `includeLabor`, `includeEquipment`, and `includeAssemblies`.

## Historical revisions and Takeoff

Takeoff geometry is estimate-scoped. Reusing a source layer ID in a newly created Estimate would cross namespaces, so revision creation detaches Takeoff links by default while preserving measured quantity and `copiedFromTakeoffLayerId`. A caller may request preservation only after independently establishing a safe duplicated Takeoff namespace.

## Traceability and conflicts

Each updated item records its previous/new catalog revision in `lastCatalogRefresh`. Each operation appends compact `catalogRefreshHistory` containing totals, changed/skipped items, revision maps, override counts, warnings, fingerprints and strategy.

Removed Assembly children are not active in the new composition. If one had overrides, full child identity, overrides and prior snapshot are retained in `catalogUpdateConflicts` with code `REMOVED_COMPONENT_WITH_OVERRIDE`.

## Persistence

All lineage, history and conflicts are preserved by the authoritative `estimate_workspace_states.state_json`; no SQL migration is required. `projectEstimatingApplyCatalogUpdate` delegates saving to the existing revision-aware PATCH flow. If persistence fails, it reports `CATALOG_UPDATE_PERSISTENCE_FAILED` and deliberately preserves the projected local draft as dirty data so a network failure cannot discard the user's accepted update.

The non-visual orchestration API is:

- `projectEstimatingPrepareCatalogUpdate(options)` — flushes pending Estimate changes, loads a canonical catalog snapshot, and returns preview plus guard.
- `projectEstimatingApplyCatalogUpdate(prepared, options)` — reloads the catalog, validates both guards, applies the projection, and waits for the existing server save/ACK.

## Future UI contract

The UI should call prepare, display preview/change/conflict information, then pass the unchanged guard to apply. Any stale error requires a new preview. This phase adds no buttons or modal.
