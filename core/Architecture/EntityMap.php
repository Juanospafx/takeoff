<?php
declare(strict_types=1);

use Takeoff\Architecture\Entities;

return [
    'estimating' => [
        'table' => 'estimating',
        'entity' => Entities\Estimating::class,
        'belongs_to' => ['project', 'estimator'],
        'has_many' => ['bids', 'estimates'],
    ],
    'bid' => [
        'table' => 'bids',
        'entity' => Entities\Bid::class,
        'belongs_to' => ['project', 'estimating', 'bid_status', 'estimator'],
        'has_many' => ['proposals'],
    ],
    'bid_status' => [
        'table' => 'bid_statuses',
        'entity' => Entities\BidStatus::class,
        'has_many' => ['bids'],
    ],
    'estimator' => [
        'table' => 'estimators',
        'entity' => Entities\Estimator::class,
        'has_many' => ['projects', 'estimating', 'bids'],
    ],
    'project' => [
        'table' => 'projects',
        'entity' => Entities\Project::class,
        'belongs_to' => ['project_template', 'estimator'],
        'has_many' => ['estimating', 'bids', 'documents', 'drawings', 'takeoffs', 'estimates', 'proposals'],
    ],
    'project_template' => [
        'table' => 'project_templates',
        'entity' => Entities\ProjectTemplate::class,
        'has_many' => ['projects'],
    ],
    'catalog' => [
        'table' => 'catalogs',
        'entity' => Entities\Catalog::class,
        'has_many' => ['cost_catalogs', 'catalog_groups', 'catalog_items'],
    ],
    'cost_catalog' => [
        'table' => 'cost_catalogs',
        'entity' => Entities\CostCatalog::class,
        'belongs_to' => ['catalog'],
        'has_many' => ['catalog_items'],
    ],
    'catalog_group' => [
        'table' => 'catalog_groups',
        'entity' => Entities\CatalogGroup::class,
        'belongs_to' => ['catalog', 'parent_group'],
        'has_many' => ['catalog_items', 'child_groups'],
    ],
    'catalog_item' => [
        'table' => 'catalog_items',
        'entity' => Entities\CatalogItem::class,
        'belongs_to' => ['catalog', 'cost_catalog', 'catalog_group'],
        'has_many' => ['attributes', 'assembly_parts'],
    ],
    'catalog_item_attribute' => [
        'table' => 'catalog_item_attributes',
        'entity' => Entities\CatalogItemAttribute::class,
        'belongs_to' => ['catalog_item'],
    ],
    'assembly_part' => [
        'table' => 'assembly_parts',
        'entity' => Entities\AssemblyPart::class,
        'belongs_to' => ['assembly_catalog_item', 'part_catalog_item'],
    ],
    'document_folder' => [
        'table' => 'document_folders',
        'entity' => Entities\DocumentFolder::class,
        'belongs_to' => ['project', 'parent_folder'],
        'has_many' => ['documents', 'child_folders'],
    ],
    'project_document' => [
        'table' => 'project_documents',
        'entity' => Entities\ProjectDocument::class,
        'belongs_to' => ['project', 'document_folder'],
        'has_many' => ['drawings'],
    ],
    'drawing' => [
        'table' => 'drawings',
        'entity' => Entities\Drawing::class,
        'belongs_to' => ['project', 'project_document'],
        'has_many' => ['drawing_scales', 'takeoffs', 'takeoff_layers', 'takeoff_measurements'],
    ],
    'drawing_scale' => [
        'table' => 'drawing_scales',
        'entity' => Entities\DrawingScale::class,
        'belongs_to' => ['drawing'],
    ],
    'takeoff' => [
        'table' => 'takeoffs',
        'entity' => Entities\Takeoff::class,
        'belongs_to' => ['project', 'drawing', 'estimate'],
        'has_many' => ['layers', 'measurements'],
    ],
    'takeoff_layer' => [
        'table' => 'takeoff_layers',
        'entity' => Entities\TakeoffLayer::class,
        'belongs_to' => ['takeoff', 'drawing', 'catalog_item', 'assembly_catalog_item'],
        'has_many' => ['measurements'],
    ],
    'takeoff_measurement' => [
        'table' => 'takeoff_measurements',
        'entity' => Entities\TakeoffMeasurement::class,
        'belongs_to' => ['takeoff', 'takeoff_layer', 'drawing', 'drawing_scale', 'catalog_item', 'assembly_catalog_item'],
        'has_many' => ['tags', 'estimate_items'],
    ],
    'takeoff_tag' => [
        'table' => 'takeoff_tags',
        'entity' => Entities\TakeoffTag::class,
        'belongs_to' => ['project'],
        'has_many' => ['measurements'],
    ],
    'estimate' => [
        'table' => 'estimates',
        'entity' => Entities\Estimate::class,
        'belongs_to' => ['project', 'estimating', 'takeoff', 'bid'],
        'has_many' => ['items', 'markups', 'proposals'],
    ],
    'estimate_item' => [
        'table' => 'estimate_items',
        'entity' => Entities\EstimateItem::class,
        'belongs_to' => ['estimate', 'parent_estimate_item', 'takeoff_measurement', 'catalog_item', 'assembly_catalog_item'],
    ],
    'estimate_markup' => [
        'table' => 'estimate_markups',
        'entity' => Entities\EstimateMarkup::class,
        'belongs_to' => ['estimate'],
    ],
    'proposal' => [
        'table' => 'proposals',
        'entity' => Entities\Proposal::class,
        'belongs_to' => ['project', 'estimate', 'bid'],
    ],
];
