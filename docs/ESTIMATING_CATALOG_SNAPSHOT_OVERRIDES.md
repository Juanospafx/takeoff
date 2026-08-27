# Estimating: Catalog Snapshot and Project Overrides

## Purpose

Estimating stores the exact Cost Catalog definition used when a catalog item is inserted. It does not refresh that definition automatically. Effective pricing is resolved as:

`project override -> catalog snapshot -> legacy workspace field`

This is additive. Existing estimates without canonical metadata continue using their legacy fields.

## Canonical fields

Catalog-linked workspace items contain:

- `catalogItemId`: stable catalog identity.
- `catalogRevision`: opaque revision captured at insertion.
- `catalogSnapshot`: independent copy of the canonical Catalog Item DTO values.
- `overrides`: project-specific pricing values; `null` means no override.

The snapshot records contract version, identity, revision, type, cost category, UOM, canonical pricing, assembly components, catalog and category. It never shares mutable references with `CatalogService`.

## Field ownership

| Ownership | Fields |
| --- | --- |
| Catalog-derived | item identity/type, catalog/category, UOM, material/equipment/subcontractor unit cost, labor hours, labor rate, assembly definition |
| Project-derived | quantity policy/override, waste, margins, taxability/taxes, difficulty, equipment quantity, notes |
| Calculated | extended quantities, labor hours, costs, sales, taxes, profit |
| Presentation-only | expanded state, selection, search and modal state |
| Ambiguous | display name, description and cost code originate in Catalog but remain editable estimate snapshots; a missing Catalog labor rate currently falls back to the project global labor rate and is recorded as a project override |

Catalog default waste, when present, is not copied into pricing overrides. The existing Estimating `waste` remains project-owned and formulas are unchanged.

## Effective and legacy values

The calculation engine still reads `unitMaterialCost`, `unitEquipmentCost`, `unitSubcontractorCost`, `unitLabor` and `laborRate`. `EstimatingCatalogSnapshotService` synchronizes those compatibility fields from the effective canonical values. UI edits of these fields on catalog-linked items create overrides instead of mutating the snapshot.

Manual items have `catalogSnapshot: null`, `catalogRevision: null`; their legacy values remain authoritative. Historical linked items without a snapshot also stay legacy. The application does not infer historical overrides or query the current catalog to fabricate a snapshot.

## Assemblies

An Assembly snapshot retains its revision and `assemblyComponents`, representing the exact definition inserted into the estimate. Identifiable embedded children also receive their own snapshots and overrides. This duplication is intentional: the parent records assembly composition, while each child records the catalog definition used for its calculated leaf. A child unavailable in the DTO index remains legacy rather than receiving fabricated metadata.

## Takeoff

When Takeoff supplies canonical `catalogMetadata`, Estimating creates the snapshot from that metadata and does not fetch Cost Catalog. Existing Estimating overrides are preserved. Geometry and measured quantity remain owned by Takeoff.

## Persistence

The authoritative `estimate_workspace_states.state_json` already stores complete workspace items, so the canonical fields round-trip without a schema migration. The relational `estimate_items` mirror continues storing effective legacy values and its item metadata copy; it is not a second canonical source.

## Future workflow (not implemented)

A later explicit “Update from Cost Catalog” workflow may compare revisions, preview changes and replace snapshots while preserving or reconciling project overrides. This phase performs no revision comparison, refresh, historical locking or revision UI.
