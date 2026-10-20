<?php
declare(strict_types=1);

return [
    ['GET',   '/api/v1/health',               'ProjectsController@health',    'read'],
    ['GET',   '/api/v1/projects',             'ProjectsController@index',     'read'],
    ['GET',   '/api/v1/projects/{id}',        'ProjectsController@show',      'read'],
    ['GET',   '/api/v1/projects/{id}/export', 'ProjectsController@export',    'read'],
    ['POST',  '/api/v1/projects',             'ProjectsController@store',     'mutation'],
    ['PATCH', '/api/v1/projects/{id}',        'ProjectsController@update',    'mutation'],
    ['POST',  '/api/v1/projects/{id}/assign', 'DirectoryController@assign',   'mutation'],
    ['GET',   '/api/v1/projects/{id}/folders','FoldersController@index',      'read'],
    ['POST',  '/api/v1/files',                'FilesController@store',        'mutation'],
    ['GET',   '/api/v1/directory',            'DirectoryController@index',    'read'],
];
