# Cost Catalog administration contract

`CatalogAdminService` is the only command boundary for Cost Catalog writes. `api/catalog_admin.php` exposes the command contract; `api/cost_catalog.php` translates legacy action names to the same service so existing UI clients remain compatible.

## Request

```json
{
  "command": "item.update",
  "requestId": "client-generated-id",
  "expectedRevision": 7,
  "payload": { "id": 42, "name": "Updated item", "catalog_id": 3 }
}
```

Supported command families are catalog/category create, update, toggle, archive, restore and copy; item create, update, archive, restore, move and duplicate; and assembly component add, update and remove.

`expectedRevision` is optional for legacy compatibility. New administrative clients should always send it for updates. A stale value returns HTTP 409 `REVISION_CONFLICT` and the current database record.

## Success and errors

Success returns `{success, command, requestId, data}`. `data.entity` is the persisted record, including its new revision when the revision migration is installed.

Errors use `{success:false,error:{code,message,details,current}}`. Validation is 422, missing records 404, locked/revision conflicts 409, malformed JSON 400, and unexpected failures 500 without raw database messages.

## Invariants

- Locked catalogs reject mutations.
- A category and its parent must belong to the same catalog; direct self-parenting is rejected.
- An item's category must belong to its catalog.
- Assembly components cannot reference the assembly itself and must belong to the same catalog.
- Component changes and the parent assembly recalculation commit in one transaction. The parent revision advances exactly once per command.
- Every effective command appends revision-aware audit records when the additive migration is present.

`CatalogService` remains the read-only query API. `CatalogAdminService` in JavaScript performs commands only and does not maintain a second catalog cache.
