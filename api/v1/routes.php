<?php
declare(strict_types=1);

return [
    ['GET',  '/api/v1/health',                    'ProjectsController@health',    false],
    ['GET',  '/api/v1/projects',                  'ProjectsController@index',     true],
    ['GET',  '/api/v1/projects/{id}',             'ProjectsController@show',      true],
    ['GET',  '/api/v1/projects/{id}/export',      'ProjectsController@export',    true],
    ['POST', '/api/v1/projects',                  'ProjectsController@store',     true],
    ['PATCH','/api/v1/projects/{id}',             'ProjectsController@update',    true],
    ['POST', '/api/v1/projects/{id}/assign',      'DirectoryController@assign',   true],
    ['GET',  '/api/v1/projects/{id}/folders',     'FoldersController@index',      true],
    ['POST', '/api/v1/files',                     'FilesController@store',        true],
    ['GET',  '/api/v1/directory',                 'DirectoryController@index',    true],
];
