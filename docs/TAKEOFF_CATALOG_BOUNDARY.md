# Takeoff Browse Catalog boundary

Browse Catalog now accepts the Cost Catalog API payload only at one boundary:

`raw API item -> CatalogItemContract.normalizeCatalogItem -> CatalogItemDTO -> Browse Catalog -> TakeoffCatalogAdapter.catalogItemDtoToLegacyLayerMeta -> legacy layer form`

The browser, filters, search, table, and selection state contain DTOs rather than raw API rows. The legacy layer shape is intentionally unchanged.

## Transitional mappings

- PART: `pricing.materialUnitCost` becomes the layer's generic `unitCost`.
- EQUIPMENT: `pricing.equipmentUnitCost` temporarily becomes generic `unitCost`; `itemType`, `costCategory`, `equipmentUnitCost`, and the complete canonical pricing are retained in `catalogMetadata`. This is not a material classification.
- LABOR: `laborHoursPerUnit` and `laborRate` are retained. A legacy aggregate `unit_cost`, if supplied, remains only the compatibility value; Labor stays classified as Labor.
- ASSEMBLY: its current aggregate compatibility cost and labor are used by the layer while `revision` and `assemblyComponents` remain in `catalogMetadata`.
- Measurement type: `takeoffDefaults.measurementType` wins. Existing UoM inference is used only when that default is absent.
- Symbol and color come from `takeoffDefaults`, with the existing form defaults retained when absent or unsupported.

## Availability debt

The current `cost_catalog.php?action=list` item queries exclude soft-deleted items and assembly-part links. They do not explicitly exclude soft-deleted catalogs/groups or consistently require:

- `catalog_items.active = 1`
- `catalogs.active = 1`
- `catalogs.enabled_for_projects = 1`
- `catalog_groups.active = 1`
- `catalog_groups.enabled_for_projects = 1`
- `catalogs.deleted_at IS NULL`
- `catalog_groups.deleted_at IS NULL`

Browse Catalog deliberately does not add a frontend filter because availability is an API/domain policy. A future backend phase should define that policy and return availability explicitly.

## Persistence debt

The parent Takeoff layer now retains canonical catalog metadata, but the embedded editor's persisted layer schema still has a single generic unit-cost field and only copies a limited metadata whitelist. Durable canonical Equipment/Labor/Assembly metadata requires a later editor/API layer-schema migration. This phase does not change that schema.
