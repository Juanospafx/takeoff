# Assembly Expansion Service

## Legacy implementations audited before implementation

| Consumer | Existing formula/behavior | Ambiguity or difference |
| --- | --- | --- |
| Takeoff editor | `fixed = component.quantity`; `per_endpoint = component.quantity * 2`; `spacing_based = ceil(base / max(spacing, 1)) * component.quantity`; every other ratio is `base * component.quantity` | `base` is the layer quantity, so linear and area are implicit. Endpoint count is hard-coded to two. No unit conversion. |
| Takeoff editor pricing | Applies component waste before `calculateItemCost`; that function then applies the catalog item's waste | Two separately stored allowances compound as `(1 + component waste) * (1 + item waste)`. The shared expansion service owns only component waste. |
| Estimating calculation | `child.quantity * assembly.quantity`, unless `childrenQuantitiesExtended` says the child is already extended | Ignores component ratio, spacing, and component-level waste. Embedded children recurse through `calculateItem`; flat children are resolved only within their group. |
| BOQ Flat | Same per-unit multiplication and `childrenQuantitiesExtended` behavior; recursively flattens embedded children and silently stops cycles by row ID | Ignores component ratio, spacing, and waste. Consolidates leaf rows by catalog item ID plus UOM. |
| Cost Catalog API roll-up | `SUM(component.quantity * unit_cost_snapshot)` and the same for labor | Ignores measured quantity, ratio, spacing, waste, nesting, and current child pricing. |
| Takeoff API legacy assemblies | Returns `assemblies/assembly_items` when present, otherwise maps `catalog_items/assembly_parts` into that shape | Allows different persisted assembly models. The current frontend calculation is one level and treats an assembly child like an aggregate catalog item. |

Existing tests prove per-unit extension, already-extended child protection, basic nested BOQ expansion, zero-quantity safety, and aggregate assembly pricing. Before this service there were no direct tests for linear, area, endpoint, spacing boundaries, component waste, or structured cycle errors.

## Canonical API

```js
AssemblyExpansionService.expandAssembly(assemblyDto, measuredQuantity, context)
AssemblyExpansionService.consolidateComponents(components, options)
```

The service is pure: it performs no fetch, DOM access, persistence, global-state lookup, or rounding.

`context` may contain `measurementType`, `measurementUom`, `linearLength`, `area`, `volume`, `endpointCount`, `catalogIndex`, `precision`, and `pricingSource`. `catalogIndex` accepts a `Map`, DTO array, or object keyed by catalog ID.

## Output

Each expanded component carries `componentQuantity`, `baseQuantity` (the driver for the ratio), `effectiveQuantity`, `wasteQuantity`, and `pricedQuantity`. It also retains the source DTO, selected pricing view, pricing snapshot, overrides, depth, and an ID-based path. Assembly component nodes and leaf component nodes remain detailed; consolidation is separate.

## Ratio semantics

- `FIXED`: base driver `1`; effective quantity is `component.quantity`.
- `PER_UNIT`: base driver is `measuredQuantity`; effective is driver × component quantity.
- `PER_LINEAR`: base driver is explicit `context.linearLength`; no unit conversion.
- `PER_AREA`: base driver is explicit `context.area`; no unit conversion.
- `PER_ENDPOINT`: base driver is explicit `context.endpointCount`. Passing `2` reproduces the Takeoff legacy behavior; the hard-coded assumption is not embedded in the shared service.
- `SPACING`: base driver is explicit `context.linearLength`; count is `ceil(linearLength / max(spacing, 1))`; effective is count × component quantity. There is no extra endpoint. Zero length returns zero; exact divisibility does not add one.

Legacy aliases normalize at the boundary. Missing required ratio inputs produce structured `MISSING_RATIO_INPUT` errors rather than silently substituting unrelated measurements.

## Waste and pricing

Component waste is applied exactly once:

```text
wasteQuantity = effectiveQuantity × component.waste / 100
pricedQuantity = effectiveQuantity + wasteQuantity
```

Catalog-item waste is not applied by this engine. A pricing consumer may model it separately, preventing accidental double application. `pricingSource` accepts `CURRENT_CATALOG` or `SNAPSHOT`; both source objects remain available in the result. Overrides are preserved but not interpreted.

## Nesting, cycles, and missing children

Assembly children recurse through stable catalog IDs and retain `depth` and `path`. Direct and indirect cycles stop recursion and append an `ASSEMBLY_CYCLE` error with the complete path. A missing catalog child remains as an `OTHER` component using its snapshot and produces `MISSING_CATALOG_ITEM`; it is never assumed to be Material.

## Precision and consolidation

No intermediate result is rounded. `context.precision` is reserved for consumers and does not mutate calculations. `consolidateComponents` groups leaves by catalog item ID plus UOM by default, sums all quantity stages, and retains source paths.

## Parity decision

| Fixture | Legacy consumer | Old | Shared service | Difference |
| --- | --- | --- | --- | --- |
| Assembly 10 × component 2 | Estimating/BOQ | 20 | 20 | None |
| Fixed component 2, assembly 10 | Takeoff editor | 2 | 2 | None |
| Linear 100 × 0.5 | Takeoff editor default branch | 50 | 50 | Explicit input in new service |
| Area 200 × 0.25 | Takeoff editor default branch | 50 | 50 | Explicit input in new service |
| Endpoint component 2 | Takeoff editor | 4 (assumes 2 endpoints) | 4 when endpointCount=2; 16 when endpointCount=8 | Shared service removes hard-coded endpoint count |
| Spacing 100/30 × 2 | Takeoff editor | 8 | 8 | None; same ceil/clamp rule |
| Component waste 10% | BOQ/Estimating | ignored | represented once | Intentional semantic difference |
| Component + item waste | Takeoff editor | compounded | component waste only | Item allowance remains a downstream pricing concern |
| Cycle | BOQ | silently omitted | structured error | Intentional diagnostics improvement |

Because BOQ currently ignores ratios and component waste, migrating it now would change valid reports. The pilot migration is therefore deferred until a product policy selects whether BOQ should adopt canonical ratios/waste or request a legacy compatibility mode.

## Pending consumers and debts

- BOQ Flat, Estimating, Takeoff/editor, Cost Catalog roll-up, and backend validation remain on their existing implementations.
- Unit compatibility is reported but not converted; an authoritative conversion service is still needed.
- `childrenQuantitiesExtended` remains a consumer compatibility flag and is not removed.
- Catalog revision refresh, estimate revisions, “Update from Cost Catalog”, UI work, and SQL cleanup are outside this phase.
