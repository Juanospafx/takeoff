import os

new_css = """/* Cost Catalog update review & Header hiding */
body.has-est-cu-open,
html.has-est-cu-open {
    overflow: hidden !important;
}

body.has-est-cu-open .bt-global-header,
body.has-est-cu-open .project-subhead-wrapper,
body.has-est-cu-open .project-header,
body.has-est-cu-open #projectHeader,
body.has-est-cu-open .bt-header-slide-toggle,
body.has-est-cu-open .takeoff-floating-subhead,
body:has([data-catalog-update-portal]) .bt-global-header,
body:has([data-catalog-update-portal]) .project-subhead-wrapper,
body:has([data-catalog-update-portal]) .project-header,
body:has([data-catalog-update-portal]) #projectHeader,
body:has([data-catalog-update-portal]) .bt-header-slide-toggle,
body:has([data-catalog-update-portal]) .takeoff-floating-subhead {
    opacity: 0 !important;
    visibility: hidden !important;
    pointer-events: none !important;
    transform: translateY(-24px) !important;
    transition: opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1), visibility 0.2s, transform 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
}

body.has-est-cu-open .est-cu-dialog > header,
body:has([data-catalog-update-portal]) .est-cu-dialog > header {
    opacity: 1 !important;
    visibility: visible !important;
    pointer-events: auto !important;
    transform: none !important;
}

.est-catalog-update-trigger {
    white-space: nowrap;
}

.est-cu-backdrop {
    position: fixed !important;
    inset: 0 !important;
    top: 0 !important;
    left: 0 !important;
    width: 100vw !important;
    height: 100vh !important;
    z-index: 2147483647 !important;
    display: grid !important;
    place-items: center !important;
    padding: clamp(14px, 3vw, 32px) !important;
    background: rgba(15, 23, 42, 0.78) !important;
    backdrop-filter: blur(14px) saturate(180%) !important;
    -webkit-backdrop-filter: blur(14px) saturate(180%) !important;
    box-sizing: border-box !important;
    overflow: hidden !important;
    animation: estCuFadeIn 0.2s ease-out;
}

@keyframes estCuFadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
}

@keyframes estCuScaleUp {
    from { opacity: 0; transform: scale(0.96) translateY(10px); }
    to { opacity: 1; transform: scale(1) translateY(0); }
}

.est-cu-dialog {
    box-sizing: border-box;
    width: min(1120px, 100%);
    min-width: 0;
    max-width: 100%;
    max-height: min(880px, calc(100dvh - 36px));
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    overflow: hidden;
    color: var(--est-text, #172033);
    background: var(--est-surface, #ffffff);
    border: 1px solid var(--est-line, #dbe1ea);
    border-radius: 18px;
    box-shadow: 0 25px 60px -15px rgba(15, 23, 42, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.12);
    animation: estCuScaleUp 0.22s cubic-bezier(0.16, 1, 0.3, 1);
}

.est-cu-dialog * { box-sizing: border-box; }

.est-cu-dialog .sr-only {
    position: absolute !important;
    width: 1px !important;
    height: 1px !important;
    padding: 0 !important;
    margin: -1px !important;
    overflow: hidden !important;
    clip: rect(0, 0, 0, 0) !important;
    white-space: nowrap !important;
    border: 0 !important;
}

/* Header */
.est-cu-dialog > header.est-cu-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 16px 24px;
    background: var(--est-surface);
    border-bottom: 1px solid var(--est-line);
}

.est-cu-header-left {
    display: flex;
    align-items: center;
    gap: 14px;
    min-width: 0;
}

.est-cu-header-icon {
    width: 44px;
    height: 44px;
    flex: 0 0 44px;
    border-radius: 12px;
    background: var(--est-primary-soft, #eef2fa);
    color: var(--est-primary, #2563eb);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.25rem;
    box-shadow: inset 0 0 0 1px var(--est-primary-border, rgba(37, 99, 235, 0.25));
}

.est-cu-header-text {
    min-width: 0;
    display: grid;
    gap: 3px;
}

.est-cu-header-title-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
}

.est-cu-header-title-row h2 {
    margin: 0;
    color: var(--est-text);
    font-size: 1.18rem;
    font-weight: 750;
    line-height: 1.3;
}

.est-cu-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 9px;
    border-radius: 999px;
    font-size: 0.73rem;
    font-weight: 750;
    letter-spacing: 0.02em;
    white-space: nowrap;
}

.est-cu-badge-primary {
    background: var(--est-primary-soft, #eef2fa);
    color: var(--est-primary, #2563eb);
    border: 1px solid var(--est-primary-border, rgba(37, 99, 235, 0.3));
}

.est-cu-badge-revision {
    background: var(--est-warning-soft, #fff7ed);
    color: var(--est-warning, #b45309);
    border: 1px solid var(--est-warning-border, #fbdba3);
}

.est-cu-header-text p {
    margin: 0;
    color: var(--est-muted);
    font-size: 0.83rem;
    line-height: 1.4;
}

.est-cu-close {
    width: 38px;
    height: 38px;
    flex: 0 0 38px;
    display: grid;
    place-items: center;
    border: 1px solid var(--est-line);
    border-radius: 10px;
    color: var(--est-muted);
    background: var(--est-surface-2);
    cursor: pointer;
    transition: all 0.15s ease;
}

.est-cu-close:hover {
    background: var(--est-surface-3);
    color: var(--est-text);
    border-color: var(--est-line);
    transform: scale(1.04);
}

.est-cu-close:disabled {
    opacity: 0.35;
    cursor: not-allowed;
    transform: none;
}

/* Main Body */
.est-cu-dialog > main {
    min-height: 0;
    overflow-y: auto;
    background: var(--est-surface-2, #f8fafc);
    scroll-padding: 20px;
}

.est-cu-body {
    position: relative;
    display: grid;
    gap: 18px;
    padding: 20px 24px;
}

/* Stats Badges */
.est-cu-stats {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}

.est-cu-stat {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    border: 1px solid var(--est-line);
    border-radius: 999px;
    background: var(--est-surface);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.03);
    transition: background 0.15s;
}

.est-cu-stat > i {
    font-size: 0.8rem;
    color: var(--est-muted);
}

.est-cu-stat-info {
    display: inline-flex;
    align-items: baseline;
    gap: 5px;
}

.est-cu-stat-info strong {
    color: var(--est-text);
    font-size: 0.86rem;
    font-weight: 750;
}

.est-cu-stat-info span {
    color: var(--est-muted);
    font-size: 0.74rem;
    font-weight: 650;
}

.est-cu-stat.highlight {
    background: var(--est-primary-soft);
    border-color: var(--est-primary-border);
}

.est-cu-stat.highlight > i,
.est-cu-stat.highlight strong {
    color: var(--est-primary);
}

.est-cu-stat.warning {
    background: var(--est-warning-soft);
    border-color: var(--est-warning-border);
}

.est-cu-stat.warning > i,
.est-cu-stat.warning strong {
    color: var(--est-warning);
}

/* KPI Totals Comparison */
.est-cu-totals {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
}

.est-cu-total-card {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 14px 18px;
    border: 1px solid var(--est-line);
    border-radius: 12px;
    background: var(--est-surface);
    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.02);
}

.est-cu-total-label {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--est-muted);
    font-size: 0.76rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.03em;
}

.est-cu-total-label i {
    font-size: 0.82rem;
}

.est-cu-total-value {
    color: var(--est-text);
    font-size: clamp(1.2rem, 2.2vw, 1.48rem);
    font-weight: 800;
    letter-spacing: -0.01em;
    line-height: 1.25;
}

.est-cu-total-sub {
    color: var(--est-muted);
    font-size: 0.75rem;
    line-height: 1.4;
}

.est-cu-total-diff {
    border-color: var(--est-line);
}

.est-cu-total-diff.increase {
    background: linear-gradient(135deg, var(--est-surface) 60%, rgba(245, 158, 11, 0.08));
    border-color: var(--est-warning-border);
}

.est-cu-total-diff.increase .est-cu-total-value {
    color: var(--est-warning);
}

.est-cu-total-diff.decrease {
    background: linear-gradient(135deg, var(--est-surface) 60%, rgba(34, 197, 94, 0.08));
    border-color: var(--est-success-border);
}

.est-cu-total-diff.decrease .est-cu-total-value {
    color: var(--est-success);
}

.est-cu-total-diff-pill {
    display: inline-flex;
    align-items: center;
    align-self: flex-start;
    gap: 5px;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 0.72rem;
    font-weight: 750;
    margin-top: 2px;
}

.est-cu-total-diff.increase .est-cu-total-diff-pill {
    background: var(--est-warning-soft);
    color: var(--est-warning);
    border: 1px solid var(--est-warning-border);
}

.est-cu-total-diff.decrease .est-cu-total-diff-pill {
    background: var(--est-success-soft);
    color: var(--est-success);
    border: 1px solid var(--est-success-border);
}

.est-cu-total-diff.neutral .est-cu-total-diff-pill {
    background: var(--est-surface-3);
    color: var(--est-muted);
}

/* Strategy Banner */
.est-cu-strategy {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 12px 16px;
    border: 1px solid var(--est-primary-border);
    border-radius: 12px;
    background: var(--est-primary-soft);
    color: var(--est-text-soft);
}

.est-cu-strategy.revision {
    border-color: var(--est-warning-border);
    background: var(--est-warning-soft);
}

.est-cu-strategy-icon {
    font-size: 1.15rem;
    margin-top: 2px;
    color: var(--est-primary);
}

.est-cu-strategy.revision .est-cu-strategy-icon {
    color: var(--est-warning);
}

.est-cu-strategy-content {
    display: grid;
    gap: 3px;
}

.est-cu-strategy-content strong {
    color: var(--est-text);
    font-size: 0.86rem;
    font-weight: 750;
}

.est-cu-strategy-content span {
    color: var(--est-muted);
    font-size: 0.78rem;
    line-height: 1.45;
}

/* Toolbar: Search and Filter Chips */
.est-cu-toolbar {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 12px 16px;
    border: 1px solid var(--est-line);
    border-radius: 12px;
    background: var(--est-surface);
}

.est-cu-search-box {
    position: relative;
    display: flex;
    align-items: center;
    width: 100%;
}

.est-cu-search-icon {
    position: absolute;
    left: 14px;
    color: var(--est-muted);
    font-size: 0.88rem;
    pointer-events: none;
}

.est-cu-search-input {
    width: 100%;
    height: 38px;
    padding: 0 38px 0 38px;
    background: var(--est-surface-2);
    border: 1px solid var(--est-line);
    border-radius: 10px;
    color: var(--est-text);
    font-size: 0.84rem;
    transition: all 0.15s ease;
}

.est-cu-search-input:focus {
    outline: none;
    border-color: var(--est-primary);
    background: var(--est-surface);
    box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
}

.est-cu-search-clear {
    position: absolute;
    right: 10px;
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border: 0;
    background: transparent;
    color: var(--est-muted);
    cursor: pointer;
    border-radius: 50%;
}

.est-cu-search-clear:hover {
    color: var(--est-text);
}

.est-cu-filter-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}

.est-cu-filter-chip {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 5px 12px;
    border: 1px solid var(--est-line);
    border-radius: 999px;
    background: var(--est-surface-2);
    color: var(--est-muted);
    font-size: 0.77rem;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.15s ease;
}

.est-cu-filter-chip:hover {
    background: var(--est-surface-3);
    color: var(--est-text);
    border-color: var(--est-line);
}

.est-cu-filter-chip.is-active {
    background: var(--est-primary);
    color: #ffffff;
    border-color: var(--est-primary-strong, #1d4ed8);
    box-shadow: 0 2px 6px rgba(37, 99, 235, 0.25);
}

.est-cu-chip-count {
    padding: 1px 6px;
    border-radius: 999px;
    font-size: 0.7rem;
    font-weight: 800;
    background: rgba(0, 0, 0, 0.08);
    color: inherit;
}

.est-cu-filter-chip.is-active .est-cu-chip-count {
    background: rgba(255, 255, 255, 0.25);
    color: #ffffff;
}

/* List Head */
.est-cu-list-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    padding: 0 4px;
}

.est-cu-list-head-info {
    display: flex;
    align-items: baseline;
    gap: 10px;
}

.est-cu-list-head-info strong {
    color: var(--est-text);
    font-size: 0.94rem;
    font-weight: 750;
}

.est-cu-list-count {
    color: var(--est-muted);
    font-size: 0.78rem;
}

.est-cu-list-head-actions {
    display: flex;
    align-items: center;
    gap: 14px;
}

.est-cu-link-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: transparent;
    border: 0;
    padding: 4px 8px;
    border-radius: 6px;
    color: var(--est-primary);
    font-size: 0.78rem;
    font-weight: 750;
    cursor: pointer;
    transition: background 0.15s;
}

.est-cu-link-btn:hover {
    background: var(--est-primary-soft);
}

.est-cu-select-all-label {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    color: var(--est-text-soft);
    font-size: 0.8rem;
    font-weight: 750;
    cursor: pointer;
}

.est-cu-select-all-label input,
.est-cu-check input {
    width: 17px;
    height: 17px;
    border-radius: 4px;
    accent-color: var(--est-primary);
    cursor: pointer;
}

/* Item List */
.est-cu-list {
    display: grid;
    gap: 10px;
}

.est-cu-item {
    display: grid;
    grid-template-columns: 42px minmax(0, 1fr);
    border: 1px solid var(--est-line);
    border-radius: 14px;
    background: var(--est-surface);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.03);
    transition: border-color 0.15s, box-shadow 0.15s, transform 0.12s;
}

.est-cu-item:hover {
    border-color: rgba(37, 99, 235, 0.35);
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.05);
}

.est-cu-item.is-selected {
    border-color: rgba(37, 99, 235, 0.5);
    background: var(--est-surface);
}

.est-cu-item.disabled {
    background: var(--est-surface-2);
    opacity: 0.75;
}

.est-cu-check {
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding-top: 18px;
    cursor: pointer;
}

.est-cu-check:has(input:disabled) {
    cursor: not-allowed;
}

.est-cu-item-main {
    min-width: 0;
    display: grid;
    gap: 12px;
    padding: 14px 18px 14px 4px;
}

.est-cu-item-title {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 14px;
}

.est-cu-item-ident {
    min-width: 0;
    display: grid;
    gap: 4px;
}

.est-cu-item-name {
    color: var(--est-text);
    font-size: 0.92rem;
    font-weight: 750;
    overflow-wrap: anywhere;
    line-height: 1.35;
}

.est-cu-item-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
}

.est-cu-pill-type {
    display: inline-block;
    padding: 1px 7px;
    border-radius: 4px;
    font-size: 0.68rem;
    font-weight: 800;
    letter-spacing: 0.04em;
    background: var(--est-surface-3);
    color: var(--est-text-soft);
}

.est-cu-pill-type.type-assembly {
    background: rgba(99, 102, 241, 0.12);
    color: #4f46e5;
}

.est-cu-pill-type.type-part,
.est-cu-pill-type.type-material {
    background: rgba(37, 99, 235, 0.1);
    color: #2563eb;
}

.est-cu-pill-type.type-labor {
    background: rgba(245, 158, 11, 0.12);
    color: #d97706;
}

.est-cu-meta-cat,
.est-cu-meta-rev {
    color: var(--est-muted);
    font-size: 0.74rem;
    display: inline-flex;
    align-items: center;
    gap: 5px;
}

.est-cu-meta-cat i,
.est-cu-meta-rev i {
    font-size: 0.7rem;
}

.est-cu-impact-wrap {
    flex: 0 0 auto;
}

.est-cu-impact {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 10px;
    border-radius: 999px;
    font-size: 0.75rem;
    font-weight: 800;
    white-space: nowrap;
}

.est-cu-impact.increase {
    background: var(--est-warning-soft);
    color: var(--est-warning);
    border: 1px solid var(--est-warning-border);
}

.est-cu-impact.decrease {
    background: var(--est-success-soft);
    color: var(--est-success);
    border: 1px solid var(--est-success-border);
}

.est-cu-impact.neutral {
    background: var(--est-surface-3);
    color: var(--est-muted);
}

/* Fields & Diffs */
.est-cu-field {
    display: grid;
    grid-template-columns: minmax(140px, 0.35fr) minmax(0, 1fr);
    align-items: center;
    gap: 12px;
    padding-top: 8px;
    border-top: 1px solid var(--est-line-soft);
}

.est-cu-field-name {
    color: var(--est-muted);
    font-size: 0.76rem;
    font-weight: 700;
}

.est-cu-field-diff {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.8rem;
}

.est-cu-diff-old {
    color: var(--est-muted);
    text-decoration: line-through;
}

.est-cu-diff-new {
    color: var(--est-text);
    font-weight: 750;
}

.est-cu-field-diff i {
    color: var(--est-muted);
    font-size: 0.74rem;
}

/* Assembly Recipe */
.est-cu-assembly {
    padding-top: 8px;
    border-top: 1px solid var(--est-line-soft);
}

.est-cu-assembly summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 6px 8px;
    border-radius: 8px;
    background: var(--est-surface-2);
    color: var(--est-text-soft);
    font-size: 0.8rem;
    font-weight: 750;
    cursor: pointer;
    user-select: none;
    transition: background 0.15s;
}

.est-cu-assembly summary:hover {
    background: var(--est-surface-3);
}

.est-cu-asm-summary-left {
    display: inline-flex;
    align-items: center;
    gap: 7px;
}

.est-cu-asm-summary-left i {
    color: #4f46e5;
}

.est-cu-asm-badge {
    padding: 2px 7px;
    border-radius: 999px;
    background: var(--est-surface);
    border: 1px solid var(--est-line);
    font-size: 0.7rem;
    font-weight: 750;
    color: var(--est-muted);
}

.est-cu-asm-details {
    display: grid;
    gap: 6px;
    padding: 8px 0 0 16px;
}

.est-cu-comp-item {
    font-size: 0.76rem;
    color: var(--est-text-soft);
    display: flex;
    align-items: center;
    gap: 7px;
}

.est-cu-comp-item.added i {
    color: var(--est-success);
}

.est-cu-comp-item.removed i {
    color: var(--est-danger);
}

.est-cu-comp-item.modified i {
    color: var(--est-primary);
}

.est-cu-comp-item s {
    color: var(--est-muted);
}

/* Preserved Project Overrides */
.est-cu-override {
    display: grid;
    gap: 6px;
    padding: 10px 14px;
    border: 1px solid rgba(99, 102, 241, 0.3);
    border-radius: 10px;
    background: rgba(99, 102, 241, 0.08);
}

.est-cu-override-head {
    display: flex;
    align-items: center;
    gap: 7px;
    color: #4f46e5;
    font-size: 0.82rem;
}

.est-cu-override-head i {
    font-size: 0.88rem;
}

.est-cu-override-desc {
    margin: 0;
    color: var(--est-muted);
    font-size: 0.74rem;
    line-height: 1.4;
}

.est-cu-override-list {
    display: grid;
    gap: 4px;
    margin-top: 2px;
}

.est-cu-override-row {
    font-size: 0.75rem;
    color: var(--est-text-soft);
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding-left: 6px;
    border-left: 2px solid #6366f1;
}

.est-cu-override-row s {
    color: var(--est-muted);
}

.est-cu-override-row b {
    color: #4f46e5;
}

/* Warnings */
.est-cu-inline-warning {
    display: flex;
    gap: 10px;
    padding: 10px 14px;
    border: 1px solid var(--est-warning-border);
    border-radius: 10px;
    background: var(--est-warning-soft);
}

.est-cu-inline-warning > i {
    margin-top: 2px;
    color: var(--est-warning);
    font-size: 0.9rem;
}

.est-cu-inline-warning > div {
    display: grid;
    gap: 2px;
}

.est-cu-inline-warning strong {
    color: var(--est-text);
    font-size: 0.82rem;
}

.est-cu-inline-warning span {
    color: var(--est-muted);
    font-size: 0.76rem;
}

.est-cu-row-warnings {
    display: grid;
    gap: 4px;
    color: var(--est-warning);
    font-size: 0.75rem;
}

.est-cu-warnings {
    padding: 14px 18px;
    border: 1px solid var(--est-warning-border);
    border-radius: 12px;
    background: var(--est-warning-soft);
}

.est-cu-warnings > strong {
    color: var(--est-text);
    font-size: 0.84rem;
    display: inline-flex;
    align-items: center;
    gap: 6px;
}

.est-cu-warnings > strong i {
    color: var(--est-warning);
}

.est-cu-warnings p {
    margin: 6px 0 0;
    color: var(--est-muted);
    font-size: 0.78rem;
    line-height: 1.45;
}

/* Empty Search & States */
.est-cu-empty-search {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 36px 20px;
    text-align: center;
}

.est-cu-empty-search > i {
    font-size: 1.8rem;
    color: var(--est-muted);
    margin-bottom: 4px;
}

.est-cu-empty-search h4 {
    margin: 0;
    color: var(--est-text);
    font-size: 0.95rem;
}

.est-cu-empty-search p {
    margin: 0;
    color: var(--est-muted);
    font-size: 0.8rem;
}

.est-cu-empty-list {
    padding: 32px 20px;
    text-align: center;
    color: var(--est-muted);
}

/* Compact States */
.est-cu-compact {
    min-height: 320px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 48px 24px;
    text-align: center;
}

.est-cu-compact-icon {
    width: 60px;
    height: 60px;
    border-radius: 50%;
    background: var(--est-primary-soft);
    color: var(--est-primary);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.8rem;
    margin-bottom: 6px;
}

.est-cu-compact h3 {
    max-width: 580px;
    margin: 0;
    color: var(--est-text);
    font-size: 1.15rem;
    font-weight: 750;
    line-height: 1.4;
}

.est-cu-compact p {
    max-width: 540px;
    margin: 0;
    color: var(--est-muted);
    font-size: 0.85rem;
    line-height: 1.55;
}

/* Refreshing Sticky Pill */
.est-cu-refreshing {
    position: sticky;
    bottom: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 10px 18px;
    border: 1px solid var(--est-primary-border);
    border-radius: 999px;
    color: var(--est-primary);
    background: var(--est-surface);
    box-shadow: 0 4px 16px rgba(15, 23, 42, 0.15);
    font-size: 0.8rem;
    font-weight: 750;
    margin: 0 auto;
    width: fit-content;
}

.est-cu-body.is-refreshing .est-cu-list {
    opacity: 0.6;
    pointer-events: none;
}

.est-cu-spinner {
    width: 15px;
    height: 15px;
    display: inline-block;
    flex: 0 0 15px;
    border: 2px solid currentColor;
    border-right-color: transparent;
    border-radius: 50%;
    animation: est-cu-spin 0.75s linear infinite;
}

@keyframes est-cu-spin { to { transform: rotate(360deg); } }

/* Footer */
.est-cu-dialog > footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 16px 24px;
    border-top: 1px solid var(--est-line);
    background: var(--est-surface);
}

.est-cu-footer-summary {
    display: flex;
    align-items: center;
    gap: 7px;
    color: var(--est-muted);
    font-size: 0.82rem;
}

.est-cu-footer-summary i {
    color: var(--est-primary);
}

.est-cu-footer-summary b {
    color: var(--est-text);
}

.est-cu-footer-actions {
    display: flex;
    align-items: center;
    gap: 10px;
}

.est-cu-dialog .est-btn {
    min-height: 40px;
    padding: 0 18px;
    border-radius: 10px;
    font-weight: 700;
}

/* Dark Theme Overrides */
[data-theme="dark"] .est-cu-dialog,
body.theme-dark .est-cu-dialog {
    background: #0f172a;
    border-color: #334155;
    color: #f8fafc;
    box-shadow: 0 25px 60px -15px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.08);
}

[data-theme="dark"] .est-cu-dialog > header.est-cu-header,
body.theme-dark .est-cu-dialog > header.est-cu-header,
[data-theme="dark"] .est-cu-dialog > footer,
body.theme-dark .est-cu-dialog > footer {
    background: #0f172a;
    border-color: #1e293b;
}

[data-theme="dark"] .est-cu-dialog > main,
body.theme-dark .est-cu-dialog > main {
    background: #090e1a;
}

[data-theme="dark"] .est-cu-total-card,
body.theme-dark .est-cu-total-card,
[data-theme="dark"] .est-cu-item,
body.theme-dark .est-cu-item,
[data-theme="dark"] .est-cu-toolbar,
body.theme-dark .est-cu-toolbar,
[data-theme="dark"] .est-cu-stat,
body.theme-dark .est-cu-stat {
    background: #0f172a;
    border-color: #1e293b;
}

[data-theme="dark"] .est-cu-search-input,
body.theme-dark .est-cu-search-input,
[data-theme="dark"] .est-cu-filter-chip,
body.theme-dark .est-cu-filter-chip,
[data-theme="dark"] .est-cu-close,
body.theme-dark .est-cu-close {
    background: #172236;
    border-color: #334155;
    color: #cbd5e1;
}

[data-theme="dark"] .est-cu-filter-chip.is-active,
body.theme-dark .est-cu-filter-chip.is-active {
    background: #2563eb;
    color: #ffffff;
    border-color: #3b82f6;
}

[data-theme="dark"] .est-cu-item.is-selected,
body.theme-dark .est-cu-item.is-selected {
    border-color: rgba(59, 130, 246, 0.6);
}

[data-theme="dark"] .est-cu-override,
body.theme-dark .est-cu-override {
    background: rgba(99, 102, 241, 0.15);
    border-color: rgba(99, 102, 241, 0.4);
}

[data-theme="dark"] .est-cu-override-head,
body.theme-dark .est-cu-override-head,
[data-theme="dark"] .est-cu-override-row b,
body.theme-dark .est-cu-override-row b {
    color: #a5b4fc;
}

/* Responsive adjustments */
@media (max-width: 820px) {
    .est-cu-backdrop { padding: 10px !important; }
    .est-cu-dialog { max-height: calc(100dvh - 20px); border-radius: 14px; }
    .est-cu-dialog > header.est-cu-header,
    .est-cu-dialog > footer { padding: 12px 16px; }
    .est-cu-body { padding: 14px 16px; gap: 14px; }
    .est-cu-totals { grid-template-columns: 1fr; }
    .est-cu-list-head { flex-direction: column; align-items: flex-start; gap: 8px; }
    .est-cu-list-head-actions { width: 100%; justify-content: space-between; }
    .est-cu-item-title { flex-direction: column; gap: 8px; }
    .est-cu-impact-wrap { align-self: flex-start; }
    .est-cu-field { grid-template-columns: 1fr; gap: 4px; }
    .est-cu-footer-actions { width: 100%; justify-content: flex-end; }
    .est-cu-footer-summary { display: none; }
}

@media (max-width: 520px) {
    .est-catalog-update-trigger span { display: none; }
    .est-cu-stats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .est-cu-stat { min-width: 0; }
    .est-cu-footer-actions .est-btn { flex: 1; }
}

@media (prefers-reduced-motion: reduce) {
    .est-cu-spinner { animation-duration: 1.5s; }
    .est-cu-body.is-refreshing .est-cu-list { opacity: .8; }
    .est-cu-dialog, .est-cu-backdrop { animation: none !important; }
}"""

with open('assets/project_estimating.css', 'r', encoding='utf-8') as f:
    content = f.read()

start_marker = '/* Cost Catalog update review */'
end_marker = '''@media (prefers-reduced-motion: reduce) {
    .est-cu-spinner { animation-duration: 1.5s; }
    .est-cu-body.is-refreshing .est-cu-list { opacity: .8; }
}'''

start_idx = content.find(start_marker)
if start_idx == -1:
    print('Error: start_marker not found')
    exit(1)

end_idx = content.find(end_marker, start_idx)
if end_idx == -1:
    print('Error: end_marker not found')
    exit(1)

end_idx += len(end_marker)

updated_content = content[:start_idx] + new_css + content[end_idx:]

with open('assets/project_estimating.css', 'w', encoding='utf-8') as f:
    f.write(updated_content)

print('Success: Updated assets/project_estimating.css')

