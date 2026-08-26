# Takeoff Catalog Item metadata persistence

## Authority and shape

`layer.catalogMetadata` is the semantic catalog snapshot used by the dashboard. The same object is stored durably as `layer.metadata_json.catalog_item`, using the existing JSON column and snapshot state.

```text
catalogItemId
catalogRevision
type
costCategory
pricing { materialUnitCost, equipmentUnitCost, subcontractorUnitCost, laborHoursPerUnit, laborRate, legacyUnitCost }
takeoffDefaults { measurementType, symbol, color }
assemblyComponents[]
catalog { id, name }
category { id, name }
```

Legacy `unitCost`, `laborHours`, `itemType`, `catalog_item_id`, and related fields remain unchanged and operational.

## Round-trip

1. `TakeoffCatalogAdapter` creates the canonical snapshot and a separate legacy translation.
2. `project_takeoff.layerCanvasPayload()` sends a defensive metadata clone to the iframe.
3. `projectTakeoffActivateLayer()` and `projectTakeoffSyncLayers()` store it opaquely in `metadata_json.catalog_item`.
4. `stripNodes`, editor snapshots, undo/redo, and `save_state` retain the JSON structure.
5. `api/takeoff.php` already stores the complete `metadata_json` in both authoritative state JSON and the relational layer mirror.
6. `projectLayerPayload()` returns a clone through the canvas snapshot/postMessage channel.
7. `syncTakeoffFromCanvasSnapshot()` restores it to the dashboard layer.
8. On a full page reload, `seedGroupsFromProjectLayers()` reads `metadata_json.catalog_item` from the database bootstrap.

`CatalogMetadata.clone`, `fromLayer`, `attach`, and `mergeMetadata` centralize cloning and transport without sharing mutable references.

## Backward compatibility

Layers without `catalogMetadata` or `metadata_json.catalog_item` continue through the legacy fields. No partial historical metadata is fabricated.

## Currently unused canonical fields

The editor treats catalog metadata as opaque. It does not recalculate pricing, expand assemblies, compare catalog revisions, or refresh catalog values. Those capabilities require later explicit product flows.
