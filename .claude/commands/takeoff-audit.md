---
description: Run a coordinated end-to-end audit of TAKEOFF without making changes until findings are reviewed.
---

# TAKEOFF end-to-end audit

Audit the complete workflow across Takeoff, Estimating, Cost Catalog, and Bid Board.

## Coordination

Use a small hierarchical team with no more than five agents:

1. Coordinator: owns scope, deduplicates findings, and produces the final report.
2. Frontend reviewer: checks layout, responsive behavior, keyboard interaction, and canvas drawing state.
3. Data-flow reviewer: traces Takeoff quantities through Estimating and Cost Catalog.
4. Backend/security reviewer: inspects PHP APIs, validation, authorization boundaries, and persistence.
5. Test reviewer: runs existing tests and identifies the highest-value missing regression tests.

## Required checks

- Linear takeoffs remain one multi-vertex entity and calculate accumulated length correctly.
- Switching tools, layers, pages, zoom, and pan does not lose an in-progress drawing.
- Estimate copies are independent, support full/structure/blank modes, and accept new groups and items.
- Cost Catalog updates propagate intentionally and never overwrite manual estimate overrides silently.
- Bid Board and project workspace agree on project status and active estimate data.
- Desktop and compact layouts do not overlap or hide primary actions.
- Local storage, API payloads, and database identifiers cannot cross-contaminate projects or estimates.

## Guardrails

- Begin read-only. Do not edit files, mutate databases, or install packages during the audit.
- Use Graphify before broad code searches.
- Preserve user changes and distinguish confirmed defects from design suggestions.
- Rank findings by severity, affected workflow, evidence, and smallest safe fix.
- Propose an implementation plan and wait for approval before applying fixes.

## Output

Return a concise report containing verified behavior, defects, risks, missing tests, and a phased remediation plan.
