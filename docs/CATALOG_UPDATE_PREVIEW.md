# Catalog Update Preview

`CatalogUpdatePreviewService` creates a hypothetical clone of an Estimate, applies the currently selected Cost Catalog definitions to that clone, and calculates current/projected totals with `EstimateCalculationService`. It performs no fetch, DOM work, persistence, locking, revision creation or mutation of caller-owned data.

## Updateable fields

By default the preview replaces the clone's `catalogRevision` and `catalogSnapshot`, including material, equipment and subcontractor unit costs, labor hours/rate, semantics and Assembly components. Effective legacy fields are refreshed exclusively through `EstimatingCatalogSnapshotService`.

Options may omit pricing, labor or Assembly composition from the hypothetical snapshot. The default is:

```js
{ preserveOverrides: true, includeAssemblies: true, includePricing: true, includeLabor: true }
```

## Preserved project fields

Quantity and Takeoff measurements, waste, margins, difficulty, tax flags/settings, notes, equipment quantity and manual rows remain unchanged. Project overrides are preserved by default. Therefore a catalog price change protected by an override remains visible in the change set but has zero effective impact.

## Assemblies

The current calculation engine consumes embedded `children`, not only `catalogSnapshot.assemblyComponents`. The preview reconciles children on the clone by component ID, then catalog item ID, then original position. It updates quantities and attaches the current child DTO when available. If only component metadata is available, it creates a snapshot-backed compatibility child from the component pricing snapshot.

Removed children are inactive in the projected clone. A removed child with a pricing override produces `REMOVED_COMPONENT_WITH_OVERRIDE`. This is a preview warning and makes no product decision about later migration. Assembly Expansion Service is not substituted for the current calculation engine.

## Missing, legacy and unversioned items

- Missing catalog items stay unchanged and emit `MISSING_CATALOG_ITEM_PRESERVED`.
- Legacy items without historical snapshots stay unchanged and emit `LEGACY_ITEM_NOT_REFRESHABLE`.
- Unversioned current catalog items may be projected from unambiguous content and emit `UNVERSIONED_CATALOG_ITEM`.

## Calculation and totals

Both sides call `EstimateCalculationService.calculateSummary` with their own groups and identical project settings. The preview exposes normalized totals plus the untouched raw calculation result. Category differences derive from the engine's `byCategory`; formulas are never duplicated.

## Mutation safety

Estimate, nested items, snapshots, overrides, catalog DTOs and the supplied index are deep-cloned or read only. `applyCatalogChangesToClone` also clones its input, despite its name, so callers cannot accidentally mutate a working draft.

## Future UI integration

A future modal can display the change set, item impacts, warnings and total delta before submitting an explicit update command. Applying changes, creating Estimate revisions and persistence remain outside this phase.
