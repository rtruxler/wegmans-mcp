import type { WegmansConfig } from "./config.js";
import { WegmansAuth } from "./auth.js";
import type { GroceryCart, Product } from "./types.js";

function cents(amount: number | undefined): number {
  if (amount == null || !Number.isFinite(amount)) throw new Error("Product has no valid in-store price.");
  return Math.round(amount * 100);
}

function productSku(product: Product): string {
  const sku = product.skuId ?? product.productID ?? product.productId;
  if (!sku) throw new Error("Product response did not contain a SKU/product ID.");
  return String(sku);
}

function topCategory(product: Product): { name: string; key: string } | undefined {
  if (!Array.isArray(product.category) || product.category.length === 0) return undefined;
  const preferred = [...product.category].reverse().find((c) => c?.name && c?.key);
  return preferred?.name && preferred?.key
    ? { name: String(preferred.name), key: String(preferred.key) }
    : undefined;
}

export class WegmansClient {
  private readonly auth: WegmansAuth;

  constructor(private readonly config: WegmansConfig) {
    this.auth = new WegmansAuth(config);
  }

  async searchProducts(query: string, limit = 10): Promise<Product[]> {
    const response = await fetch("https://qgppr19v8v-dsn.algolia.net/1/indexes/*/queries", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-algolia-application-id": this.config.algoliaAppId,
        "x-algolia-api-key": this.config.algoliaApiKey
      },
      body: JSON.stringify({
        requests: [
          {
            indexName: "products",
            query,
            hitsPerPage: Math.min(Math.max(limit, 1), 50),
            attributesToHighlight: [],
            filters: `storeNumber:${this.config.storeNumber} AND fulfilmentType:instore AND excludeFromWeb:false AND isSoldAtStore:true`
          }
        ]
      })
    });

    const json = (await this.expectJson(response, "Algolia product search")) as {
      results?: Array<{ hits?: Product[] }>;
    };
    return json.results?.[0]?.hits ?? [];
  }

  async getProduct(productId: string): Promise<Product> {
    const url = new URL("/commerce/browse/products/", this.config.apiBaseUrl);
    url.searchParams.set("productid", productId);
    url.searchParams.set("storeNumber", this.config.storeNumber);
    url.searchParams.set("api-version", "2023-09-22");
    const result = (await this.apiJson(url.toString())) as Product[];
    const product = result.find((p) => productSku(p) === productId) ?? result[0];
    if (!product) throw new Error(`Product ${productId} was not found at store ${this.config.storeNumber}.`);
    return product;
  }

  async getShoppingList(): Promise<GroceryCart> {
    const url = new URL("/commerce/cart/carts/", this.config.apiBaseUrl);
    url.searchParams.set("api-version", "2024-02-19-preview");
    const payload = (await this.apiJson(url.toString())) as { grocery?: GroceryCart } | GroceryCart;
    const cart = "grocery" in payload ? payload.grocery : payload;
    if (!cart?.id || cart.version == null) throw new Error("Wegmans cart response did not contain a grocery cart.");
    return cart;
  }

  async getPurchaseHistory(): Promise<unknown> {
    const url = new URL("/commerce/my-items", this.config.apiBaseUrl);
    url.searchParams.set("api-version", "2024-01-26");
    return this.apiJson(url.toString());
  }

  async addToShoppingList(productId: string, quantity = 1): Promise<GroceryCart> {
    if (!Number.isInteger(quantity) || quantity < 1) throw new Error("quantity must be a positive integer.");
    const [cart, product] = await Promise.all([this.getShoppingList(), this.getProduct(productId)]);
    const sku = productSku(product);
    const category = topCategory(product);
    const priceCents = cents(product.price_inStore?.amount);

    const custom: Array<{ name: string; value: unknown }> = [
      { name: "itemLevelAdjustments", value: "[]" },
      { name: "isSoldAtStore", value: product.isSoldAtStore ?? true },
      { name: "ebtEligible", value: product.ebtEligible ?? false },
      { name: "isAvailable", value: product.isAvailable ?? true },
      { name: "planogram", value: JSON.stringify(product.planogram ?? {}) },
      { name: "note", value: "" },
      { name: "bottleDeposit", value: product.bottleDeposit ?? 0 },
      { name: "upc", value: product.upc ?? [] },
      { name: "fulfillmentTypes", value: product.fulfilmentType ?? ["instore"] },
      { name: "maxQuantity", value: String(product.maxQuantity ?? 99) }
    ];
    if (category) {
      custom.unshift({ name: "categoryId", value: category.key });
      custom.unshift({ name: "category", value: category.name });
    }

    const body = {
      StoreKey: this.config.storeKey,
      cartData: [
        {
          cartID: cart.id,
          cartVersion: cart.version,
          custom: this.cartCustomForMutation(cart),
          isAlcoholic: product.isAlcoholItem ?? false,
          lineItems: [
            {
              custom,
              distributionChannelKey: `${this.config.storeNumber}-Instore`,
              isAlcoholic: product.isAlcoholItem ?? false,
              isSoldByWeight: product.isSoldByWeight ?? false,
              onlineApproxUnitWeight: product.onlineApproxUnitWeight ?? 0,
              onlineSellByUnit: product.onlineSellByUnit ?? "ea",
              quantity,
              sku,
              standalonePrice: priceCents
            }
          ]
        }
      ],
      customerEmail: cart.customerEmail,
      customerID: cart.customerId
    };

    return this.mutateCart("/commerce/cart/carts/lineitems", "POST", body);
  }

  async setQuantity(sku: string, quantity: number): Promise<GroceryCart> {
    if (!Number.isInteger(quantity) || quantity < 1) throw new Error("quantity must be a positive integer.");
    const [cart, product] = await Promise.all([this.getShoppingList(), this.getProduct(sku)]);
    const priceCents = cents(product.price_inStore?.amount);
    const body = {
      cartData: [
        {
          cartID: cart.id,
          cartVersion: cart.version,
          isAlcoholic: product.isAlcoholItem ?? false,
          lineItems: [
            {
              centAmount: priceCents,
              custom: [
                { name: "isSoldAtStore", value: product.isSoldAtStore ?? true },
                { name: "isAvailable", value: product.isAvailable ?? true },
                { name: "itemLevelAdjustments", value: "[]" }
              ],
              isSoldByWeight: product.isSoldByWeight ?? false,
              maxQtyAllowed: product.maxQuantity ?? 99,
              onlineSellByUnit: product.onlineSellByUnit ?? "ea",
              quantity,
              sku,
              standalonePrice: priceCents
            }
          ]
        }
      ]
    };
    return this.mutateCart("/commerce/cart/carts/lineitems/quantity", "PUT", body);
  }

  async removeFromShoppingList(sku: string): Promise<GroceryCart> {
    const cart = await this.getShoppingList();
    return this.deleteSkus(cart, [sku]);
  }

  async emptyShoppingList(): Promise<{ removed: number; cart: GroceryCart }> {
    const cart = await this.getShoppingList();
    const skus = (cart.lineItems ?? [])
      .map((item) => item.variant?.sku ?? item.productKey)
      .filter((sku): sku is string => typeof sku === "string" && sku.length > 0);

    if (skus.length === 0) return { removed: 0, cart };
    const updated = await this.deleteSkus(cart, skus);
    return { removed: skus.length, cart: updated };
  }

  private async deleteSkus(cart: GroceryCart, skus: string[]): Promise<GroceryCart> {
    const body = {
      cartData: [
        {
          cartID: cart.id,
          cartVersion: cart.version,
          custom: this.cartCustomForMutation(cart, true),
          customLineItems: cart.customLineItems ?? [],
          isAlcoholic: false,
          lineItems: skus.map((sku) => ({ sku }))
        }
      ]
    };
    return this.mutateCart("/commerce/cart/carts/itemdeletion", "PUT", body);
  }

  private cartCustomForMutation(cart: GroceryCart, includeNonAvailable = false) {
    const fields = cart.custom?.customFieldsRaw ?? [];
    const selected = fields.filter((f) =>
      includeNonAvailable
        ? f.name === "nonAvailableItems" || f.name === "orderLevelAdjustments"
        : f.name === "orderLevelAdjustments" || f.name === "storeNumber" || f.name === "fulfillmentType"
    );
    return selected.map((f) => ({ name: f.name, value: f.value }));
  }

  private async mutateCart(path: string, method: "POST" | "PUT", body: unknown): Promise<GroceryCart> {
    const url = new URL(path, this.config.apiBaseUrl);
    url.searchParams.set("api-version", "2024-02-19-preview");
    const payload = (await this.apiJson(url.toString(), {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    })) as { grocery?: GroceryCart } | GroceryCart;
    const cart = "grocery" in payload ? payload.grocery : payload;
    if (!cart?.id || cart.version == null) throw new Error("Cart mutation succeeded but returned no grocery cart.");
    return cart;
  }

  private async apiJson(url: string, init: RequestInit = {}): Promise<unknown> {
    const first = await this.authorizedFetch(url, init, false);
    if (first.status !== 401) return this.expectJson(first, "Wegmans API");

    const second = await this.authorizedFetch(url, init, true);
    return this.expectJson(second, "Wegmans API after token refresh");
  }

  private async authorizedFetch(url: string, init: RequestInit, forceRefresh: boolean): Promise<Response> {
    const token = await this.auth.getAccessToken(forceRefresh);
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${token}`);
    headers.set("accept", "application/json");
    return fetch(url, { ...init, headers });
  }

  private async expectJson(response: Response, label: string): Promise<unknown> {
    const text = await response.text();
    if (!response.ok) throw new Error(`${label} failed (${response.status}): ${text.slice(0, 1000)}`);
    return text ? JSON.parse(text) : null;
  }
}
