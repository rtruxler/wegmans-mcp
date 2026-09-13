# Deploying `wegmans-mcp` to Google Cloud

This guide is written for a **personal, single-user deployment** in your own Google Cloud project. The goal is to run the same Wegmans integration in two modes:

1. **Remote MCP over HTTPS** for Claude-compatible MCP clients that support remote servers.
2. **HTTPS REST API + OpenAPI** for ChatGPT Actions or other clients that prefer a normal web API.

The deployment model assumes your Wegmans account is the only account using this service. Your Wegmans refresh token is therefore stored server-side in Google Secret Manager rather than in source control.

> This project is unofficial and reverse-engineered from the Wegmans web application. Private Wegmans endpoints can change without notice.

---

## 1. Recommended Google Cloud architecture

Use:

- **Cloud Run** — hosts the API/MCP service
- **Secret Manager** — stores Wegmans refresh token and API key
- **Artifact Registry** — stores the container image
- **Cloud Build** or local Docker build — builds the image
- Optional: **Cloud Scheduler** only if you later decide you need periodic health checks

Suggested resources:

```text
Google Cloud project
  |
  +-- Artifact Registry
  |     `-- wegmans-mcp image
  |
  +-- Secret Manager
  |     +-- wegmans-refresh-token
  |     `-- wegmans-api-key
  |
  `-- Cloud Run
        `-- wegmans-mcp
              +-- /health
              +-- /mcp                 remote MCP transport
              +-- /api/products/search
              +-- /api/products/:id
              +-- /api/list
              +-- /api/list/items
              +-- /api/purchase-history
              `-- /openapi.yaml
```

For a personal deployment, keep Cloud Run publicly reachable **only at the network level** and require an application-level API key for all useful endpoints. That makes it usable from Claude/ChatGPT while keeping arbitrary callers out.

---

## 2. Prerequisites

Install and authenticate the Google Cloud CLI:

```bash
gcloud auth login
gcloud auth application-default login
```

Set the project:

```bash
gcloud config set project YOUR_PROJECT_ID
```

Choose a region, for example:

```bash
export REGION=us-east1
```

Enable the required APIs:

```bash
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com
```

---

## 3. Clone and build the project

```bash
git clone https://github.com/rtruxler/wegmans-mcp.git
cd wegmans-mcp
npm install
npm run build
npm test
```

Before deploying, verify the local MCP server still starts:

```bash
npm start
```

If the repository has not yet been extended with the HTTP server described below, add that first. The core Wegmans logic in `src/client.ts` and `src/auth.ts` should be shared by both transports.

---

## 4. Required application changes for Cloud Run

The original MCP implementation is a local stdio server. Cloud Run cannot expose stdio to Claude or ChatGPT, so deployment requires an HTTP entrypoint.

The deployed service should expose both:

```text
/mcp
```

for remote MCP, and:

```text
/api/...
```

for REST/OpenAPI clients.

The HTTP process must bind to:

```text
0.0.0.0:$PORT
```

where Cloud Run supplies `PORT` automatically.

Suggested source layout:

```text
src/
  auth.ts
  client.ts
  config.ts
  types.ts
  server.ts           # existing stdio MCP server
  http-server.ts      # Cloud Run entrypoint
  mcp-http.ts         # remote MCP transport/router
  api.ts              # REST routes
  openapi.ts          # or serve a checked-in openapi.yaml
