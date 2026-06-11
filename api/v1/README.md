# API v1 (HMAC)

## Auth headers
- `X-Client-Id`
- `X-Timestamp` (unix seconds)
- `X-Signature` (HMAC SHA256)

Signature payload format:
```
METHOD + "\n" + PATH + "\n" + TIMESTAMP + "\n" + RAW_BODY
```

Where:
- `METHOD` is `GET`, `POST`, `PATCH`, etc.
- `PATH` is the URI path only (example: `/api/v1/projects`)
- `TIMESTAMP` is unix seconds
- `RAW_BODY` is the exact raw body string (empty for GET)

If any header missing, timestamp out of range (>300s), or signature mismatch -> `401`.

## Pseudocode
```
payload = method + "\n" + path + "\n" + timestamp + "\n" + raw_body
signature = HMAC_SHA256(client_secret, payload)
```

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

## Node.js example (no dependencies)
```js
import crypto from "node:crypto";

const method = "POST";
const path = "/api/v1/projects";
const timestamp = Math.floor(Date.now() / 1000).toString();
const rawBody = JSON.stringify({ name: "Project A", description: "Demo" });

const secret = "supersecret...";
const payload = `${method}\n${path}\n${timestamp}\n${rawBody}`;

const signature = crypto
  .createHmac("sha256", secret)
  .update(payload)
  .digest("hex");

// Headers:
// X-Client-Id: crm
// X-Timestamp: timestamp
// X-Signature: signature
```

## Example request (curl)
```
curl -X POST http://your-host/api/v1/projects \
  -H "Content-Type: application/json" \
  -H "X-Client-Id: crm" \
  -H "X-Timestamp: 1700000000" \
  -H "X-Signature: <signature>" \
  -d '{"name":"Project A","description":"Demo"}'
```
