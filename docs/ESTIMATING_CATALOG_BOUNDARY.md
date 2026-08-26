# Estimating Add Item catalog boundary

## Previous flow

`project_estimating.js` fetched `cost_catalog.php`, stored raw `allItems` and `assemblyParts`, searched SQL-shaped fields, and constructed Workspace rows by interpreting `item_type`, `unit_cost`, `labor_hours`, and raw assembly links.

## Current flow

`CatalogService.getSnapshot()` → `CatalogItemDTO` → `EstimatingCatalogAdapter.catalogItemDtoToEstimatingItem()` → `Workspace.item()`.

The UI searches and renders DTO fields only. `EstimatingCatalogAdapter` owns all DTO-to-Workspace mappings and has no fetch, DOM, or persistence responsibilities.

## Mapping and parity

- PART: material pricing maps to `unitMaterialCost`; catalog labor hours map as hours. Existing Part totals are unchanged.
- EQUIPMENT: equipment pricing maps only to `unitEquipmentCost`; material cost remains zero. `equipmentQuantity` remains zero because the current engine treats it independently and this phase does not invent a quantity policy.
- LABOR: catalog `laborRate` wins when positive; estimate global labor cost is the fallback. Labor hours retain `laborUnitType='hrs'`.
- ASSEMBLY: parent aggregate compatibility pricing is retained. Children come from canonical `assemblyComponents`, enriched from the DTO item index. Component quantity remains per assembly and `childrenQuantitiesExtended=false`, so the current calculator multiplies it by parent quantity.
- OTHER/CUSTOM/TRAVEL: map to `Other`, never silently to Materials.

## Known limitations

- `Workspace.item()` still defaults unrecognized categories to Materials. The adapter restores its explicit category after normalization; a future workspace-wide category contract should remove this compatibility step.
- Equipment calculations use `equipmentQuantity`, not normal item `quantity`. Defining their relationship is a product/calculation decision outside this boundary.
- Nested assemblies are not expanded recursively. An assembly child can retain assembly identity, but grandchildren are not materialized by this adapter.
- Component DTOs currently carry cost snapshots and IDs; descriptive fields are enriched from other item DTOs returned in the same snapshot.
- BOQ Flat now consumes the separate canonical `BoqCatalogAdapter`; Estimating does not reuse that adapter for Add Item.
