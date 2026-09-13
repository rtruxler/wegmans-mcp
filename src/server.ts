#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadConfig } from "./config.js";
import { WegmansClient } from "./client.js";
import type { GroceryCart, Product } from "./types.js";

const config = loadConfig();
const client = new WegmansClient(config);
const server = new McpServer({ name: "wegmans-mcp", version: "0.1.0" });

function text(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function productSummary(p: Product) {
  return {
    productId: p.skuId ?? p.productID ?? p.productId,
    name: p.productName,
    brand: p.consumerBrandName,
    description: p.webProductDescription,
    packSize: p.packSize,
    price: p.price_inStore?.amount,
    unitPrice: p.price_inStore?.unitPrice,
    available: p.isAvailable,
    aisle: p.planogram?.aisle,
    shelf: p.planogram?.shelf,
    section: p.planogram?.section,
    image: p.images?.[0],
    slug: p.slug
  };
}

function cartSummary(cart: GroceryCart) {
  return {
    cartId: cart.id,
    version: cart.version,
    totalItems: cart.totalLineItemQuantity,
    items: (cart.lineItems ?? []).map((item) => ({
      sku: item.variant?.sku ?? item.productKey,
      name: item.name,
      quantity: item.quantity,
      image: item.variant?.images?.[0]?.url
    }))
  };
}

server.tool(
  "search_products",
  "Search products sold at the configured Wegmans store. Returns product IDs, price, availability, and aisle location.",
  {
    query: z.string().min(1).describe("Natural-language product search, e.g. 'chobani flip yogurt'."),
    limit: z.number().int().min(1).max(50).default(10)
  },
  async ({ query, limit }) => text((await client.searchProducts(query, limit)).map(productSummary))
);

server.tool(
  "get_product",
  "Get current product details for one Wegmans product/SKU at the configured store.",
  { product_id: z.string().min(1) },
  async ({ product_id }) => text(productSummary(await client.getProduct(product_id)))
);

server.tool(
  "get_shopping_list",
  "Read the user's current Wegmans grocery shopping list.",
  {},
  async () => text(cartSummary(await client.getShoppingList()))
);

server.tool(
  "add_to_shopping_list",
  "Add a Wegmans product/SKU to the current shopping list. Search first if the requested product is ambiguous.",
  {
    product_id: z.string().min(1).describe("Wegmans product ID/SKU returned by search_products."),
    quantity: z.number().int().min(1).max(99).default(1)
  },
  async ({ product_id, quantity }) => text(cartSummary(await client.addToShoppingList(product_id, quantity)))
);

server.tool(
  "set_item_quantity",
  "Set the absolute quantity of an existing shopping-list item.",
  {
    sku: z.string().min(1),
    quantity: z.number().int().min(1).max(99)
  },
  async ({ sku, quantity }) => text(cartSummary(await client.setQuantity(sku, quantity)))
);

server.tool(
  "remove_from_shopping_list",
  "Remove one SKU entirely from the Wegmans shopping list.",
  { sku: z.string().min(1) },
  async ({ sku }) => text(cartSummary(await client.removeFromShoppingList(sku)))
);

server.tool(
  "empty_shopping_list",
  "DESTRUCTIVE: remove every item from the Wegmans shopping list. Only call after the user explicitly asks to empty/clear the entire list. Requires confirm=true.",
  {
    confirm: z.boolean().describe("Must be true. This guard exists to prevent accidental full-list deletion.")
  },
  async ({ confirm }) => {
    if (!confirm) throw new Error("Refusing to empty the shopping list without confirm=true.");
    const result = await client.emptyShoppingList();
    return text({ removed: result.removed, list: cartSummary(result.cart) });
  }
);

server.tool(
  "get_purchase_history",
  "Read Wegmans 'My Items'/purchase-history data for the authenticated account.",
  {},
  async () => text(await client.getPurchaseHistory())
);

const transport = new StdioServerTransport();
await server.connect(transport);
