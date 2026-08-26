# BOQ Flat Cost Catalog boundary

## Previous flow

`project_estimating.js` performed a direct request to `api/cost_catalog.php?action=list&view=all` while exporting BOQ Flat. `estimating_export_service.js` then interpreted SQL-shaped `allItems` and `assemblyParts`, including `item_type`, `cost_type`, `unit_cost`, `labor_hours`, `assembly_catalog_item_id`, and `part_catalog_item_id`.

The export service hydrated estimate rows from those raw objects, expanded assembly children, multiplied assembly quantity by component quantity, consolidated leaves by catalog item and UOM, and finally rendered CSV columns.

## Canonical flow

`CatalogService.getSnapshot()` → `CatalogItemDTO[]` → `BoqCatalogAdapter.hydrateEstimate()` → existing `EstimatingExportService.flatRows()`.

The adapter is a pure boundary. It performs no network access, DOM mutation, or persistence. It indexes DTOs by `id`, hydrates estimate catalog rows, and resolves each `assemblyComponent.catalogItemId` against the same DTO index.

## Mappings

| DTO type | BOQ semantic category | Canonical pricing |
| --- | --- | --- |
| `PART` | `material` | `pricing.materialUnitCost` |
| `EQUIPMENT` | `equipment` | `pricing.equipmentUnitCost` |
| `LABOR` | `labor` | `pricing.laborRate`, `pricing.laborHoursPerUnit` |
| `ASSEMBLY` | `assembly` | leaf components supply pricing |
| `OTHER` | `other` | no implicit Material classification |

Identity and descriptive fields retained by the BOQ boundary include catalog item ID/revision, name, description, UOM, manufacturer, catalog number, cost code, catalog/category objects, and a display catalog path.

## Assembly behavior and parity

Assembly definitions now come only from `CatalogItemDTO.assemblyComponents`. The component relation is enriched through its child `CatalogItemDTO`; SQL-shaped `assembly_parts` rows are never consumed by BOQ.

The existing calculation behavior is unchanged:

- a normal component quantity is multiplied by its parent assembly quantity;
- `childrenQuantitiesExtended` continues to prevent a second extension;
- leaf rows consolidate by catalog item ID plus UOM;
- calculations keep full JavaScript numeric precision until the existing CSV presentation;
- nested embedded assemblies still use the pre-existing recursive `flatRows` behavior and cycle guard. No new universal assembly engine was introduced.

If a component cannot be enriched, its canonical pricing snapshot is retained but its semantic type/category is `OTHER`/`other`; it is not silently classified as Material.

## Compatibility differences

The CSV keeps the historical `Unit Material Cost` column name. For an Equipment row it displays `unitEquipmentCost` in that legacy column so the visible value remains available, while the internal object remains explicitly Equipment. Flat rows now also label Equipment, Labor, and Other according to their canonical type instead of calling every leaf `Part`.

Existing Parts and Assemblies retain their quantity and pricing behavior. No Takeoff, Estimating calculation, SQL, persistence, or visual layout code was changed.

## Remaining debt and consumers

- The CSV schema should eventually gain explicit Material, Equipment, and Labor columns rather than retaining the legacy generic column.
- Nested assemblies and advanced ratio/spacing/waste behavior remain owned by the existing partial assembly implementation. A shared Assembly engine is a later phase.
- The Cost Catalog administration UI still consumes raw API shapes for its mutation workflow and is intentionally outside this migration.
- Availability/project eligibility still needs authoritative backend support in `CatalogService`.
