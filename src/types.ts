export interface Product {
  productID?: string;
  productId?: string;
  skuId?: string;
  productName?: string;
  webProductDescription?: string;
  packSize?: string;
  consumerBrandName?: string | null;
  consumerSubBrandName?: string | null;
  category?: Array<{ name?: string; key?: string }>;
  fulfilmentType?: string[];
  ebtEligible?: boolean;
  isSoldAtStore?: boolean;
  isAvailable?: boolean;
  isSoldByWeight?: boolean;
  isAlcoholItem?: boolean;
  onlineSellByUnit?: string;
  onlineApproxUnitWeight?: number;
  maxQuantity?: number;
  bottleDeposit?: number;
  upc?: string[];
  planogram?: {
    aisle?: string | null;
    shelf?: string | null;
    aisleSide?: string | null;
    section?: string | null;
  };
  price_inStore?: {
    amount?: number;
    unitPrice?: string;
    channelKey?: string;
  };
  images?: string[];
  slug?: string;
  [key: string]: unknown;
}

export interface CartLineItem {
  id?: string;
  productKey?: string;
  name?: string;
  quantity?: number;
  totalPrice?: { centAmount?: number };
  variant?: {
    sku?: string;
    images?: Array<{ url?: string }>;
    attributesRaw?: Array<{ name?: string; value?: unknown }>;
  };
  [key: string]: unknown;
}

export interface GroceryCart {
  id: string;
  version: number;
  customerId?: string;
  customerEmail?: string;
  lineItems?: CartLineItem[];
  customLineItems?: unknown[];
  custom?: {
    customFieldsRaw?: Array<{ name?: string; value?: unknown }>;
  };
  totalLineItemQuantity?: number;
  [key: string]: unknown;
}
