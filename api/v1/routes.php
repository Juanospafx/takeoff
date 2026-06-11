<?php
declare(strict_types=1);

return [
    ['GET',  '/api/v1/health',                    'ProjectsController@health',    false],
    ['GET',  '/api/v1/projects',                  'ProjectsController@index',     false],
    ['GET',  '/api/v1/projects/{id}',             'ProjectsController@show',      false],
    ['GET',  '/api/v1/projects/{id}/export',      'ProjectsController@export',    false],
    ['POST', '/api/v1/projects',                  'ProjectsController@store',     false],
    ['PATCH','/api/v1/projects/{id}',             'ProjectsController@update',    false],
    ['POST', '/api/v1/projects/{id}/assign',      'DirectoryController@assign',   false],
    ['GET',  '/api/v1/projects/{id}/folders',     'FoldersController@index',      false],
    ['POST', '/api/v1/files',                     'FilesController@store',        false],
    ['GET',  '/api/v1/directory',                 'DirectoryController@index',    false],
];
