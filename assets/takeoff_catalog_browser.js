(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.TakeoffCatalogBrowser = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    function create(dependencies = {}) {
        const {
            getElement,
            takeoffState,
            catalogState,
            requireWrite,
            ensureTakeoffModal,
            ensureCatalogModal,
            render,
            getCatalogItemUnitCost,
            getCatalogItemLaborHours,
            fetchCatalog,
            window: browserWindow = typeof window !== 'undefined' ? window : null
        } = dependencies;

        const state = {
            activeTab: 'cost_catalog',
            selectedCatalogId: null,
            selectedGroupId: null,
            selectedItemIds: new Set(),
            singleSelect: false,
            itemQuery: '',
            catalogQuery: '',
            page: 1,
            pageSize: 40,
            expandedCatalogs: {}
        };

        function byId(id) {
            return typeof getElement === 'function' ? getElement(id) : null;
        }

        function open(options = {}) {
            if (typeof requireWrite === 'function' && !requireWrite()) return false;
            ensureTakeoffModal?.();
            ensureCatalogModal?.();
            state.singleSelect = Boolean(options?.singleSelect);
            state.onSelect = typeof options?.onSelect === 'function' ? options.onSelect : null;
            state.targetGroupId = options?.groupId || null;
            const createModal = byId('takeoffCreateLayerModal');
            if (createModal && !createModal.hidden) {
                createModal.classList.add('is-behind');
                createModal.style.visibility = 'hidden';
            }
            const preselectedIds = state.singleSelect
                ? (takeoffState?.pendingCatalogItem?.id ? [String(takeoffState.pendingCatalogItem.id)] : [])
                : (takeoffState?.pendingCatalogItems || []).map(item => String(item.id));
            state.selectedItemIds = new Set(preselectedIds);
            state.page = 1;
            state.itemQuery = '';
            state.catalogQuery = '';
            if (byId('proBrowseItemSearch')) byId('proBrowseItemSearch').value = '';
            if (byId('proBrowseCatSearch')) byId('proBrowseCatSearch').value = '';
            const modal = byId('takeoffCatalogModal');
            if (modal) {
                modal.classList.toggle('is-single-select', state.singleSelect);
                modal.hidden = false;
                modal.style.display = 'flex';
            }
            void load();
            setTimeout(() => byId('proBrowseItemSearch')?.focus(), 50);
            return true;
        }

        function close() {
            state.singleSelect = false;
            const modal = byId('takeoffCatalogModal');
            if (modal) {
                modal.classList.remove('is-single-select');
                modal.hidden = true;
                modal.style.display = 'none';
            }
            const createModal = byId('takeoffCreateLayerModal');
            if (createModal && !createModal.hidden) {
                createModal.classList.remove('is-behind');
                createModal.style.visibility = '';
                setTimeout(() => byId('createLayerCatalogName')?.focus(), 50);
            }
        }

        function normalizeSnapshotItem(item) {
            const cost = getCatalogItemUnitCost(item);
            const labor = getCatalogItemLaborHours(item);
            const uom = item.unit_of_measure || item.uom || 'ea';
            const measurementType = item.measurement_type || item.measurementType || '';
            return {
                ...item,
                unit_of_measure: uom,
                uom,
                measurement_type: measurementType,
                measurementType,
                item_type: item.item_type || item.type || 'material',
                unitCost: cost,
                unit_cost: cost,
                laborHours: labor,
                labor_hours: labor,
                pricing: {
                    ...(item.pricing || {}),
                    unitCost: cost,
                    laborHoursPerUnit: labor,
                    materialUnitCost: item.pricing?.materialUnitCost ?? cost
                }
            };
        }

        function normalizeLegacyItem(item) {
            const cost = Number(item.unit_cost ?? item.unitCost ?? item.cost ?? item.price ?? 0);
            const labor = Number(item.labor_hours ?? item.laborHours ?? 0);
            const uom = item.unit_of_measure || item.uom || 'ea';
            const measurementType = item.measurement_type || item.measurementType || '';
            return {
                id: item.id,
                name: item.name,
                description: item.description || '',
                type: item.item_type || item.type || 'material',
                item_type: item.item_type || item.type || 'material',
                measurement_type: measurementType,
                measurementType,
                unit_of_measure: uom,
                uom,
                color: item.color,
                symbol: item.symbol,
                unitCost: cost,
                unit_cost: cost,
                laborHours: labor,
                labor_hours: labor,
                pricing: { unitCost: cost, laborHoursPerUnit: labor, materialUnitCost: cost },
                catalog: { id: item.catalog_id, name: item.catalog_name || '' },
                category: { id: item.catalog_group_id, name: item.group_name || '' },
                supplier: { catalogNumber: item.catalog_number || '' },
                classification: {
                    costCode: item.cost_code || '',
                    masterformat: item.masterformat || '',
                    uniformat: item.uniformat || ''
                }
            };
        }

        async function load() {
            if (catalogState.loaded || catalogState.loading) {
                render?.();
                return;
            }
            catalogState.loading = true;
            catalogState.error = '';
            render?.();
            try {
                if (browserWindow?.CatalogService) {
                    const snapshot = await browserWindow.CatalogService.getSnapshot({ enabledForProjectsOnly: false });
                    catalogState.catalogs = (snapshot.catalogs || []).map(catalog => ({
                        id: catalog.id,
                        name: catalog.name,
                        locked: Boolean(catalog.locked)
                    }));
                    catalogState.groups = (snapshot.categories || []).map(group => ({
                        id: group.id,
                        catalogId: group.catalogId || group.catalog_id,
                        parentGroupId: group.parentId || group.parent_group_id,
                        name: group.name
                    }));
                    catalogState.items = (snapshot.items || []).map(normalizeSnapshotItem);
                } else {
                    const response = typeof fetchCatalog === 'function'
                        ? await fetchCatalog()
                        : await fetch('../api/cost_catalog.php?action=list');
                    const json = typeof response?.json === 'function' ? await response.json() : response;
                    if (json?.status === 'success' && json.data) {
                        catalogState.catalogs = (json.data.catalogs || []).map(catalog => ({
                            id: catalog.id,
                            name: catalog.name,
                            locked: Boolean(Number(catalog.locked || 0))
                        }));
                        catalogState.groups = (json.data.groups || []).map(group => ({
                            id: group.id,
                            catalogId: group.catalog_id,
                            parentGroupId: group.parent_group_id,
                            name: group.name
                        }));
                        catalogState.items = (json.data.items || json.data.allItems || []).map(normalizeLegacyItem);
                    }
                }
                catalogState.loaded = true;
            } catch (error) {
                console.warn('Cost Catalog load failed', error);
                catalogState.error = error.message || 'Unable to load Cost Catalog';
            } finally {
                catalogState.loading = false;
                render?.();
            }
        }

        function normalizeSearchText(value) {
            return String(value || '')
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .toLowerCase()
                .replace(/["'“”‘’]/g, '')
                .replace(/\s+/g, ' ')
                .trim();
        }

        function compactSearchText(value) {
            return normalizeSearchText(value).replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
        }

        function scoreItemMatch(item, queryNorm, tokens, compactTokens) {
            if (!tokens.length) return 1;
            const nameNorm = normalizeSearchText(item.name);
            const nameCompact = compactSearchText(item.name);
            const codeParts = [
                item.supplier?.catalogNumber, item.supplier?.sku, item.classification?.costCode,
                item.catalogNumber, item.code, item.sku
            ].filter(Boolean);
            const codeNorm = normalizeSearchText(codeParts.join(' '));
            const codeCompact = compactSearchText(codeParts.join(' '));
            const descNorm = normalizeSearchText([item.description, item.notes].filter(Boolean).join(' '));
            const metaNorm = normalizeSearchText([
                item.catalog?.name, item.category?.name, item.uom || item.unit_of_measure,
                item.item_type || item.type, item.measurement_type || item.measurementType,
                item.supplier?.name, item.supplier?.manufacturer, item.manufacturer
            ].filter(Boolean).join(' '));
            const fullNorm = `${nameNorm} ${codeNorm} ${descNorm} ${metaNorm}`.trim();
            const fullCompact = `${nameCompact} ${codeCompact} ${compactSearchText(descNorm)} ${compactSearchText(metaNorm)}`.trim();

            for (let index = 0; index < tokens.length; index++) {
                if (!fullNorm.includes(tokens[index]) && !(compactTokens[index] && fullCompact.includes(compactTokens[index]))) return 0;
            }

            let score = 10;
            if (codeNorm && (codeNorm === queryNorm || codeCompact === compactTokens.join(' '))) score += 140;
            else if (codeNorm && codeNorm.startsWith(queryNorm)) score += 90;
            else if (codeNorm && codeNorm.includes(queryNorm)) score += 55;
            if (nameNorm === queryNorm) score += 120;
            else if (nameNorm.startsWith(queryNorm)) score += 85;
            else if (nameNorm.includes(queryNorm)) score += 50;

            for (let index = 0; index < tokens.length; index++) {
                const token = tokens[index];
                const compactToken = compactTokens[index];
                if (nameNorm.includes(token) || (compactToken && nameCompact.includes(compactToken))) {
                    score += 24;
                    if (nameNorm.startsWith(token) || nameNorm.includes(` ${token}`)) score += 8;
                } else if (codeNorm.includes(token) || (compactToken && codeCompact.includes(compactToken))) score += 18;
                else if (descNorm.includes(token)) score += 8;
                else if (metaNorm.includes(token)) score += 5;
            }
            return score;
        }

        function filterItems() {
            const queryNorm = normalizeSearchText(state.itemQuery);
            const tokens = queryNorm ? queryNorm.split(' ').filter(Boolean) : [];
            const compactTokens = tokens.map(compactSearchText);
            const scoped = (catalogState.items || []).filter(item => {
                if (state.selectedCatalogId === '__recent__') return true;
                if (state.selectedGroupId) return String(item.category?.id || '') === String(state.selectedGroupId);
                if (state.selectedCatalogId) return String(item.catalog?.id || '') === String(state.selectedCatalogId);
                return true;
            });
            if (!tokens.length) return scoped;
            return scoped
                .map(item => ({ item, score: scoreItemMatch(item, queryNorm, tokens, compactTokens) }))
                .filter(entry => entry.score > 0)
                .sort((left, right) => right.score - left.score)
                .map(entry => entry.item);
        }

        return Object.freeze({ state, open, close, load, normalizeSearchText, compactSearchText, filterItems });
    }

    return Object.freeze({ create });
});
