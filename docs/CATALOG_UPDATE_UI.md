# Update from Cost Catalog UI

## Entry point

Estimating exposes one `Update from Cost Catalog` action in its primary toolbar. The control calls `projectEstimatingPrepareCatalogUpdate`; the UI never fetches Cost Catalog data or mutates Estimate objects directly.

## States

1. **Checking** — opens immediate progress feedback and disables repeat activation.
2. **Up to date** — compact confirmation when no refreshable changes exist.
3. **Preview** — totals, strategy, selectable item changes and warnings.
4. **Refreshing selection** — calls prepare again with `selectedCatalogItemIds`; totals remain domain-produced.
5. **Applying** — disables modal controls and calls `projectEstimatingApplyCatalogUpdate`.
6. **Success** — distinguishes an in-place update from a newly created revision.
7. **Stale/error** — human-readable recovery with `Refresh Preview` or `Try Again`.

## Preview and selection

The modal shows current/projected totals, amount and percentage difference from the preview response. Summary counters with zero values are omitted except the total checked count. Each refreshable row has a native checkbox; Select all affects only refreshable rows. Missing, legacy and error rows remain visible but disabled.

PART, Equipment and Labor retain distinct labels. Labor hours and rate appear separately. Assembly component changes use an expandable native `details` disclosure and never expose raw JSON. Preserved overrides show catalog, project override and effective values with zero-impact updates described as intentional.

## Strategy

The UI reads `prepared.strategy` returned by the domain-backed prepare API:

- `UPDATE_IN_PLACE`: explanation and `Update Estimate` CTA.
- `CREATE_REVISION`: current/new revision explanation and `Create Updated Revision` CTA.

It does not infer editability from Estimate status.

## Errors and success

`ESTIMATE_CHANGED_SINCE_PREVIEW`, `CATALOG_CHANGED_SINCE_PREVIEW` and `PREVIEW_OPTIONS_CHANGED` are mapped to human language and require a refreshed preview. Internal codes are limited to console/debug output. Successful persistence is already responsible for selecting a newly created revision and rerendering Estimating totals.

## Accessibility and responsive behavior

The modal uses `role=dialog`, `aria-modal`, labelled title/description, polite live status, native checkboxes, visible focus states, Escape dismissal and a contained Tab cycle. Apply cannot be dismissed while saving. Focus returns to the trigger on close.

At narrow widths totals stack vertically, item headers and field comparisons reflow, action buttons remain operable and the modal stays within `100dvh`. Reduced-motion preferences slow the only necessary progress indicator and remove the strongest opacity transition.
