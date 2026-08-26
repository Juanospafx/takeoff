# CatalogService

`assets/catalog_service.js` is the shared frontend read boundary for the Cost Catalog.

## Responsibilities

- Build requests to `api/cost_catalog.php`.
- Convert network, malformed-response, and API failures into `CatalogServiceError`.
- Normalize every item through `CatalogItemContract.normalizeCatalogItem()`.
- Return only `CatalogItemDTO` objects from item APIs.
- Normalize catalog and category summaries so new consumers do not depend on SQL-shaped names.
- Apply safe DTO-level `type` and text-query filters.

It does not write catalog data, expand assemblies, alter ratios, or persist Takeoff metadata.

## Public API

- `getSnapshot(options)` returns `{catalogs, categories, items}` from one request.
- `listCatalogs(options)` returns normalized catalog summaries.
- `listCategories(options)` returns normalized category summaries.
- `listItems(options)` returns `CatalogItemDTO[]`.
- `getItem(id, options)` returns one `CatalogItemDTO` or `ITEM_NOT_FOUND`.
- `searchItems(query, options)` returns matching DTOs.
- `getAssembly(id, options)` returns an ASSEMBLY DTO with `assemblyComponents` or `NOT_AN_ASSEMBLY`.

Supported options are `catalogId`, `categoryId`, `type`, `query`, `endpoint`, and a test-only/integration `fetchImpl` override.

## Errors

Failures throw `CatalogServiceError` with:

- `code`
- `message`
- `status`
- `cause`

Known codes include `NETWORK_ERROR`, `INVALID_RESPONSE`, `API_ERROR`, `ITEM_NOT_FOUND`, `NOT_AN_ASSEMBLY`, `FETCH_UNAVAILABLE`, and `UNSUPPORTED_AVAILABILITY_FILTER`.

## Availability limitation

`activeOnly` and `enabledForProjectsOnly` intentionally fail with `UNSUPPORTED_AVAILABILITY_FILTER`. The current API does not consistently enforce inherited item + category + catalog availability, so the service does not advertise a false frontend guarantee.

## Caching

No cache is used in this phase. Calls read the API directly, avoiding stale results after catalog administration writes. A future cache must have mutation-driven invalidation and cannot use localStorage as authority.

## Consumer inventory

| Consumer | Current source | Status |
|---|---|---|
| Takeoff Browse Catalog | `CatalogService.getSnapshot()` | Migrated |
| Cost Catalog admin UI | Direct read/write calls in `assets/cost_catalog.js` | Pending; writes require a separate command API design |
| Estimating Add Item | `CatalogService.getSnapshot()` + `EstimatingCatalogAdapter` | Migrated |
| BOQ Flat hydration | Direct list fetch in `assets/project_estimating.js`, raw payload consumed by `estimating_export_service.js` | Pending |
| BOQ normal | Estimate workspace; no direct catalog fetch | No migration required presently |
| Editor bootstrap | Catalog/assembly payload from `api/takeoff.php` | Pending; separate backend boundary |
| Takeoff editor catalog management | Catalog tables exposed through `api/takeoff.php` actions | Pending and outside this read-service phase |
| Estimating persistence validation | Direct DB lookup in `api/project_estimating.php` | Backend concern, not a frontend consumer |

## Future strategy

Migrate BOQ Flat next only after its hydrator accepts canonical DTOs plus canonical components. The administration UI should be migrated later with explicit mutation methods and cache invalidation.
