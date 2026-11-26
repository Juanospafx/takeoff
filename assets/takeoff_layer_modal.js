(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.TakeoffLayerModalController = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    function create(dependencies = {}) {
        const legacy = Object.assign({}, dependencies, dependencies.dom, dependencies.state,
            dependencies.constants, dependencies.presentation, dependencies.domain, dependencies.persistence);
        const {
            getElement: $, takeoffState, TAKEOFF_TYPES, TAKEOFF_SYMBOLS, TAKEOFF_SIZES,
            TAKEOFF_RICH_COLORS, TAKEOFF_UOMS, TAKEOFF_TYPE_HELP,
            setupTypeDropdown, setupUomDropdown, setupSymbolDropdown, setupSizeDropdown,
            setupColorDropdown, openCatalogModal, deleteLayer, duplicateLayer, toggleLayerLock,
            findLayer, showPrepared, needsTakeoffTypeChangeWarning, confirmTakeoffTypeChange,
            filterUomDropdownByType, isUomValidForType, defaultUomForType,
            updateTypeDropdownTrigger, updateUomDropdownTrigger, updateSymbolDropdownTrigger,
            updateSizeDropdownTrigger, updateColorDropdownTrigger, takeoffSizeRadius,
            ensureCatalogModal, esc, renderCatalogPill, quantityLabel, itemQuantitySubtitle,
            getLayerEstimatingOverride, activeEstimateId, typeToUom, allLayers,
            layerBelongsToEstimate, renderTakeoffPanel, getLayerBadgeSvg, renderLayerBadgeHtml,
            canWrite, callEditor, pushTakeoffHistory, saveTakeoffState, renderActiveLayerToolbar,
            updateSubheadSelectedItem, requireWrite, groupBelongsToEstimate,
            ensureEstimateTakeoffWorkspace, setSelectValue, takeoffDisplaySymbol,
            takeoffDisplaySize, updateCatalogSelectionIndicator, notifyEditorVisible,
            catalogItemMeta, findGroup, makeId, clearLayerCachedStateOnTypeChange,
            setActiveTakeoffLayer, syncAllLayersToCanvas, syncTakeoffFromCanvasSnapshot,
            invalidateTakeoffSheetSummary = () => {}
        } = legacy;

        let modal = null;
        let handlersBound = false;
        let commitPromise = null;
        let commitDisabledControls = [];

        function setLayerModalCommitBusy(busy) {
            const target = modal || $('takeoffLayerModal');
            if (!target) return;
            if (busy) {
                target.setAttribute?.('aria-busy', 'true');
                commitDisabledControls = Array.from(target.querySelectorAll?.('button, input, textarea, select') || [])
                    .map(control => ({ control, disabled: Boolean(control.disabled) }));
                commitDisabledControls.forEach(({ control }) => { control.disabled = true; });
                return;
            }
            target.removeAttribute?.('aria-busy');
            commitDisabledControls.forEach(({ control, disabled }) => {
                if (control?.isConnected !== false) control.disabled = disabled;
            });
            commitDisabledControls = [];
        }

        function bindModalHandlers(target) {
            if (typeof dependencies.bindCommitPaths === 'function') {
                dependencies.bindCommitPaths(commit);
                return true;
            }
            $('layerDrawerSaveBtn')?.addEventListener('click', () => { void commit(); });
            target.querySelectorAll('[data-layer-modal-close]').forEach(button => {
                button.addEventListener('click', () => { void commit(); });
            });
            target.querySelectorAll('[data-layer-tab]').forEach(button => {
                button.addEventListener('click', () => switchLayerModalTab(button.dataset.layerTab));
            });
            $('layerCatalogCard')?.addEventListener('click', () => openCatalogModal({ singleSelect: true }));
            $('layerSwapCatalogBtn')?.addEventListener('click', event => {
                event.stopPropagation();
                openCatalogModal({ singleSelect: true });
            });
            target.querySelector('[data-layer-act="delete"]')?.addEventListener('click', () => {
                if (!takeoffState.editingLayerId) return;
                deleteLayer(takeoffState.editingLayerId);
                closeLayerModal();
            });
            target.querySelector('[data-layer-act="copy"]')?.addEventListener('click', () => {
                if (!takeoffState.editingLayerId) return;
                duplicateLayer(takeoffState.editingLayerId);
                closeLayerModal();
            });
            target.querySelector('[data-layer-act="lock"]')?.addEventListener('click', () => {
                if (!takeoffState.editingLayerId) return;
                toggleLayerLock(takeoffState.editingLayerId);
                const layer = findLayer(takeoffState.editingLayerId);
                const isLocked = Boolean(layer?.locked);
                if ($('layerModalLockLabel')) $('layerModalLockLabel').textContent = isLocked ? 'Unlock' : 'Lock';
                const lockIcon = target.querySelector('[data-layer-act="lock"] i');
                if (lockIcon) lockIcon.className = `fas fa-${isLocked ? 'lock' : 'lock-open'}`;
            });
            target.querySelector('[data-layer-act="split"]')?.addEventListener('click', () => showPrepared('Split takeoff layer is ready.'));
            $('layerNameInput')?.addEventListener('input', updateLayerSubmitState);
            target.addEventListener('keydown', event => {
                if (event.key !== 'Enter') return;
                if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
                const eventTarget = event.target;
                if (!eventTarget || !eventTarget.matches?.('input, textarea, select')) return;
                if (eventTarget.id === 'layerTagInput' && event.shiftKey) return;
                if (target.querySelector('.pro-custom-dropdown.is-open')) return;
                event.preventDefault();
                void commit();
            });
            return true;
        }

        function ensure() {
            if (modal) return modal;
            modal = typeof dependencies.ensureModal === 'function' ? dependencies.ensureModal() : ensureModalDom();
            if (!modal) return null;
            if (!handlersBound) handlersBound = bindModalHandlers(modal);
            return modal;
        }

        function commit() {
            if (commitPromise) return commitPromise;
            const setBusy = dependencies.setCommitBusy || setLayerModalCommitBusy;
            setBusy(true);
            const operation = (async () => {
                const editingLayerId = typeof dependencies.getEditingLayerId === 'function'
                    ? dependencies.getEditingLayerId()
                    : takeoffState?.editingLayerId;
                if (editingLayerId) {
                    const flush = dependencies.flushActiveLayerModalSave || flushActiveLayerModalSave;
                    const dirty = dependencies.isLayerModalNonAutoDirty || isLayerModalNonAutoDirty;
                    const close = dependencies.closeLayerModal || closeLayerModal;
                    flush();
                    if (!dirty()) {
                        close();
                        return true;
                    }
                }
                const submit = dependencies.submitLayerModal || submitLayerModal;
                return typeof submit === 'function' ? await submit() : false;
            })();
            commitPromise = operation.finally(() => {
                setBusy(false);
                commitPromise = null;
            });
            return commitPromise;
        }

    function ensureModalDom() {
        let modal = $('takeoffLayerModal');
        if (modal && modal.querySelector('.pro-layer-modal')) return modal;
        if (!modal) {
            modal = document.createElement('aside');
            modal.id = 'takeoffLayerModal';
            const workspace = $('takeoffWorkspace');
            const viewer = workspace?.querySelector('.pro-takeoff-viewer');
            if (workspace && viewer) {
                workspace.insertBefore(modal, viewer);
            } else {
                document.body.appendChild(modal);
            }
        }
        modal.className = 'pro-layer-drawer';
        modal.hidden = true;
        modal.innerHTML = `<div class="pro-layer-modal" role="region" aria-labelledby="takeoffLayerModalTitle">
            <div class="pro-layer-modal-tabs">
                <button type="button" class="pro-modal-tab active" data-layer-tab="details">Main Details</button>
                <button type="button" class="pro-modal-tab" data-layer-tab="drawings">List of Drawings</button>
                <button class="pro-icon-btn pro-modal-tab-close" type="button" data-layer-modal-close aria-label="Close" title="Close Panel"><i class="fas fa-times"></i></button>
            </div>
            <div class="pro-layer-tab-pane" id="layerTabPaneDetails">
                <div class="pro-layer-form">
                    <div class="pro-field">
                        <label>Takeoff Type</label>
                        <div class="pro-custom-dropdown" id="editLayerTypeDropdown">
                            <button type="button" class="pro-custom-dropdown-trigger" id="editLayerTypeTrigger">
                                <span class="pcd-trigger-left">
                                    <span class="pcd-trigger-icon" id="editLayerTypeIconPreview"></span>
                                    <span class="pcd-trigger-text" id="editLayerTypeText">Count</span>
                                </span>
                                <span class="pcd-caret"></span>
                            </button>
                            <div class="pro-custom-dropdown-menu pcd-type-menu" id="editLayerTypeMenu"></div>
                            <select id="layerTypeInput" data-no-custom-select="true" class="native-raw-select" style="position:absolute;opacity:0;pointer-events:none;width:0;height:0;">
                                ${TAKEOFF_TYPES.map(type => `<option value="${type}">${type}</option>`).join('')}
                            </select>
                        </div>
                    </div>
                    <div class="pro-field">
                        <label for="layerNameInput">Takeoff Display Name</label>
                        <textarea id="layerNameInput" rows="2" placeholder="Enter takeoff display name"></textarea>
                    </div>
                    <div class="pro-field">
                        <label for="layerTagInput">Tag</label>
                        <textarea id="layerTagInput" rows="2" placeholder="Enter your own short text to tag this takeoff"></textarea>
                    </div>
                    <div class="pro-edit-selectors-row">
                        <div class="pro-field col-symbol" id="layerSymbolCol">
                            <label>Symbol</label>
                            <div class="pro-custom-dropdown" id="editLayerSymbolDropdown">
                                <button type="button" class="pro-custom-dropdown-trigger pcd-compact" id="editLayerSymbolTrigger">
                                    <span class="pcd-trigger-icon" id="editLayerSymbolPreview"></span>
                                    <span class="pcd-caret"></span>
                                </button>
                                <div class="pro-custom-dropdown-menu pcd-symbol-menu" id="editLayerSymbolMenu"></div>
                                <select id="layerSymbolInput" data-no-custom-select="true" class="native-raw-select" style="position:absolute;opacity:0;pointer-events:none;width:0;height:0;">
                                    ${TAKEOFF_SYMBOLS.map(symbol => `<option value="${symbol}">${symbol}</option>`).join('')}
                                </select>
                            </div>
                        </div>
                        <div class="pro-field col-size" id="layerSizeCol">
                            <label>Size</label>
                            <div class="pro-custom-dropdown" id="editLayerSizeDropdown">
                                <button type="button" class="pro-custom-dropdown-trigger pcd-compact" id="editLayerSizeTrigger">
                                    <span class="pcd-trigger-icon" id="editLayerSizePreview"></span>
                                    <span class="pcd-caret"></span>
                                </button>
                                <div class="pro-custom-dropdown-menu pcd-size-menu" id="editLayerSizeMenu"></div>
                                <select id="layerSizeInput" data-no-custom-select="true" class="native-raw-select" style="position:absolute;opacity:0;pointer-events:none;width:0;height:0;">
                                    ${TAKEOFF_SIZES.map(size => `<option value="${size}">${size}</option>`).join('')}
                                </select>
                            </div>
                        </div>
                        <div class="pro-field col-color" id="layerColorCol">
                            <label>Color</label>
                            <div class="pro-custom-dropdown" id="editLayerColorDropdown">
                                <button type="button" class="pro-custom-dropdown-trigger pcd-compact" id="editLayerColorTrigger">
                                    <span class="pcd-color-dot" id="editLayerColorSwatch" style="background:#00d2ff;"></span>
                                    <span class="pcd-caret"></span>
                                </button>
                                <div class="pro-custom-dropdown-menu pcd-color-menu" id="editLayerColorMenu"></div>
                                <select id="layerColorInput" data-no-custom-select="true" class="native-raw-select" style="position:absolute;opacity:0;pointer-events:none;width:0;height:0;">
                                    ${TAKEOFF_RICH_COLORS.map(c => `<option value="${c}">${c}</option>`).join('')}
                                    <option value="__custom__">Custom color...</option>
                                </select>
                                <input type="color" id="layerCustomColorPicker" style="position:absolute;opacity:0;pointer-events:none;width:0;height:0;">
                            </div>
                        </div>
                        <div class="pro-field col-uom" id="layerUomCol">
                            <label>UoM</label>
                            <div class="pro-custom-dropdown" id="editLayerUomDropdown">
                                <button type="button" class="pro-custom-dropdown-trigger pcd-compact" id="editLayerUomTrigger">
                                    <span class="pcd-trigger-text" id="editLayerUomText">ea</span>
                                    <span class="pcd-caret"></span>
                                </button>
                                <div class="pro-custom-dropdown-menu pcd-uom-menu" id="editLayerUomMenu"></div>
                                <select id="layerUomInput" data-no-custom-select="true" class="native-raw-select" style="position:absolute;opacity:0;pointer-events:none;width:0;height:0;">
                                    ${TAKEOFF_UOMS.map(uom => `<option value="${uom}">${uom}</option>`).join('')}
                                </select>
                            </div>
                        </div>
                        <div class="pro-field col-stroke" id="layerStrokeCol">
                            <label for="layerStrokeInput">Line width</label>
                            <div class="pro-custom-select-wrap">
                                <span class="pro-stroke-preview" id="layerStrokePreview"></span>
                                <select id="layerStrokeInput" data-no-custom-select="true" class="native-raw-select">
                                    <option value="1">1 px</option>
                                    <option value="1.5">1.5 px</option>
                                    <option value="2">2 px</option>
                                    <option value="2.5" selected>2.5 px</option>
                                    <option value="3">3 px</option>
                                </select>
                            </div>
                        </div>
                    </div>
                    <div class="pro-field">
                        <label>Associated Catalog item</label>
                        <div class="pro-associated-catalog-card" id="layerCatalogCard">
                            <div class="pro-acc-info">
                                <div class="pro-acc-top-row">
                                    <span class="pro-acc-title cc-item-name" id="layerAccTitle">Catalog Item</span>
                                </div>
                                <div class="pro-acc-details-row cc-item-meta" id="layerAccMeta">
                                    <span class="pro-cat-info-tag tag-price cc-money" title="Unit Cost">
                                        <i class="fas fa-tag"></i>
                                        <span class="tag-label">Price:</span>
                                        <strong class="tag-val" id="layerAccUc">$0.00</strong>
                                        <span class="tag-uom" id="layerAccUomSlash">/ ea</span>
                                    </span>
                                    <span class="pro-cat-info-tag tag-labor" title="Labor Time">
                                        <i class="far fa-clock"></i>
                                        <span class="tag-label">Labor:</span>
                                        <strong class="tag-val" id="layerAccUlt">0.00 hrs</strong>
                                    </span>
                                    <span id="layerAccCatPillWrap"></span>
                                </div>
                            </div>
                            <button type="button" class="pro-catalog-swap-btn" id="layerSwapCatalogBtn" title="Change item from Cost Catalog" aria-label="Change item from Cost Catalog">
                                <i class="fas fa-arrows-rotate"></i>
                            </button>
                        </div>
                    </div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                        <div class="pro-field" id="layerMultiplierField">
                            <label for="layerMultiplierInput">Multiplier</label>
                            <input id="layerMultiplierInput" type="number" min="0" step="any" value="1">
                        </div>
                        <div class="pro-field" id="layerDifficultyField">
                            <label for="layerDifficultyInput">Difficulty Factor</label>
                            <input id="layerDifficultyInput" type="number" min="0.1" step="0.1" value="1.0" placeholder="1.0">
                        </div>
                    </div>
                    <div class="pro-field" id="layerDropField">
                        <label for="layerDropInput">Default Drop Length (ft)</label>
                        <input id="layerDropInput" type="number" min="0" step="0.1" placeholder="0">
                    </div>
                    <div class="pro-field" id="layerSpacingField" style="display:none;">
                        <label for="layerSpacingInput">Spacing (ft)</label>
                        <input id="layerSpacingInput" type="number" min="0.1" step="0.1" placeholder="1">
                    </div>
                    <div style="display:none;">
                        <h3 id="takeoffLayerModalTitle">Edit takeoff layer</h3>
                        <p id="layerTypeHelp"></p>
                        <div id="layerCatalogSelected"></div>
                        <input id="layerDiameterInput" type="number">
                        <input id="layerHeightInput" type="number">
                        <input id="layerDepthInput" type="number">
                        <button type="button" id="layerCreateSubmit">Save</button>
                    </div>
                </div>
            </div>
            <div class="pro-layer-tab-pane" id="layerTabPaneDrawings" hidden>
                <div class="pro-drawings-list-wrap" id="layerDrawingsList"></div>
            </div>
            <div class="pro-layer-modal-foot">
                <div class="pro-modal-foot-left">
                    <button type="button" class="pro-foot-btn danger" data-layer-act="delete" title="Delete takeoff layer"><i class="fas fa-trash-can"></i> Delete</button>
                    <button type="button" class="pro-foot-btn" data-layer-act="copy" title="Copy takeoff layer"><i class="far fa-copy"></i> Copy</button>
                    <button type="button" class="pro-foot-btn" data-layer-act="lock" title="Lock/Unlock takeoff layer"><i class="fas fa-lock"></i> <span id="layerModalLockLabel">Lock</span></button>
                </div>
                <div class="pro-modal-foot-right">
                    <button type="button" class="pro-btn-save-layer" id="layerDrawerSaveBtn" data-keyboard-accept><i class="fas fa-xmark"></i> Close</button>
                </div>
            </div>
        </div>`;
        setupTypeDropdown('editLayer', $('layerTypeInput'));
        setupUomDropdown('editLayer', $('layerUomInput'));
        setupSymbolDropdown('editLayer', $('layerSymbolInput'));
        setupSizeDropdown('editLayer', $('layerSizeInput'));
        setupColorDropdown('editLayer', $('layerColorInput'), $('layerCustomColorPicker'));

        $('layerTypeInput').addEventListener('change', async () => {
            const type = $('layerTypeInput').value;
            if (!layerModalPopulating && takeoffState.editingLayerId && needsTakeoffTypeChangeWarning(layerModalActiveFormType, type)) {
                const editingLayer = findLayer(takeoffState.editingLayerId);
                const prevType = layerModalActiveFormType;
                const confirmed = await confirmTakeoffTypeChange({ layer: editingLayer, prevType, nextType: type });
                if (!confirmed) {
                    $('layerTypeInput').value = prevType;
                    $('layerTypeHelp').textContent = TAKEOFF_TYPE_HELP[prevType] || TAKEOFF_TYPE_HELP.Count;
                    filterUomDropdownByType('editLayer', prevType);
                    updateTypeDropdownTrigger('editLayer', prevType);
                    updateLayerTypeIcon();
                    updateLayerTypeFields(prevType);
                    updateLayerSubmitState();
                    return;
                }
            }
            layerModalActiveFormType = type;
            $('layerTypeHelp').textContent = TAKEOFF_TYPE_HELP[type] || TAKEOFF_TYPE_HELP.Count;
            filterUomDropdownByType('editLayer', type);
            if (!isUomValidForType($('layerUomInput')?.value, type)) {
                const newUom = defaultUomForType(type);
                if ($('layerUomInput')) $('layerUomInput').value = newUom;
                updateUomDropdownTrigger('editLayer', newUom);
            }
            updateTypeDropdownTrigger('editLayer', type);
            updateLayerTypeIcon();
            updateLayerTypeFields(type);
            updateLayerSubmitState();
        });

        $('layerUomInput')?.addEventListener('change', () => {
            updateUomDropdownTrigger('editLayer', $('layerUomInput').value);
            scheduleLiveLayerModalSave({ immediate: true });
        });

        $('layerSymbolInput')?.addEventListener('change', () => {
            updateSymbolDropdownTrigger('editLayer', $('layerSymbolInput').value);
            scheduleLiveLayerModalSave({ immediate: true });
        });

        $('layerSizeInput')?.addEventListener('change', () => {
            const nextSize = $('layerSizeInput').value;
            updateSizeDropdownTrigger('editLayer', nextSize);
            const r = takeoffSizeRadius(nextSize);
            if ($('layerDiameterInput')) $('layerDiameterInput').value = r * 2;
            scheduleLiveLayerModalSave({ immediate: true });
        });

        $('layerStrokeInput').addEventListener('change', updateLayerStrokePreview);

        $('layerColorInput').addEventListener('change', () => {
            if ($('layerColorInput').value === '__custom__') {
                $('layerCustomColorPicker')?.click();
            } else {
                updateLayerColorSwatch();
                scheduleLiveLayerModalSave({ immediate: true });
            }
        });
        $('layerCustomColorPicker')?.addEventListener('input', event => {
            setLayerColor(event.target.value);
            scheduleLiveLayerModalSave({ debounceMs: 120 });
        });
        $('layerCustomColorPicker')?.addEventListener('change', event => {
            setLayerColor(event.target.value);
            scheduleLiveLayerModalSave({ immediate: true });
        });
        $('layerCreateSubmit').addEventListener('click', submitLayerModal);
        ensureCatalogModal();
        return modal;
    }


    function switchLayerModalTab(tabName) {
        document.querySelectorAll('.pro-modal-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.layerTab === tabName);
        });
        const detailsPane = $('layerTabPaneDetails');
        const drawingsPane = $('layerTabPaneDrawings');
        if (detailsPane) detailsPane.hidden = tabName !== 'details';
        if (drawingsPane) drawingsPane.hidden = tabName !== 'drawings';
    }

    function updateLayerTypeIcon() {
        const icon = $('layerTypeIconPreview');
        if (!icon) return;
        const type = $('layerTypeInput')?.value || 'Count';
        if (type === 'Linear avg. with drop') {
            icon.innerHTML = '<i class="fas fa-network-wired"></i>';
        } else if (type.includes('Linear')) {
            icon.innerHTML = '<i class="fas fa-minus"></i>';
        } else if (type.includes('Area')) {
            icon.innerHTML = '<i class="far fa-square"></i>';
        } else {
            icon.innerHTML = '<i class="fas fa-circle-dot"></i>';
        }
    }

    function updateLayerStrokePreview() {
        const preview = $('layerStrokePreview');
        const input = $('layerStrokeInput');
        if (preview && input) {
            preview.style.height = `${Math.max(1, Math.min(3, Number(input.value) || 2.5))}px`;
        }
    }

    function updateAssociatedCatalogCard(layer) {
        const item = takeoffState.pendingCatalogItem || (layer?.catalogItemId ? {
            name: layer.name,
            description: layer.description,
            uom: layer.uom,
            unitCost: layer.unitCost,
            laborHours: layer.laborHours,
            code: layer.catalogCode || '',
            catalog_name: layer.catalog_name || layer.catalogName || '',
            catalog_id: layer.catalog_id || layer.catalogId || '',
            group_name: layer.category || layer.group_name || ''
        } : null);

        const card = $('layerCatalogCard');
        if (!card) return;

        if (item) {
            const cost = Number(item.unit_cost ?? item.unitCost ?? 0);
            const labor = Number(item.labor_hours ?? item.laborHours ?? 0);
            const uom = esc(item.uom || layer?.uom || 'ea');
            const code = item.code || item.item_code || item.supplier?.catalogNumber || layer?.catalogCode || '';
            const catName = item.catalog?.name || item.catalog_name || '';
            const catId = item.catalog?.id || item.catalog_id || '';
            const grpName = item.category?.name || item.group_name || '';
            const grpId = item.category?.id || item.catalog_group_id || '';

            if ($('layerAccTitle')) $('layerAccTitle').textContent = item.name || layer?.name || 'Catalog Item';
            if ($('layerAccDesc')) $('layerAccDesc').style.display = 'none';
            if ($('layerAccUc')) $('layerAccUc').textContent = cost > 0 ? `$${cost.toFixed(2)}` : '$0.00';
            if ($('layerAccUomSlash')) $('layerAccUomSlash').textContent = `/ ${uom}`;
            if ($('layerAccUlt')) $('layerAccUlt').textContent = labor > 0 ? `${labor.toFixed(2)} hrs` : '0.00 hrs';
            if ($('layerAccUom')) $('layerAccUom').textContent = uom;
            if ($('layerAccCnTag')) $('layerAccCnTag').style.display = 'none';

            const catWrap = $('layerAccCatPillWrap');
            if (catWrap) {
                catWrap.innerHTML = catName ? renderCatalogPill(catName, catId) : '';
                catWrap.style.display = catName ? '' : 'none';
            }
            const grpWrap = $('layerAccGrpPillWrap');
            if (grpWrap) grpWrap.style.display = 'none';
        } else {
            const uom = esc(layer?.uom || 'ea');
            const cost = Number(layer?.unitCost || 0);
            const labor = Number(layer?.laborHours || 0);

            if ($('layerAccTitle')) $('layerAccTitle').textContent = layer?.name || 'Custom Layer';
            if ($('layerAccDesc')) $('layerAccDesc').style.display = 'none';
            if ($('layerAccUc')) $('layerAccUc').textContent = cost > 0 ? `$${cost.toFixed(2)}` : '$0.00';
            if ($('layerAccUomSlash')) $('layerAccUomSlash').textContent = `/ ${uom}`;
            if ($('layerAccUlt')) $('layerAccUlt').textContent = labor > 0 ? `${labor.toFixed(2)} hrs` : '0.00 hrs';
            if ($('layerAccUom')) $('layerAccUom').textContent = uom;
            if ($('layerAccCnTag')) $('layerAccCnTag').style.display = 'none';
            if ($('layerAccCatPillWrap')) {
                $('layerAccCatPillWrap').innerHTML = '';
                $('layerAccCatPillWrap').style.display = 'none';
            }
            if ($('layerAccGrpPillWrap')) $('layerAccGrpPillWrap').style.display = 'none';
        }
    }

    function updateLayerDrawingsList(layer) {
        const container = $('layerDrawingsList');
        if (!container) return;
        const currentDoc = (window.documentState?.drawings || []).find(d => String(d.id) === String(window.currentDrawingId));
        const docName = currentDoc?.name || 'Current Drawing (E1.0 - Power Plan)';
        const count = layer ? (layer.quantity ? `${quantityLabel(layer)}` : '0 items') : '0 items';
        container.innerHTML = `
            <div class="pro-drawing-row-item">
                <span class="pro-drawing-row-title"><i class="fas fa-file-lines" style="margin-right:8px;color:var(--tk-primary);"></i> ${esc(docName)}</span>
                <span class="pro-drawing-row-qty">${esc(count)}</span>
            </div>
            <div style="font-size:0.75rem;color:var(--tk-text-muted);margin-top:8px;">
                <i class="fas fa-info-circle"></i> This takeoff layer is active on the current drawing plan.
            </div>
        `;
    }

    function updateLayerTypeFields(type = $('layerTypeInput')?.value || 'Count') {
        const dropField = $('layerDropField');
        if (dropField) {
            const hasDrop = ['Linear with drop', 'Linear avg. with drop'].includes(type);
            dropField.style.display = hasDrop ? 'flex' : 'none';
        }
        const spacingField = $('layerSpacingField');
        if (spacingField) {
            spacingField.style.display = type === 'Count by distance' ? 'flex' : 'none';
        }
        const isPointCount = type === 'Count';
        const symCol = $('layerSymbolCol');
        const sizeCol = $('layerSizeCol');
        const strokeCol = $('layerStrokeCol');
        if (symCol) symCol.style.display = isPointCount ? 'block' : 'none';
        if (sizeCol) sizeCol.style.display = isPointCount ? 'block' : 'none';
        if (strokeCol) strokeCol.style.display = isPointCount ? 'none' : 'block';
    }

    let layerModalLiveSaveTimer = null;
    let layerModalPendingSave = false;
    let layerModalPopulating = false;
    let layerModalHistorySnapshotId = null;
    let layerModalActiveFormType = 'Count';
    let layerModalNonAutoBaseline = null;
    let layerModalLiveBackendTimer = null;
    let layerModalNeedsBackendSave = false;

    function getLayerModalNonAutoSnapshot() {
        const rawMult = $('layerMultiplierInput')?.value;
        const parsedMult = (rawMult !== undefined && rawMult !== '' && Number.isFinite(Number(rawMult)) && Number(rawMult) >= 0)
            ? Number(rawMult)
            : 1;
        return {
            type: $('layerTypeInput')?.value || 'Count',
            name: ($('layerNameInput')?.value || '').replace(/\r?\n+/g, ' ').trim(),
            tag: ($('layerTagInput')?.value || '').replace(/\r?\n+/g, ' ').trim(),
            strokeWidth: Math.max(1, Math.min(3, parseFloat($('layerStrokeInput')?.value || '2.5') || 2.5)),
            difficulty: parseFloat($('layerDifficultyInput')?.value || '1.0') || 1.0,
            multiplier: parsedMult,
            dropLength: Number($('layerDropInput')?.value || 0),
            spacing: Number($('layerSpacingInput')?.value || 0),
            height: Number($('layerHeightInput')?.value || 0),
            depth: Number($('layerDepthInput')?.value || 0),
            hasNewCatalogPickerItem: Boolean(takeoffState.pendingCatalogItem && takeoffState.pendingCatalogItem._fromCatalogPicker === true)
        };
    }

    function isLayerModalNonAutoDirty() {
        if (!takeoffState.editingLayerId) return Boolean(($('layerNameInput')?.value || '').trim());
        if (!layerModalNonAutoBaseline) return false;
        const curr = getLayerModalNonAutoSnapshot();
        return (
            curr.type !== layerModalNonAutoBaseline.type ||
            curr.name !== layerModalNonAutoBaseline.name ||
            curr.tag !== layerModalNonAutoBaseline.tag ||
            curr.strokeWidth !== layerModalNonAutoBaseline.strokeWidth ||
            curr.difficulty !== layerModalNonAutoBaseline.difficulty ||
            curr.multiplier !== layerModalNonAutoBaseline.multiplier ||
            curr.dropLength !== layerModalNonAutoBaseline.dropLength ||
            curr.spacing !== layerModalNonAutoBaseline.spacing ||
            curr.height !== layerModalNonAutoBaseline.height ||
            curr.depth !== layerModalNonAutoBaseline.depth ||
            Boolean(curr.hasNewCatalogPickerItem)
        );
    }

    function patchTakeoffLayerRowQuantityDom(layer) {
        if (!layer || !layer.id || typeof document === 'undefined') return false;
        const escId = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(String(layer.id)) : String(layer.id);
        const row = document.querySelector(`[data-layer-row="${escId}"]`);
        if (!row) return false;
        const qtyEl = row.querySelector('.pro-tree-qty');
        if (qtyEl) {
            qtyEl.textContent = itemQuantitySubtitle(layer);
        }
        const overrideInfo = getLayerEstimatingOverride(layer, activeEstimateId());
        const existingBadge = row.querySelector('[data-qty-override-badge]');
        if (Boolean(existingBadge) !== Boolean(overrideInfo.overridden)) {
            return false;
        }
        if (existingBadge && overrideInfo.overridden) {
            const uom = layer.uom || typeToUom(layer.type) || 'ea';
            const estQtyNum = Number(overrideInfo.estimatingQuantity || 0);
            const estQtyFormatted = estQtyNum % 1 === 0 ? estQtyNum.toFixed(0) : estQtyNum.toFixed(2);
            const tkQtyNum = Number(layer.quantity || 0);
            const tkQtyFormatted = tkQtyNum % 1 === 0 ? tkQtyNum.toFixed(0) : tkQtyNum.toFixed(2);
            existingBadge.title = `Quantity altered in Estimating: ${estQtyFormatted} ${uom} (Takeoff measured: ${tkQtyFormatted} ${uom})`;
            const spanEl = existingBadge.querySelector('span');
            if (spanEl) spanEl.textContent = `Est: ${estQtyFormatted} ${uom}`;
        }
        return true;
    }

    function patchAllTakeoffLayerQuantityDom() {
        const layers = allLayers().filter(layer => layerBelongsToEstimate(layer));
        if (!layers.length) return false;
        let allPatched = true;
        for (const layer of layers) {
            if (!patchTakeoffLayerRowQuantityDom(layer)) allPatched = false;
        }
        return allPatched;
    }

    function refreshTakeoffLayerRowDom(layer) {
        if (!layer || !layer.id) return false;
        const escId = CSS.escape ? CSS.escape(String(layer.id)) : String(layer.id);
        const row = document.querySelector(`[data-layer-row="${escId}"]`);
        if (!row) {
            renderTakeoffPanel();
            return false;
        }
        const existingTagEl = row.querySelector('.pro-tree-item-tag');
        const hasTagDom = Boolean(existingTagEl);
        const hasTagModel = Boolean(layer.tag);
        if (hasTagDom !== hasTagModel) {
            renderTakeoffPanel();
            return false;
        }
        const titleEl = row.querySelector('.pro-tree-item-title');
        if (titleEl) {
            titleEl.textContent = layer.name || '';
            titleEl.title = layer.name || '';
        }
        if (existingTagEl && hasTagModel) {
            existingTagEl.innerHTML = `<i class="fas fa-tag"></i> ${esc(layer.tag)}`;
        }
        const badgeWrap = row.querySelector('.pro-layer-symbol-badge');
        if (badgeWrap) {
            const symbolLabel = layer.symbol || layer.type || 'Item';
            badgeWrap.title = `${symbolLabel} (${layer.color || '#3b82f6'})`;
            badgeWrap.innerHTML = getLayerBadgeSvg(layer, 13);
        } else {
            const subEl = row.querySelector('.pro-tree-item-sub');
            if (subEl) {
                subEl.insertAdjacentHTML('afterbegin', renderLayerBadgeHtml(layer, 13));
            }
        }
        if (!patchTakeoffLayerRowQuantityDom(layer)) {
            renderTakeoffPanel();
            return false;
        }
        return true;
    }

    function scheduleLiveLayerBackendSave(delayMs = 380) {
        layerModalNeedsBackendSave = true;
        if (layerModalLiveBackendTimer) {
            clearTimeout(layerModalLiveBackendTimer);
            layerModalLiveBackendTimer = null;
        }
        if (delayMs <= 0) {
            flushLiveLayerBackendSave();
            return;
        }
        layerModalLiveBackendTimer = setTimeout(() => {
            layerModalLiveBackendTimer = null;
            flushLiveLayerBackendSave();
        }, delayMs);
    }

    function flushLiveLayerBackendSave() {
        if (layerModalLiveBackendTimer) {
            clearTimeout(layerModalLiveBackendTimer);
            layerModalLiveBackendTimer = null;
        }
        if (!layerModalNeedsBackendSave || !canWrite()) return;
        layerModalNeedsBackendSave = false;
        try {
            const saved = callEditor('projectTakeoffSave');
            if (saved && typeof saved.then === 'function') {
                saved.catch(err => console.warn('Takeoff live layer save warning:', err));
            }
        } catch (editorErr) {
            console.warn('Takeoff live layer save warning:', editorErr);
        }
    }

    function applyLiveLayerModalEdits({ syncBackend = true } = {}) {
        if (layerModalPopulating || !canWrite()) return false;
        const editingLayerId = takeoffState.editingLayerId;
        if (!editingLayerId) return false;
        const layer = findLayer(editingLayerId);
        if (!layer) return false;
        if (layerModalHistorySnapshotId !== editingLayerId) {
            pushTakeoffHistory('edit-layer');
            layerModalHistorySnapshotId = editingLayerId;
        }
        // Auto-save applies strictly to UoM, Symbol, Size, and Color; remaining fields save through Close.
        const chosenColor = ($('layerColorInput')?.value === '__custom__'
            ? $('layerCustomColorPicker')?.value
            : $('layerColorInput')?.value) || layer.color || '#ef4444';
        const chosenSize = $('layerSizeInput')?.value || layer.size || 'Medium';
        const calcRadius = takeoffSizeRadius(chosenSize);
        const markerDiameter = calcRadius * 2;
        if ($('layerDiameterInput')) $('layerDiameterInput').value = markerDiameter;
        const chosenUom = $('layerUomInput')?.value || layer.uom || typeToUom(layer.type || 'Count');
        const chosenSymbol = $('layerSymbolInput')?.value || layer.symbol || 'Solid Circle';
        const uomChanged = String(layer.uom || '') !== String(chosenUom || '');

        layer.uom = chosenUom;
        layer.symbol = chosenSymbol;
        layer.size = chosenSize;
        layer.markerDiameter = markerDiameter;
        layer.color = chosenColor;

        callEditor('projectTakeoffUpdateLayerObjects', editingLayerId, {
            uom: chosenUom,
            symbol: chosenSymbol,
            color: chosenColor,
            symbolSize: calcRadius,
            diameter: markerDiameter
        });
        saveTakeoffState(uomChanged ? { debounceEstimatingSync: true } : { skipEstimatingSync: true });
        refreshTakeoffLayerRowDom(layer);
        renderActiveLayerToolbar();
        updateSubheadSelectedItem();
        if (takeoffState.editingLayerId === editingLayerId) {
            const activeMenuBtn = document.querySelector(`[data-layer-menu="${CSS.escape ? CSS.escape(editingLayerId) : editingLayerId}"]`);
            if (activeMenuBtn) {
                activeMenuBtn.setAttribute('aria-expanded', 'true');
                activeMenuBtn.classList.add('is-active');
            }
        }
        window.dispatchEvent(new CustomEvent('takeoff:layer-visuals-updated', { detail: { projectId: String(window.ProjectState?.projectId || '') } }));
        if (syncBackend) {
            scheduleLiveLayerBackendSave(360);
            layerModalPendingSave = false;
        }
        return true;
    }

    function scheduleLiveLayerModalSave({ immediate = false, debounceMs = 220 } = {}) {
        if (layerModalPopulating || !takeoffState.editingLayerId || !canWrite()) return;
        layerModalPendingSave = true;
        if (layerModalLiveSaveTimer) {
            clearTimeout(layerModalLiveSaveTimer);
            layerModalLiveSaveTimer = null;
        }
        if (immediate) {
            applyLiveLayerModalEdits({ syncBackend: true });
            return;
        }
        applyLiveLayerModalEdits({ syncBackend: false });
        layerModalLiveSaveTimer = setTimeout(() => {
            layerModalLiveSaveTimer = null;
            applyLiveLayerModalEdits({ syncBackend: true });
        }, debounceMs);
    }

    function flushActiveLayerModalSave() {
        if (layerModalLiveSaveTimer) {
            clearTimeout(layerModalLiveSaveTimer);
            layerModalLiveSaveTimer = null;
        }
        if (!takeoffState.editingLayerId || !canWrite()) {
            layerModalPendingSave = false;
            return false;
        }
        if (!layerModalPendingSave) return false;
        return applyLiveLayerModalEdits({ syncBackend: true });
    }

    function openLayerModal(groupId = takeoffState.activeGroupId, layerId = null, triggerEl = null) {
        if (!requireWrite()) return false;
        if (takeoffState.editingLayerId && takeoffState.editingLayerId !== layerId) {
            flushActiveLayerModalSave();
        }
        if (!layerId && !takeoffState.groups.some(group => groupBelongsToEstimate(group))) {
            ensureEstimateTakeoffWorkspace(activeEstimateId(), true);
            groupId = takeoffState.activeGroupId;
        }
        ensure();
        layerModalPopulating = true;
        layerModalHistorySnapshotId = null;
        const layer = layerId ? findLayer(layerId) : null;
        takeoffState.pendingLayerGroupId = groupId || layer?.groupId || takeoffState.activeGroupId || 'default';
        takeoffState.editingLayerId = layerId;
        takeoffState.pendingCatalogItem = layer?.catalogItemId ? {
            id: layer.catalogItemId,
            name: layer.name,
            unit_of_measure: layer.uom,
            unit_cost: layer.unitCost,
            labor_hours: layer.laborHours,
            catalog_name: layer.category,
            group_name: layer.category,
            description: layer.description,
            code: layer.catalogCode || layer.code || 'EMT-ASM-2025'
        } : null;

        switchLayerModalTab('details');

        if ($('takeoffLayerModalTitle')) $('takeoffLayerModalTitle').textContent = layer ? 'Edit takeoff layer' : 'Create new takeoff layer';
        $('layerNameInput').value = layer?.name || '';
        if ($('layerTagInput')) $('layerTagInput').value = layer?.tag || '';
        if ($('layerMultiplierInput')) $('layerMultiplierInput').value = (layer?.multiplier !== undefined && layer?.multiplier !== null && layer?.multiplier !== '') ? layer.multiplier : 1;
        if ($('layerDifficultyInput')) $('layerDifficultyInput').value = layer?.difficulty !== undefined ? layer.difficulty : (layer?.metadata_json?.difficulty !== undefined ? layer.metadata_json.difficulty : 1.0);
        ['layerDifficultyInput', 'layerMultiplierInput'].forEach(id => {
            const el = $(id);
            if (el && !el._selectBound) {
                el._selectBound = true;
                el.addEventListener('focus', () => el.select());
                el.addEventListener('click', () => el.select());
            }
        });
        $('layerTypeInput').value = layer?.type || 'Linear avg. with drop';
        if (!$('layerTypeInput').value) $('layerTypeInput').value = 'Count';
        if ($('layerTypeHelp')) $('layerTypeHelp').textContent = TAKEOFF_TYPE_HELP[$('layerTypeInput').value] || TAKEOFF_TYPE_HELP.Count;
        setSelectValue($('layerUomInput'), layer?.uom || typeToUom($('layerTypeInput').value));
        if ($('layerSymbolInput')) $('layerSymbolInput').value = takeoffDisplaySymbol(layer?.symbol);
        if ($('layerSizeInput')) $('layerSizeInput').value = takeoffDisplaySize(layer?.size);
        if ($('layerDiameterInput')) $('layerDiameterInput').value = Number(layer?.markerDiameter || (takeoffSizeRadius(layer?.size || 'Medium') * 2));

        const strokeVal = Number(layer?.strokeWidth || 2.5);
        setSelectValue($('layerStrokeInput'), String(strokeVal));
        updateLayerStrokePreview();

        setLayerColor(layer?.color || '#ef4444');
        if ($('layerDropInput')) $('layerDropInput').value = layer?.dropLength || 0;
        if ($('layerSpacingInput')) $('layerSpacingInput').value = layer?.spacing || '';
        if ($('layerHeightInput')) $('layerHeightInput').value = layer?.height || '';
        if ($('layerDepthInput')) $('layerDepthInput').value = layer?.depth || '';
        if ($('layerCreateSubmit')) $('layerCreateSubmit').textContent = layer ? 'Save' : 'Create';

        const isLocked = Boolean(layer?.locked);
        if ($('layerModalLockLabel')) $('layerModalLockLabel').textContent = isLocked ? 'Unlock' : 'Lock';
        const lockIcon = $('takeoffLayerModal')?.querySelector('[data-layer-act="lock"] i');
        if (lockIcon) lockIcon.className = `fas fa-${isLocked ? 'lock' : 'lock-open'}`;

        updateAssociatedCatalogCard(layer);
        updateLayerDrawingsList(layer);
        const currentEditType = $('layerTypeInput').value;
        filterUomDropdownByType('editLayer', currentEditType);
        if (!$('layerUomInput')?.value) {
            setSelectValue($('layerUomInput'), defaultUomForType(currentEditType));
        }
        updateTypeDropdownTrigger('editLayer', currentEditType);
        updateUomDropdownTrigger('editLayer', $('layerUomInput')?.value || 'ea');
        updateSymbolDropdownTrigger('editLayer', $('layerSymbolInput')?.value || 'Solid Circle');
        updateSizeDropdownTrigger('editLayer', $('layerSizeInput')?.value || 'Medium');
        updateCatalogSelectionIndicator();
        updateLayerColorSwatch();
        updateLayerTypeFields($('layerTypeInput').value);
        layerModalActiveFormType = $('layerTypeInput').value || 'Count';
        updateLayerSubmitState();

        document.querySelectorAll('[data-layer-menu]').forEach(b => {
            b.setAttribute('aria-expanded', 'false');
            b.classList.remove('is-active');
        });
        if (typeof window.closeAllOpenPopouts === 'function') window.closeAllOpenPopouts();
        if (triggerEl) {
            triggerEl.setAttribute('aria-expanded', 'true');
            triggerEl.classList.add('is-active');
        }

        const modal = $('takeoffLayerModal');
        const workspace = $('takeoffWorkspace');
        if (modal) {
            const wasDrawerOpen = Boolean(!modal.hidden && workspace?.classList.contains('has-layer-drawer'));
            modal.hidden = false;
            void modal.offsetWidth;
            workspace?.classList.add('has-layer-drawer');
            if (!wasDrawerOpen) {
                notifyEditorVisible();
                setTimeout(() => notifyEditorVisible(), 260);
            }
        }
        layerModalNonAutoBaseline = getLayerModalNonAutoSnapshot();
        layerModalPopulating = false;
        layerModalPendingSave = false;
        setTimeout(() => $('layerNameInput')?.focus(), 50);
    }

    function repositionLayerModal() {
        notifyEditorVisible();
    }

    function closeLayerModal() {
        flushActiveLayerModalSave();
        flushLiveLayerBackendSave();
        layerModalHistorySnapshotId = null;
        layerModalNonAutoBaseline = null;
        const modal = $('takeoffLayerModal');
        const workspace = $('takeoffWorkspace');
        if (modal) {
            workspace?.classList.remove('has-layer-drawer');
            notifyEditorVisible();
            setTimeout(() => {
                if (!workspace?.classList.contains('has-layer-drawer')) {
                    modal.hidden = true;
                }
                notifyEditorVisible();
            }, 260);
        }
        document.querySelectorAll('[data-layer-menu]').forEach(b => {
            b.setAttribute('aria-expanded', 'false');
            b.classList.remove('is-active');
        });
        takeoffState.editingLayerId = null;
        takeoffState.pendingCatalogItem = null;
    }

    function setLayerColor(color, { notify = false } = {}) {
        const input = $('layerColorInput');
        const picker = $('layerCustomColorPicker');
        if (!input) return;
        const hex = String(color || '#ef4444').trim();
        let match = Array.from(input.options).find(opt => opt.value.toLowerCase() === hex.toLowerCase());
        if (!match && hex !== '__custom__') {
            const opt = document.createElement('option');
            opt.value = hex;
            opt.textContent = `Custom (${hex})`;
            const customOpt = input.querySelector('option[value="__custom__"]');
            if (customOpt) input.insertBefore(opt, customOpt);
            else input.appendChild(opt);
            match = opt;
        }
        if (match) input.value = match.value;
        if (picker && hex.startsWith('#') && (hex.length === 7 || hex.length === 4)) {
            picker.value = hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;
        }
        updateLayerColorSwatch();
        updateColorDropdownTrigger('editLayer', hex);
        if (notify && !layerModalPopulating && hex !== '__custom__') {
            input.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    function updateLayerColorSwatch() {
        const swatch = $('layerColorSwatch');
        const editSwatch = $('editLayerColorSwatch');
        const color = ($('layerColorInput')?.value === '__custom__' ? $('layerCustomColorPicker')?.value : $('layerColorInput')?.value) || '#ef4444';
        if (swatch) swatch.style.background = color;
        if (editSwatch) editSwatch.style.background = color;
        updateColorDropdownTrigger('editLayer', color);
    }

    function updateLayerSubmitState() {
        const submit = $('layerCreateSubmit');
        if (submit) submit.disabled = !$('layerNameInput')?.value.trim();
    }


    async function submitLayerModal() {
        if (!requireWrite()) return false;
        const name = $('layerNameInput')?.value.replace(/\r?\n+/g, ' ').trim();
        if (!name) return closeLayerModal();
        const submit = $('layerCreateSubmit');
        if (submit?.dataset.saving === '1') return;
        const editingLayerId = takeoffState.editingLayerId;
        const editingLayer = editingLayerId ? findLayer(editingLayerId) : null;
        const previousLayerType = editingLayer?.type || 'Count';
        const nextFormType = $('layerTypeInput').value;
        const typeFamilyChanged = Boolean(editingLayer && needsTakeoffTypeChangeWarning(previousLayerType, nextFormType));
        if (typeFamilyChanged && needsTakeoffTypeChangeWarning(layerModalActiveFormType, nextFormType)) {
            const confirmed = await confirmTakeoffTypeChange({ layer: editingLayer, prevType: previousLayerType, nextType: nextFormType });
            if (!confirmed) return false;
        }
        const drawerSaveBtn = $('layerDrawerSaveBtn');
        if (drawerSaveBtn) {
            drawerSaveBtn.disabled = true;
            drawerSaveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
        }
        if (submit) {
            submit.dataset.saving = '1';
            submit.disabled = true;
            submit.textContent = 'Saving...';
        }
        try {
            pushTakeoffHistory(editingLayerId ? 'edit-layer' : 'create-layer');
            const type = nextFormType;
            const chosenColor = ($('layerColorInput')?.value === '__custom__'
                ? $('layerCustomColorPicker')?.value
                : $('layerColorInput')?.value) || '#ef4444';
            const chosenSize = $('layerSizeInput')?.value || 'Medium';
            const calcRadius = takeoffSizeRadius(chosenSize);
            const markerDiameter = calcRadius * 2;
            if ($('layerDiameterInput')) $('layerDiameterInput').value = markerDiameter;
            const strokeVal = parseFloat($('layerStrokeInput')?.value || '2.5') || 2.5;
            const diffVal = parseFloat($('layerDifficultyInput')?.value || '1.0') || 1.0;
            const rawMult = $('layerMultiplierInput')?.value;
            const parsedMult = (rawMult !== undefined && rawMult !== '' && Number.isFinite(Number(rawMult)) && Number(rawMult) >= 0)
                ? Number(rawMult)
                : 1;
            const payload = {
                name,
                type,
                tag: $('layerTagInput')?.value.replace(/\r?\n+/g, ' ').trim() || '',
                multiplier: parsedMult,
                difficulty: diffVal,
                uom: $('layerUomInput')?.value || typeToUom(type),
                symbol: $('layerSymbolInput')?.value || 'Solid Circle',
                size: chosenSize,
                markerDiameter: markerDiameter,
                strokeWidth: Math.max(1, Math.min(3, strokeVal)),
                color: chosenColor,
                dropLength: Number($('layerDropInput')?.value || 0),
                spacing: Number($('layerSpacingInput')?.value || 0),
                height: Number($('layerHeightInput')?.value || 0),
                depth: Number($('layerDepthInput')?.value || 0)
            };
            if (takeoffState.pendingCatalogItem && takeoffState.pendingCatalogItem._fromCatalogPicker === true) {
                try {
                    Object.assign(payload, catalogItemMeta(takeoffState.pendingCatalogItem));
                } catch (metaError) {
                    console.warn('catalogItemMeta failed', metaError);
                    payload.catalogItemId = takeoffState.pendingCatalogItem.id;
                    payload.catalog_item_id = takeoffState.pendingCatalogItem.id;
                }
            }
            let savedLayerId = editingLayerId;
            const prevLayer = editingLayer;
            const nameChanged = prevLayer ? (String(prevLayer.name || '') !== String(payload.name || '')) : true;
            const tagChanged = prevLayer ? (String(prevLayer.tag || '') !== String(payload.tag || '')) : Boolean(payload.tag);
            const diffChanged = prevLayer ? (Number(prevLayer.difficulty ?? prevLayer.metadata_json?.difficulty ?? 1) !== Number(payload.difficulty)) : false;
            const multChanged = prevLayer ? (Number(prevLayer.multiplier ?? prevLayer.metadata_json?.multiplier ?? 1) !== Number(payload.multiplier)) : false;
            const dropChanged = prevLayer ? (Number(prevLayer.dropLength || 0) !== Number(payload.dropLength)) : false;
            const spacingChanged = prevLayer ? (Number(prevLayer.spacing || 0) !== Number(payload.spacing)) : false;
            const strokeChanged = prevLayer ? (Number(prevLayer.strokeWidth || 2.5) !== Number(payload.strokeWidth)) : false;
            const uomChanged = prevLayer ? (String(prevLayer.uom || '') !== String(payload.uom || '')) : true;
            const subtypeChanged = prevLayer ? (previousLayerType !== nextFormType && !typeFamilyChanged) : false;
            const visualChanged = prevLayer ? (
                String(prevLayer.color || '').toLowerCase() !== String(payload.color || '').toLowerCase() ||
                takeoffDisplaySymbol(prevLayer.symbol) !== takeoffDisplaySymbol(payload.symbol) ||
                takeoffDisplaySize(prevLayer.size) !== takeoffDisplaySize(payload.size) ||
                strokeChanged
            ) : true;
            const catalogChanged = Boolean(takeoffState.pendingCatalogItem && takeoffState.pendingCatalogItem._fromCatalogPicker === true);
            const formulaChanged = typeFamilyChanged || subtypeChanged || multChanged || dropChanged || spacingChanged || uomChanged;
            const metadataOnly = Boolean(editingLayerId && !typeFamilyChanged && !subtypeChanged && !visualChanged && !formulaChanged);
            const needsEstimatingSync = Boolean(!editingLayerId || typeFamilyChanged || formulaChanged || catalogChanged || nameChanged || diffChanged);

            if (editingLayerId) {
                const layer = findLayer(editingLayerId);
                if (layer) {
                    if (typeFamilyChanged) {
                        clearLayerCachedStateOnTypeChange(layer);
                    }
                    const prevCostCode = layer.costCode || '';
                    Object.assign(layer, payload);
                    layer.tag = payload.tag;
                    layer.costCode = prevCostCode || layer.catalogNumber || '';
                    if (!layer.metadata_json || typeof layer.metadata_json !== 'object') layer.metadata_json = {};
                    layer.metadata_json.tag = payload.tag;
                    if (payload.unitCost !== undefined) layer.unitCost = payload.unitCost;
                    if (payload.laborHours !== undefined) layer.laborHours = payload.laborHours;
                    if (payload.difficulty !== undefined) {
                        layer.difficulty = payload.difficulty;
                        layer.metadata_json.difficulty = payload.difficulty;
                    }
                    if (payload.multiplier !== undefined) {
                        layer.multiplier = payload.multiplier;
                        layer.metadata_json.multiplier = payload.multiplier;
                    }
                }
                callEditor('projectTakeoffUpdateLayerObjects', editingLayerId, {
                    name: payload.name,
                    tag: payload.tag,
                    difficulty: payload.difficulty,
                    type: payload.type,
                    uom: payload.uom,
                    purgeIncompatibleGeometry: typeFamilyChanged,
                    symbol: payload.symbol,
                    color: payload.color,
                    symbolSize: calcRadius,
                    diameter: markerDiameter,
                    strokeWidth: payload.strokeWidth,
                    multiplier: payload.multiplier,
                    dropLength: payload.dropLength,
                    spacing: payload.spacing,
                    metadataOnly
                });
                const shouldReactivateTool = typeFamilyChanged && takeoffState.activeLayerId === editingLayerId;
                if (typeFamilyChanged || takeoffState.activeLayerId === editingLayerId) {
                    setActiveTakeoffLayer(editingLayerId, shouldReactivateTool);
                }
                const updatedLayer = findLayer(editingLayerId);
                if (updatedLayer) refreshTakeoffLayerRowDom(updatedLayer);
            } else {
                const group = findGroup(takeoffState.pendingLayerGroupId);
                const layer = {
                    id: makeId('layer'),
                    groupId: group.id,
                    estimateId: activeEstimateId(),
                    quantity: 0,
                    tag: payload.tag,
                    costCode: payload.catalogNumber || '',
                    metadata_json: { tag: payload.tag, difficulty: payload.difficulty || 1.0, multiplier: payload.multiplier ?? 1 },
                    difficulty: payload.difficulty || 1.0,
                    ...payload
                };
                savedLayerId = layer.id;
                group.layers.push(layer);
                group.isExpanded = true;
                takeoffState.activeGroupId = group.id;
                setActiveTakeoffLayer(layer.id, false);
            }
            invalidateTakeoffSheetSummary();
            if (!editingLayerId || typeFamilyChanged || catalogChanged) {
                syncAllLayersToCanvas({ immediate: true, suppressEstimatingSync: true }); // Modal Save is a durable operation
            }
            if (!editingLayerId || typeFamilyChanged || formulaChanged || catalogChanged) {
                const liveSnap = callEditor('projectTakeoffSnapshot');
                if (liveSnap && Array.isArray(liveSnap.layers)) {
                    syncTakeoffFromCanvasSnapshot(liveSnap, { suppressEstimatingSync: !typeFamilyChanged, immediateEstimatingSync: typeFamilyChanged });
                }
            }
            // Commit the parent workspace immediately. Waiting for the iframe
            // request before this point made the first Close/Enter appear to
            // retain the previous title and allowed another close to win the race.
            saveTakeoffState({ skipEstimatingSync: true });
            // Cancel any pending live debounce since Save commits durably now.
            if (layerModalLiveBackendTimer) {
                clearTimeout(layerModalLiveBackendTimer);
                layerModalLiveBackendTimer = null;
            }
            layerModalNeedsBackendSave = false;
            // Modal Save is a durable operation, not merely a request for the
            // editor's delayed autosave. Waiting for this ACK prevents a quick
            // close/reload from restoring the duplicate's previous appearance.
            const saved = callEditor('projectTakeoffSave');
            if (!saved || typeof saved.then !== 'function') {
                throw new Error('Takeoff persistence is not available.');
            }
            await saved;
            closeLayerModal();
            if (needsEstimatingSync) {
                saveTakeoffState({
                    debounceEstimatingSync: !typeFamilyChanged && !catalogChanged,
                    suppressDirty: true
                });
            }
            const savedLayer = findLayer(savedLayerId);
            if (editingLayerId && savedLayer && !catalogChanged && !typeFamilyChanged && !tagChanged) {
                refreshTakeoffLayerRowDom(savedLayer);
            } else {
                renderTakeoffPanel();
            }
            window.dispatchEvent(new CustomEvent('takeoff:layer-visuals-updated', { detail: { projectId: String(window.ProjectState?.projectId || '') } }));
            window.dispatchEvent(new CustomEvent('takeoff:layer-properties-updated', { detail: { layerId: savedLayerId, difficulty: payload.difficulty, multiplier: payload.multiplier } }));
            return true;
        } catch (error) {
            console.warn('Takeoff layer save failed', error);
            showPrepared('Unable to save Takeoff item changes. Please try again.');
            return false;
        } finally {
            const drawerSaveBtn = $('layerDrawerSaveBtn');
            if (drawerSaveBtn) {
                drawerSaveBtn.disabled = false;
                drawerSaveBtn.innerHTML = '<i class="fas fa-xmark"></i> Close';
            }
            if (submit) {
                submit.dataset.saving = '0';
                submit.disabled = !$('layerNameInput')?.value.trim();
                submit.textContent = editingLayerId ? 'Save' : 'Create';
            }
        }
    }


        function getActiveFormType() {
            return layerModalActiveFormType;
        }

        function setActiveFormType(type) {
            layerModalActiveFormType = type || 'Count';
            return layerModalActiveFormType;
        }

        return Object.freeze({
            ensure, commit, open: openLayerModal, close: closeLayerModal,
            reposition: repositionLayerModal, setColor: setLayerColor,
            getActiveFormType, setActiveFormType, switchTab: switchLayerModalTab,
            updateTypeIcon: updateLayerTypeIcon, updateTypeFields: updateLayerTypeFields,
            updateStrokePreview: updateLayerStrokePreview,
            updateColorSwatch: updateLayerColorSwatch,
            updateAssociatedCatalogCard, updateDrawingsList: updateLayerDrawingsList,
            updateSubmitState: updateLayerSubmitState,
            patchLayerQuantity: patchTakeoffLayerRowQuantityDom,
            patchAllQuantities: patchAllTakeoffLayerQuantityDom,
            refreshLayerRow: refreshTakeoffLayerRowDom,
            flushAutoSave: flushActiveLayerModalSave, submit: submitLayerModal
        });
    }

    return Object.freeze({ create });
});

