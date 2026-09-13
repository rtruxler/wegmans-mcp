# wegmans-mcp

Unofficial Model Context Protocol (MCP) server for the Wegmans web application. It exposes product search plus authenticated shopping-list operations discovered from the browser network flow.

> **Unofficial / reverse-engineered.** This project is not affiliated with or endorsed by Wegmans. The private endpoints can change without notice. Use it only with an account you are authorized to access and in accordance with applicable terms.

## Supported tools

| Tool | Behavior |
|---|---|
| `search_products` | Search the configured Wegmans store via Wegmans' Algolia product index |
| `get_product` | Get live product details for one product/SKU |
| `get_shopping_list` | Read the current grocery list/cart |
| `add_to_shopping_list` | Add a product with quantity |
| `set_item_quantity` | Set the absolute quantity of an existing SKU |
| `remove_from_shopping_list` | Delete one SKU from the list |
| `empty_shopping_list` | Delete **all** grocery-list items; requires `confirm=true` |
| `get_purchase_history` | Read Wegmans "My Items" purchase-history data |

## What the server is using

The Wegmans web client currently uses:

- Azure AD B2C / OAuth 2.0 for account authentication.
- One-hour bearer access tokens.
- Rotating refresh tokens.
- `api.digitaldevelopment.wegmans.cloud` for commerce/cart operations.
- Algolia index `products` for product search.

The cart API is versioned with `2024-02-19-preview`; product detail currently uses `2023-09-22`.

## Setup

Requires Node.js 20+.

```bash
npm install
npm run build
```

Copy `.env.example` values into your MCP host configuration. **Do not commit tokens.**

### Bootstrap authentication

1. Sign into `wegmans.com` normally.
2. Open Chrome DevTools → Network.
3. Find the successful request to the Wegmans Azure AD B2C endpoint ending in `/oauth2/v2.0/token`.
4. In the JSON response, copy the `refresh_token` value.
5. Set it once as `WEGMANS_REFRESH_TOKEN`.

On the first refresh, the server stores the rotated refresh token in:

```text
~/.config/wegmans-mcp/tokens.json
```

The file is written with user-only permissions. The persisted token takes precedence over `WEGMANS_REFRESH_TOKEN`, so normal token rotation continues without changing environment variables.

If the refresh-token family expires or is revoked, repeat the bootstrap process with a newly signed-in browser session.

### Store configuration

Defaults are set to store 59 / Burlington:

```text
WEGMANS_STORE_NUMBER=59
WEGMANS_STORE_KEY=59-BURLINGTON
```

Override both for a different store. `WEGMANS_STORE_KEY` is used by the add-to-cart/list endpoint.

## MCP host configuration

After `npm run build`, a stdio MCP host can launch the server like this:

```json
{
  "mcpServers": {
    "wegmans": {
      "command": "node",
      "args": ["/absolute/path/to/wegmans-mcp/dist/server.js"],
      "env": {
        "WEGMANS_REFRESH_TOKEN": "<bootstrap refresh token>",
        "WEGMANS_STORE_NUMBER": "59",
        "WEGMANS_STORE_KEY": "59-BURLINGTON"
      }
    }
  }
}
```

Do not put the refresh token in a repository-tracked config file.

## Empty-list behavior

The Wegmans UI empties the list with a single request:

```text
PUT /commerce/cart/carts/itemdeletion?api-version=2024-02-19-preview
```

with every current SKU represented in `lineItems`:

```json
{
  "cartData": [{
    "cartID": "...",
    "cartVersion": 123,
    "lineItems": [
      { "sku": "164850" },
      { "sku": "18515" }
    ]
  }]
}
```

`empty_shopping_list` fetches the latest cart first, derives every current SKU, submits them together, and requires `confirm=true` to reduce accidental destructive calls.

## Authentication implementation

The server uses the currently stored refresh token to request a new access token from Wegmans' B2C token endpoint. When Wegmans returns a rotated `refresh_token`, the token file is replaced atomically. API calls retry once after a `401` by forcing another refresh.

No passwords, access tokens, refresh tokens, customer IDs, or email addresses are included in this repository.

## Development

```bash
npm run dev
npm test
npm run build
```

## Security

A Wegmans refresh token is a credential. Anyone holding it may be able to act as your account until it expires or is revoked. Keep token files out of source control, do not paste them into issues/logs, and sign out/re-authenticate if you believe a token has been exposed.
