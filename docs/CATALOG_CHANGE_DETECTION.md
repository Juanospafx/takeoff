# Catalog Change Detection

`CatalogChangeDetectionService` compares the immutable catalog snapshot stored on an Estimating item with a current `CatalogItemDTO`. It is read-only: it performs no fetch, persistence, DOM work, item mutation or catalog update.

## Statuses

- `CURRENT`: revisions and compared fields match.
- `OUTDATED`: the revision changed or compared content differs.
- `MISSING_IN_CATALOG`: the linked catalog item is absent from the supplied index.
- `LEGACY_NO_SNAPSHOT`: the estimate has no historical snapshot; no history is fabricated.
- `UNVERSIONED`: the current catalog item has no revision. Content differences are still reported.
- `ERROR`: invalid comparison input or mismatched catalog identities.

Revision equality is string-safe. Numeric revisions are ordered numerically; other revision formats are compared for exact equality. A lower numeric current revision is reported as a regression warning. Content mismatch remains evidence of an outdated item even when revision values match.

## Compared fields and impacts

Pricing compares material, equipment and subcontractor unit costs, labor hours and labor rate. A changed pricing value without an override is `EFFECTIVE_VALUE_CHANGE`. With an override it is `OVERRIDDEN_NO_EFFECT`: the catalog change remains visible but both projected and current effective values use the project override.

Type, cost category and UOM changes are `STRUCTURAL_CHANGE`. Catalog/category metadata changes are `INFORMATIONAL`. Removed values are `REMOVED`; values that cannot be interpreted are `UNRESOLVED`.

## Assemblies

Components are matched by component `id` when available. The documented fallback key is `catalogItemId + original position`; therefore legacy components without IDs cannot be safely treated as reorder-independent. Keeping ratio type out of the fallback identity allows ratio changes to be reported explicitly. For matched components the service compares quantity, ratio type, spacing, waste, pricing snapshot and child revision. Added and removed components and all component definition changes are structural. The service does not expand the Assembly.

## Missing and legacy items

Missing catalog items retain their historical snapshot and return `MISSING_IN_CATALOG`. Items without `catalogSnapshot` return `LEGACY_NO_SNAPSHOT`, even when a current catalog item exists; current values are not presented as historical changes.

## Estimate summary

`compareEstimate(estimate, catalogIndex)` recursively visits group items and identifiable embedded children. The caller supplies a `Map`, item array, or `{items}` snapshot. Summary counters describe item statuses; `changesByType` counts field changes by pricing, labor, equipment, assembly and informational categories.

## Economic preview integration point

A future update preview can clone an estimate, apply a selected new snapshot through `EstimatingCatalogSnapshotService`, and pass the clone to `EstimateCalculationService`. This service deliberately returns the before/projected effective values needed by that workflow but does not duplicate calculation formulas.

## Future update workflow

A later phase may display these change sets, allow selection, apply a new snapshot, preserve or clear overrides, and create an Estimate revision. None of those operations are implemented here.
