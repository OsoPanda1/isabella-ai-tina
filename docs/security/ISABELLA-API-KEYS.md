# Isabella API Keys — Security Contract

## Credential format

New keys are issued as:

```text
isk_<environment>_<identifier>_<secret>
```

Examples:

```text
isk_live_<example><secret>
isk_stage_01f3a9b7c2d1_<secret>
isk_test_<example><secret>
```

The complete credential is returned **only once**, at creation or rotation.
The database stores only a versioned KDF hash (`v7.<salt>.<derived-key>`), never the plaintext secret.

## Required server secret

Production must configure:

```env
API_KEY_HASH_SECRET=<random secret of at least 16 characters>
```

For a stronger deployment value, generate it with PowerShell:

```powershell
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
$secret = [Convert]::ToBase64String($bytes).Replace('+','-').Replace('/','_').Replace('=','')
Write-Host $secret
```

Store the result in the production secret manager. Do not commit it.

## Management authorization

API key management requires both:

```text
system:admin
+
 isabella:api-keys:manage
```

The tenant and owner are derived from the authenticated `PrincipalContext`; clients cannot supply `tenantId` or `ownerId` to create credentials for another tenant.

`governance_admin` cannot mint a `SovereignOwner` API key. Only a `SovereignOwner` can issue that role.

## API

### List

```http
GET /api/v1/api-keys
```

Returns metadata only. `key_hash` and plaintext secrets are never exposed.

### Create

```http
POST /api/v1/api-keys
Content-Type: application/json
X-Isabella-API-Key: <management-key>
```

```json
{
  "name": "production-agent",
  "role": "Operator",
  "scopes": [
    "isabella:chat",
    "memory:read:own"
  ],
  "expiresInSeconds": 2592000
}
```

The response contains the complete `isk_...` credential once.

### Rotate

```http
POST /api/v1/api-keys/rotate
Content-Type: application/json
X-Isabella-API-Key: <management-key>
```

```json
{
  "keyId": "<uuid>"
}
```

Rotation revokes the previous key and returns one new secret.

### Revoke

```http
DELETE /api/v1/api-keys?keyId=<uuid>
X-Isabella-API-Key: <management-key>
```

## Verification pipeline

```text
request
  -> X-Isabella-API-Key
  -> parse prefix
  -> indexed prefix lookup
  -> KDF verification
  -> status check
  -> expiry check
  -> tenant resolution
  -> RBAC/CROWN authorization
  -> scope authorization
  -> audit
  -> handler
```

## PowerShell: generate a bootstrap key

The application should normally issue keys through the authenticated endpoint. If a bootstrap credential is needed before the application has an administrative session, generate the secret locally with PowerShell and use the application's provisioning path; do not insert plaintext credentials directly into PostgreSQL.

```powershell
$bytes = New-Object byte[] 48
[System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
$secret = [Convert]::ToBase64String($bytes).Replace('+','-').Replace('/','_').Replace('=','')
$identifier = (Get-Date -Format 'yyyyMMddHHmmss') + '_' + ([guid]::NewGuid().ToString('N').Substring(0,12))
$apiKey = "isk_live_${identifier}_${secret}"
Write-Host $apiKey
```

That command creates a credential-shaped value for bootstrap tooling; the production API key registry must still persist only a KDF hash and metadata. Do not manually place the plaintext key in the database.

## Rotation and revocation rules

- Default TTL: 30 days.
- Maximum TTL: 365 days.
- Expired credentials fail closed.
- Revoked credentials fail closed.
- Rotation revokes the predecessor.
- The full secret is never returned by list endpoints.
- Audit events include key ID and prefix, never the secret or hash.
