# Requerimientos y Novedades: Catálogo, Exportación/Importación Excel y Assemblies 2027

Este documento detalla los requisitos del sistema, dependencias y pasos necesarios para desplegar y operar las nuevas funcionalidades implementadas en el módulo de **Cost Catalog** y **Assemblies** de Brightronix Takeoff.

---

## 1. Requerimientos del Servidor / Entorno PHP

Para que la generación, lectura y exportación de archivos Excel (`.xlsx`) funcione correctamente en el servidor:

### A. Versión de PHP
- **PHP 8.1 o superior** (probado y verificado en PHP 8.2.12).

### B. Extensiones de PHP Requeridas
Asegurarse de que las siguientes extensiones estén habilitadas en el archivo `php.ini`:
- `extension=zip` *(Indispensable para descomprimir y generar archivos OpenXML .xlsx)*
- `extension=gd` *(Requerido por PhpSpreadsheet para cálculo de dimensiones de celda)*
- `extension=pdo_mysql`
- `extension=mbstring`

### C. Gestor de Paquetes
- **Composer**: Necesario en el servidor o entorno local para descargar las librerías de terceros especificadas en `composer.json`.

---

## 2. Instalación de Dependencias

Al clonar o actualizar el repositorio en un nuevo entorno o servidor:

```bash
composer install --no-dev --optimize-autoloader
```

Esto instalará:
- `phpoffice/phpspreadsheet: ^2.3` y sus dependencias correspondientes dentro de la carpeta `vendor/`.

---

## 3. Nuevos Componentes del Sistema

### A. API de Importación, Exportación y Plantillas
- **Archivo**: `api/catalog_io.php`
- **Funcionalidades**:
  - `GET ?action=template&type=items`: Genera y descarga la plantilla Excel vacía con las columnas requeridas para ítems regulares.
  - `GET ?action=template&type=assemblies`: Genera y descarga la plantilla Excel para assemblies (incluye columnas para piezas hijas, cantidades y tipo de cálculo).
  - `GET ?action=export&catalog_id={id}&type={items|assemblies}&group_id={all|id}`: Exporta los datos actuales del catálogo en archivos `.xlsx` estilizados y auto-ajustados.
  - `POST ?action=import`: Procesa archivos `.xlsx` cargados por el usuario, detecta encabezados e inserta/actualiza ítems y relaciones de assemblies.

### B. Script de Inicialización de Assemblies 2027
- **Archivo**: `db/seed_assemblies_2027.php`
- **Uso en consola**:
  ```bash
  php db/seed_assemblies_2027.php
  ```
- **Descripción**: Genera automáticamente 372 assemblies y vincula 2,298 piezas componentes distribuidos en:
  - *Assemblies EMT* (combinaciones con pull string y cables #12 a #6).
  - *Assemblies PVC* (Schedule 40 y Schedule 80).
  - *Assemblies Feeders* (conduits EMT, PVC 40 y PVC 80 para Cobre y Aluminio con cálculo de ground NEC).
  - *Assemblies Rough In* (cajas, interruptores, receptáculos Duplex, GFCI, Quad, WP y variantes Medical MC).
  - *Assemblies Low Voltage, Controls, Fire Alarm y Temporary Power*.

### C. Mejoras en la Interfaz de Usuario (UI/UX)
- **Archivos**: `pages/cost_catalog.php`, `assets/cost_catalog.js`, `assets/cost_catalog.css`
- **Novedades**:
  - Botón de 3 puntos (`...`) en el subheader del Cost Catalog para acceso rápido a Exportar, Importar y Descargar Plantillas.
  - Modal interactivo con selector de tarjetas estilizadas (`.bb-mode-card`, `.bb-studio-card`) idéntico al flujo de *Create New Project*.
  - Descargas programáticas directas sin navegación (`triggerDownload`).
  - Soporte nativo para modo claro y modo oscuro.
