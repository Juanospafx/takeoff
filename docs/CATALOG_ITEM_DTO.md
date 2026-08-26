# CatalogItemDTO canonical contract

This additive contract is the compatibility boundary between Cost Catalog,
Takeoff, and Estimating. Existing SQL columns and legacy frontend properties
remain unchanged during this phase.

```text
CatalogItemDTO {
  id: string|null
  revision: number|string|null
  type: PART|ASSEMBLY|EQUIPMENT|LABOR|SUBCONTRACTOR|TRAVEL|CUSTOM|OTHER
  costCategory: material|labor|equipment|subcontractor|other|assembly
  name: string
  description: string
  uom: string
  catalog: { id: string|null, name: string }
  category: { id: string|null, name: string }
  classification: {
    masterformat: string, uniformat: string, costCode: string,
    subJobCode: string, subJobName: string
  }
  pricing: {
    materialUnitCost: number, equipmentUnitCost: number,
    subcontractorUnitCost: number, laborHoursPerUnit: number,
    laborRate: number, legacyUnitCost: number
  }
  waste: number
  markup: number
  taxable: boolean
  supplier: { manufacturer: string, supplier: string, catalogNumber: string }
  takeoffDefaults: { measurementType: count|linear|area|volume|null, symbol: string|null, color: string|null }
  attributes: object
  tags: array
  assemblyComponents: AssemblyComponentDTO[]
  legacy: { itemType: string, costType: string }
}

AssemblyComponentDTO {
  id: string|null
  catalogItemId: string|null
  quantity: number
  ratioType: string
  spacing: number|null
  waste: number
  pricingSnapshot: {
    materialUnitCost: number, equipmentUnitCost: number,
    subcontractorUnitCost: number, laborHoursPerUnit: number,
    laborRate: number
  }
  overrides: object
}
```

## Deliberate additions

`costCategory` was added beside the catalog `category` object. Catalog category
is organizational; cost category controls pricing. Combining them would retain
the existing ambiguity between a catalog group and Materials/Labor/Equipment.

`pricing.legacyUnitCost` and `legacy` are compatibility traces. They prevent an
unclassified legacy `unit_cost` from being silently treated as material cost.
They can be retired only after all consumers use explicit pricing buckets.

## Normalization rules

- `part` and legacy `material` both normalize to `PART`.
- Unknown item types normalize to `OTHER`, never to `PART` or Materials.
- Cost category is read explicitly when present; otherwise it is derived only
  from the normalized item type, never from UoM, item name, or description.
- A generic `unit_cost` on `PART` maps to `materialUnitCost`.
- A generic `unit_cost` on `EQUIPMENT` maps to `equipmentUnitCost`, with
  `materialUnitCost` remaining zero.
- `LABOR` uses explicit `labor_rate`; generic `unit_cost` is preserved only in
  `legacyUnitCost` because its meaning is not safe to guess.
- Current `assembly_parts` rows can be supplied through
  `normalizeCatalogItem(raw, { assemblyParts })`. Missing future component
  fields receive explicit defaults.
