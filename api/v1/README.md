# API v1 (authenticated application session)

Requests use the same secure PHP session as the web application. Anonymous
requests receive `401`; authenticated viewers may use read routes; mutations
require the `admin` role and otherwise receive `403`.

## Endpoints
- `GET /api/v1/health`
- `GET /api/v1/projects`
- `GET /api/v1/projects/{id}`
- `GET /api/v1/projects/{id}/export`
- `POST /api/v1/projects`
- `PATCH /api/v1/projects/{id}`
- `POST /api/v1/projects/{id}/assign` (admin only)
- `GET /api/v1/projects/{id}/folders`
- `POST /api/v1/files`
- `GET /api/v1/directory`

Machine-to-machine access is not enabled by this entry point. Do not add
shared client secrets to the repository; use a separately reviewed service
authentication boundary if that capability is required.
