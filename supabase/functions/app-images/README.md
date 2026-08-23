# `app-images` Edge Function contract

`app-images` is the single private-image backend used by the generic n8n upload
workflow. Callers choose a logical destination from the policy registry; they
never provide a bucket or storage path.

## Request

Send `POST` JSON with these fields for every action:

```json
{
  "action": "upload | lookup | delete",
  "idToken": "<Firebase ID token>",
  "category": "employee-profile",
  "ownerType": "employee",
  "ownerId": "employee_42",
  "assetId": "profile",
  "variant": "thumbnail"
}
```

`action` defaults to `upload`. Upload also requires `fileBase64` (or the legacy
alias `imageBase64`); `originalName` is optional. Raw Base64 requires
`mimeType`. A data URL may supply the MIME type itself and, when `mimeType` is
also present, both values must match.

| category | ownerType | variants | maximum decoded bytes |
| --- | --- | --- | ---: |
| `employee-profile` | `employee` | `thumbnail`, `original` | 5 MiB |
| `worksite-photo` | `worksite` | `thumbnail`, `original` | 10 MiB |
| `company-image` | `company` | `thumbnail`, `original`, `logo` | 10 MiB |

Identifiers are 1-80 ASCII letters, digits, `_`, or `-`, must start with a
letter or digit, and cannot contain path separators. Images are limited to
JPEG, PNG, or WebP with matching file signatures.

## Responses

- Upload: `{ "ok": true, "upserted": true, "asset": { ... }, "cleanupPending": false }`
- Lookup: `{ "ok": true, "asset": { ... }, "signedUrl": "...", "expiresIn": 600 }`
- Delete found: `{ "ok": true, "deleted": true, "asset": { ... }, "cleanupPending": false }`
- Delete not found: `{ "ok": true, "deleted": false, "asset": null, "cleanupPending": false }`
- Delete storage retry: HTTP 503 `{ "ok": false, "error": "STORAGE_DELETE_FAILED", "retryable": true, "cleanupPending": true }`
- Delete race: HTTP 409 `{ "ok": false, "error": "IMAGE_VERSION_CONFLICT", "retryable": true }`

The asset object contains logical coordinates, MIME type, size, original name,
and timestamps. It never exposes the private bucket or object path. Each upload
uses a unique physical version. A serialized metadata swap makes that pointer
authoritative for lookup, then the superseded version is removed best-effort.
`cleanupPending` reports whether an unreferenced object still needs cleanup.
Delete removes exactly the observed physical version first while keeping its
metadata pointer retryable. It then compare-and-swap deletes that exact
pointer. A concurrent replacement changes the pointer, so the CAS preserves
the newer version; a Storage failure leaves the old pointer available for a
later retry instead of publishing a false completed deletion.

The n8n webhook is the browser-facing boundary. Direct browser preflight is
allowed only for origins configured in the `APP_IMAGES_ALLOWED_ORIGINS` Edge
Function secret; server-to-server n8n calls do not send an Origin header.