```

Do not duplicate Wegmans business logic in the HTTP layer. Routes and MCP tools should call the same `WegmansClient` methods.

---

## 5. Authentication model for the deployed service

There are **two independent authentication layers**.

### Layer A: Caller → your Cloud Run service

Use your own private API key.

Require this header for `/mcp` and `/api/*`:

```http
Authorization: Bearer <WEGMANS_SERVICE_API_KEY>
```

Do not reuse the Wegmans token for this purpose.

Generate a strong API key:

```bash
openssl rand -hex 32
```

### Layer B: Cloud Run → Wegmans

The service uses the Wegmans Azure AD B2C refresh token to obtain one-hour bearer access tokens.

The refresh token rotates. Every successful token refresh can return a new `refresh_token`, and the application must persist the replacement atomically.

This is the main state-management issue when running on Cloud Run.

---

## 6. Important: refresh-token rotation on Cloud Run

The current local implementation persists the rotated token to a local file such as:

```text
~/.config/wegmans-mcp/tokens.json
```

That is **not sufficient on Cloud Run** because container filesystems are ephemeral and multiple instances can exist.

For Cloud Run, change token persistence to use **Google Secret Manager**.

Recommended design:

```text
Secret: wegmans-refresh-token

getAccessToken()
  |
  +-- read latest refresh token from Secret Manager
  +-- POST Wegmans /oauth2/v2.0/token
  +-- receive access_token + rotated refresh_token
  +-- write a new Secret Manager version containing rotated token
  `-- cache access token in memory until near expiry
```

Do **not** bind the refresh token into Cloud Run as a static environment variable if the application is expected to rotate it. Environment-variable secret values are resolved for an instance and do not automatically change when a new secret version is created.

Instead, have the application call the Secret Manager API at runtime.

For a personal service, set Cloud Run to a maximum of **1 instance** initially. This avoids concurrent refresh attempts racing with rotating tokens:

```bash
--max-instances=1
```

You can make the refresh logic concurrency-safe later if you need multiple instances.

---

## 7. Create the secrets

Create the initial Wegmans refresh-token secret:

```bash
printf '%s' 'PASTE_CURRENT_WEGMANS_REFRESH_TOKEN' | \
  gcloud secrets create wegmans-refresh-token --data-file=-
```

If the secret already exists:

```bash
printf '%s' 'PASTE_CURRENT_WEGMANS_REFRESH_TOKEN' | \
  gcloud secrets versions add wegmans-refresh-token --data-file=-
```

Create a separate API key for callers:

```bash
export SERVICE_API_KEY="$(openssl rand -hex 32)"
printf '%s' "$SERVICE_API_KEY" | \
  gcloud secrets create wegmans-api-key --data-file=-
```

Save the generated API key in your password manager. Claude or ChatGPT will need it later.

Never commit either secret to GitHub.

---

## 8. Service account permissions

Create a dedicated runtime service account:

```bash
gcloud iam service-accounts create wegmans-mcp \
  --display-name="Wegmans MCP"
```

Set:

```bash
export SERVICE_ACCOUNT="wegmans-mcp@${GOOGLE_CLOUD_PROJECT}.iam.gserviceaccount.com"
```

If `GOOGLE_CLOUD_PROJECT` is not populated:

```bash
export GOOGLE_CLOUD_PROJECT="$(gcloud config get-value project)"
export SERVICE_ACCOUNT="wegmans-mcp@${GOOGLE_CLOUD_PROJECT}.iam.gserviceaccount.com"
```

Allow the service to read and write secret versions as required by the implementation.

At minimum, it needs read access to both secrets:

```bash
gcloud secrets add-iam-policy-binding wegmans-refresh-token \
  --member="serviceAccount:${SERVICE_ACCOUNT}" \
  --role="roles/secretmanager.secretAccessor"

gcloud secrets add-iam-policy-binding wegmans-api-key \
  --member="serviceAccount:${SERVICE_ACCOUNT}" \
  --role="roles/secretmanager.secretAccessor"
```

If the application itself creates new refresh-token secret versions, grant only the narrow Secret Manager role required to add versions. Avoid broad project-level Secret Manager administration roles.

Claude should verify the current least-privilege IAM role needed for `projects.secrets.addVersion` when implementing this step.

---

## 9. Containerize the service

Add a `Dockerfile` similar to:

```dockerfile
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY openapi.yaml ./openapi.yaml
CMD ["node", "dist/http-server.js"]
```

Add `.dockerignore`:

```text
node_modules
dist
.git
.env
*.har
*.log
```

Do not copy HAR files into the image. They may contain credentials and personal account data.

---

## 10. Build with Artifact Registry

Create a Docker repository:

```bash
gcloud artifacts repositories create wegmans \
  --repository-format=docker \
  --location="$REGION" \
  --description="Wegmans MCP images"
```

Set image name:

```bash
export IMAGE="${REGION}-docker.pkg.dev/${GOOGLE_CLOUD_PROJECT}/wegmans/wegmans-mcp:latest"
```

Build using Cloud Build:

```bash
gcloud builds submit --tag "$IMAGE"
```

---

## 11. Deploy to Cloud Run

Deploy:

```bash
gcloud run deploy wegmans-mcp \
  --image="$IMAGE" \
  --region="$REGION" \
  --platform=managed \
  --service-account="$SERVICE_ACCOUNT" \
  --allow-unauthenticated \
  --max-instances=1 \
  --min-instances=0 \
  --set-env-vars="WEGMANS_STORE_NUMBER=59,WEGMANS_STORE_KEY=59-BURLINGTON,WEGMANS_REFRESH_SECRET=wegmans-refresh-token,WEGMANS_API_KEY_SECRET=wegmans-api-key"
```

Why `--allow-unauthenticated`?

Claude and ChatGPT need to reach the HTTPS service without Google IAM credentials. Authentication is performed by the service using your own API-key header instead.

This does **not** mean the actual Wegmans operations should be unauthenticated. Every `/mcp` and `/api/*` call should require the API key.

Retrieve the service URL:

```bash
gcloud run services describe wegmans-mcp \
  --region="$REGION" \
  --format='value(status.url)'
```

Example:

```text
https://wegmans-mcp-xxxxxxxxxx-ue.a.run.app
```

---

## 12. Health check

Expose a public health endpoint that does not contain account information:

```text
GET /health
```

Expected response:

```json
{
  "ok": true
}
```

Test it:

```bash
curl https://YOUR_CLOUD_RUN_URL/health
```

Do not make the health endpoint call Wegmans or refresh tokens on every request.

---

## 13. Test the REST API

Assuming your API key is in `$SERVICE_API_KEY`:

```bash
export BASE_URL="https://YOUR_CLOUD_RUN_URL"
```

Search:

```bash
curl \
  -H "Authorization: Bearer $SERVICE_API_KEY" \
  "$BASE_URL/api/products/search?q=chobani%20flip"
```

Read shopping list:

```bash
curl \
  -H "Authorization: Bearer $SERVICE_API_KEY" \
  "$BASE_URL/api/list"
```

Add an item:

```bash
curl -X POST \
  -H "Authorization: Bearer $SERVICE_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"sku":"607380","quantity":1}' \
  "$BASE_URL/api/list/items"
```

Set quantity:

```bash
curl -X PATCH \
  -H "Authorization: Bearer $SERVICE_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"quantity":2}' \
  "$BASE_URL/api/list/items/607380"
```

Remove item:

```bash
curl -X DELETE \
  -H "Authorization: Bearer $SERVICE_API_KEY" \
  "$BASE_URL/api/list/items/607380"
```

Empty the list:

```bash
curl -X DELETE \
  -H "Authorization: Bearer $SERVICE_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"confirm":true}' \
  "$BASE_URL/api/list"
```

Keep the explicit confirmation requirement for destructive empty-list calls.

---

## 14. Remote MCP for Claude

The exact Claude configuration depends on which Claude client you use and Anthropic's currently supported remote-MCP transport.

The target should be your Cloud Run endpoint:

```text
https://YOUR_CLOUD_RUN_URL/mcp
```

and it should send:

```http
Authorization: Bearer <WEGMANS_SERVICE_API_KEY>
```

Do not point a remote Claude client at the local stdio entrypoint.

Keep the existing stdio server too, because it remains useful for local Claude Desktop / Claude Code configurations where stdio MCP is supported.

The result should be two entrypoints using the same tool implementation:

```text
node dist/server.js
    -> local stdio MCP

https://.../mcp
    -> hosted remote MCP
```

When Claude is performing the deployment, have it check Anthropic's current MCP transport documentation rather than assuming an older SSE vs Streamable HTTP configuration.

---

## 15. ChatGPT / OpenAPI endpoint

Serve an OpenAPI document from:

```text
GET /openapi.yaml
```

The schema should expose at minimum:

```text
GET    /api/products/search
GET    /api/products/{productId}
GET    /api/list
POST   /api/list/items
PATCH  /api/list/items/{sku}
DELETE /api/list/items/{sku}
DELETE /api/list
GET    /api/purchase-history
```

Every operation should have a stable, descriptive `operationId`, for example:

```text
searchWegmansProducts
getWegmansProduct
getWegmansShoppingList
addWegmansShoppingListItem
setWegmansShoppingListItemQuantity
removeWegmansShoppingListItem
emptyWegmansShoppingList
getWegmansPurchaseHistory
```

Configure the OpenAPI security scheme as HTTP bearer auth representing **your service API key**, not the Wegmans bearer token.

Example:

```yaml
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
security:
  - bearerAuth: []
```

The server translates authenticated API calls into Wegmans API calls using the server-side Wegmans credential.

---

## 16. Store selection

The current captured configuration uses:

```text
WEGMANS_STORE_NUMBER=59
WEGMANS_STORE_KEY=59-BURLINGTON
```

These values affect:

- Algolia search filters
- store-specific prices
- availability
- aisle/planogram information
- cart mutations

If you change stores, update both values together.

A later improvement could expose a `set_store` or `list_stores` function, but keeping a fixed store is simpler and safer for the personal deployment.

---

## 17. Operational considerations

### Token expiry

Access tokens last roughly one hour. The client should refresh shortly before expiry rather than waiting for every request to fail.

### Refresh-token expiry

Refresh tokens also expire. If the stored refresh token can no longer refresh, the service should fail with a clear error such as:

```text
Wegmans authentication expired. Re-bootstrap the refresh token from a new Wegmans browser login.
```

Then add the new token as a new Secret Manager version.

### `401` retry

Keep the existing behavior:

```text
API request
  -> 401
  -> force one token refresh
  -> retry request once
  -> if it fails again, return error
```

Never retry authentication indefinitely.

### Cart versioning

Wegmans cart mutations use a `cartVersion`. Always use the latest cart version. Do not reuse a stale version across multiple mutations unless the prior response supplied an updated one and the implementation explicitly tracks it.

### Concurrency

With `--max-instances=1`, Cloud Run still handles concurrent requests within an instance. Protect token refresh with an in-process mutex/promise so two requests do not attempt to rotate the same refresh token simultaneously.

Likewise, serialize cart writes or refetch the cart/version immediately before each mutation.

---

## 18. Logging rules

Never log:

- `Authorization` headers
- Wegmans access tokens
- Wegmans refresh tokens
- your service API key
- full token endpoint responses
- HAR payloads

Safe logging examples:

```text
refresh successful; access token expires in 3600s
shopping list fetched; items=14
added sku=607380 quantity=1
removed sku=607380
```

Consider redacting email addresses/customer IDs if Wegmans responses are ever logged during debugging.

---

## 19. Updating the deployment

After code changes:

```bash
gcloud builds submit --tag "$IMAGE"

gcloud run deploy wegmans-mcp \
  --image="$IMAGE" \
  --region="$REGION"
```

Cloud Run will create a new revision and move traffic to it.

---

## 20. Suggested deployment checklist for Claude

When handing this repository to Claude, ask it to complete and verify all of the following:

- [ ] Add an HTTP Cloud Run entrypoint if one does not exist.
- [ ] Preserve the local stdio MCP server.
- [ ] Add remote MCP transport at `/mcp` using the current MCP SDK's recommended HTTP transport.
- [ ] Add REST endpoints under `/api` backed by the same `WegmansClient` methods.
- [ ] Add `openapi.yaml` and serve it at `/openapi.yaml`.
- [ ] Add bearer API-key middleware for `/mcp` and `/api/*`.
- [ ] Do not protect `/health` with Wegmans authentication.
- [ ] Replace local refresh-token file persistence with Google Secret Manager when running in GCP.
- [ ] Atomically add a new Secret Manager version whenever Wegmans rotates the refresh token.
- [ ] Prevent simultaneous refresh-token rotations.
- [ ] Add `Dockerfile` and `.dockerignore`.
- [ ] Ensure the process binds to `0.0.0.0:$PORT`.
- [ ] Test `npm test` and `npm run build`.
- [ ] Test container startup locally.
- [ ] Deploy Cloud Run with `--max-instances=1` initially.
- [ ] Verify `/health`.
- [ ] Verify authenticated product search.
- [ ] Verify read-list.
- [ ] Verify add, quantity change, remove, and empty-list calls.
- [ ] Confirm no secrets appear in logs or Git history.

---

## 21. Minimal end state

A successful deployment should leave you with:

```text
Repository:
https://github.com/rtruxler/wegmans-mcp

Cloud Run:
https://YOUR_SERVICE.a.run.app

Remote MCP:
https://YOUR_SERVICE.a.run.app/mcp

OpenAPI:
https://YOUR_SERVICE.a.run.app/openapi.yaml

REST API:
https://YOUR_SERVICE.a.run.app/api/...
```

and two secrets stored only in Google Secret Manager:

```text
wegmans-refresh-token
wegmans-api-key
```

At that point the same backend can power Claude through MCP and ChatGPT-compatible API actions without maintaining two separate Wegmans implementations.
