/**
 * assets/editor/ol-ruler.js
 * Herramienta de medición y calibración para el editor OpenLayers
 * Versión mejorada: Comportamiento tipo CAD (Grips en extremos, arrastre de cuerpo).
 */

class OlRuler {
    /**
     * @param {ol.Map} map - Instancia del mapa OpenLayers
     * @param {ol.source.Vector} vectorSource - Source donde se dibujarán las medidas
     */
    constructor(map, vectorSource) {
        this.map = map;
        this.source = vectorSource;
        
        // Configuración de calibración por defecto
        this.pixelsPerUnit = 1; 
        this.unit = 'ft';       
        
        this.drawInteraction = null;
        this.modifyInteraction = null;
        this.translateInteraction = null;
        
        this.sketch = null;
        this.measureTooltipElement = null;
        this.measureTooltip = null;

        // Estilo de la regla (Línea amarilla discontinua)
        this.rulerStyle = new ol.style.Style({
            stroke: new ol.style.Stroke({
                color: '#ffcc33',
                width: 3,
                lineDash: [10, 10]
            }),
            image: new ol.style.Circle({
                radius: 6,
                fill: new ol.style.Fill({ color: '#ffcc33' }),
                stroke: new ol.style.Stroke({ color: '#000', width: 1 })
            })
        });
    }

    /**
     * Establece los valores de calibración
     * @param {number} pixelsPerUnit - Cuántos píxeles equivalen a 1 unidad real
     * @param {string} unit - Unidad de medida (ej. 'ft', 'm')
     */
    setCalibration(pixelsPerUnit, unit) {
        if (pixelsPerUnit > 0) this.pixelsPerUnit = pixelsPerUnit;
        if (unit) this.unit = unit;
        this.updateAllLabels();
    }

    /**
     * Activa la herramienta de medición
     */
    activate() {
        this.deactivate();
        
        // 1. MODIFY: Para editar vértices existentes (Grips)
        this.modifyInteraction = new ol.interaction.Modify({
            source: this.source,
            pixelTolerance: 20,
            deleteCondition: ol.events.condition.never,
            insertVertexCondition: ol.events.condition.never, // Evita crear nuevos puntos
            style: new ol.style.Style({
                image: new ol.style.Circle({
                    radius: 8,
                    fill: new ol.style.Fill({ color: '#ffffff' }),
                    stroke: new ol.style.Stroke({ color: '#ffcc33', width: 2 })
                })
            })
        });

        // 2. TRANSLATE: Para mover la regla completa
        this.translateInteraction = new ol.interaction.Translate({
            layers: this.getLayer() ? [this.getLayer()] : undefined,
            hitTolerance: 5
        });

        // 3. DRAW: Para crear nuevas reglas
        this.drawInteraction = new ol.interaction.Draw({
            source: this.source,
            type: 'LineString',
            maxPoints: 2, // Solo líneas rectas de 2 puntos
            style: this.rulerStyle,
            stopClick: true, // Evita propagación
            // CRÍTICO: No iniciar dibujo si estamos sobre una feature existente (para permitir Modify/Translate)
            condition: (e) => {
                const pixel = e.pixel;
                const feature = this.map.forEachFeatureAtPixel(pixel, x => x, {
                    layerFilter: (l) => l.getSource() === this.source,
                    hitTolerance: 20 // Igualar a Modify para evitar conflictos en vértices
                });
                return !feature; 
            }
        });

        // El orden de adición define la pila (último agregado = primero en recibir evento)
        // Queremos: Draw (si no hay nada) -> Modify (si es vértice) -> Translate (si es cuerpo)
        // Por tanto, agregamos en orden inverso a la prioridad deseada:
        this.map.addInteraction(this.translateInteraction);
        this.map.addInteraction(this.modifyInteraction);
        this.map.addInteraction(this.drawInteraction);

        this.createMeasureTooltip();

        // --- EVENTOS DRAW ---
        this.drawInteraction.on('drawstart', (evt) => {
            this.sketch = evt.feature;
            this.sketch.set('isRuler', true);
            
            // Vincular tooltip a la feature
            this.sketch.set('tooltipElement', this.measureTooltipElement);
            this.sketch.set('tooltipOverlay', this.measureTooltip);

            // Escuchar cambios en la geometría mientras se dibuja
            this.sketch.getGeometry().on('change', () => {
                this.updateLabel(this.sketch);
            });
        });

        this.drawInteraction.on('drawend', (evt) => {
            const feature = evt.feature;
            const el = feature.get('tooltipElement');
            if(el) {
                el.className = 'ol-tooltip ol-tooltip-static';
                feature.get('tooltipOverlay').setOffset([0, -7]);
            }
            
            this.sketch = null;
            this.measureTooltipElement = null;
            this.createMeasureTooltip();
        });

        // --- EVENTOS MODIFY (Actualización fluida) ---
        this.modifyInteraction.on('modifying', (evt) => {
             evt.features.forEach(f => this.updateLabel(f));
        });
        this.modifyInteraction.on('modifyend', (evt) => {
            evt.features.forEach(f => this.updateLabel(f));
        });

        // --- EVENTOS TRANSLATE ---
        this.translateInteraction.on('translating', (evt) => {
            evt.features.forEach(f => this.updateLabel(f));
        });
    }

    deactivate() {
        if (this.drawInteraction) this.map.removeInteraction(this.drawInteraction);
        if (this.modifyInteraction) this.map.removeInteraction(this.modifyInteraction);
        if (this.translateInteraction) this.map.removeInteraction(this.translateInteraction);
        
        this.drawInteraction = null;
        this.modifyInteraction = null;
        this.translateInteraction = null;
        
        // Limpiar tooltip flotante si quedó colgado
        if (this.measureTooltipElement && this.measureTooltipElement.parentNode) {
            this.measureTooltipElement.parentNode.removeChild(this.measureTooltipElement);
        }
        if (this.measureTooltip) {
            this.map.removeOverlay(this.measureTooltip);
        }
    }

    createMeasureTooltip() {
        if (this.measureTooltipElement) {
            this.measureTooltipElement.parentNode.removeChild(this.measureTooltipElement);
        }
        this.measureTooltipElement = document.createElement('div');
        this.measureTooltipElement.className = 'ol-tooltip ol-tooltip-measure';
        this.measureTooltip = new ol.Overlay({
            element: this.measureTooltipElement,
            offset: [0, -15],
            positioning: 'bottom-center',
            stopEvent: false
        });
        this.map.addOverlay(this.measureTooltip);
    }

    updateLabel(feature) {
        const geom = feature.getGeometry();
        const tooltip = feature.get('tooltipOverlay');
        const element = feature.get('tooltipElement');
        
        if (!tooltip || !element || !geom) return;

        const lengthPixels = geom.getLength();
        const lengthReal = (lengthPixels / this.pixelsPerUnit).toFixed(2);
        const output = `${lengthReal} ${this.unit}`;
        
        element.innerHTML = output;
        
        // Centrar etiqueta
        const flatCoords = geom.getFlatCoordinates();
        if(flatCoords.length >= 4) {
            const midX = (flatCoords[0] + flatCoords[2]) / 2;
            const midY = (flatCoords[1] + flatCoords[3]) / 2;
            tooltip.setPosition([midX, midY]);
        } else {
            tooltip.setPosition(geom.getLastCoordinate());
        }
    }

    updateAllLabels() {
        this.source.getFeatures().forEach(f => {
            if(f.get('isRuler')) this.updateLabel(f);
        });
    }

    restoreTooltips() {
        this.source.getFeatures().forEach(feature => {
            if (feature.get('isRuler') && !feature.get('tooltipOverlay')) {
                const el = document.createElement('div');
                el.className = 'ol-tooltip ol-tooltip-static';
                const overlay = new ol.Overlay({
                    element: el,
                    offset: [0, -7],
                    positioning: 'bottom-center',
                    stopEvent: false
                });
                this.map.addOverlay(overlay);
                
                feature.set('tooltipOverlay', overlay);
                feature.set('tooltipElement', el);
                
                // Reactivar listener de cambios
                feature.getGeometry().on('change', () => this.updateLabel(feature));
                this.updateLabel(feature);
            }
        });
    }

    getLayer() {
        let found = null;
        this.map.getLayers().forEach(layer => {
            if(layer.getSource && layer.getSource() === this.source) found = layer;
        });
        return found;
    }
}