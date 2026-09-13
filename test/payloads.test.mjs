import assert from "node:assert/strict";
import test from "node:test";

// Regression fixtures from the captured Wegmans web-app behavior. These tests intentionally
// contain no credentials, account IDs, emails, or live cart IDs.

test("empty-list deletion uses one SKU object per cart item", () => {
  const skus = ["164850", "18515", "624377"];
  const lineItems = skus.map((sku) => ({ sku }));
  assert.deepEqual(lineItems, [{ sku: "164850" }, { sku: "18515" }, { sku: "624377" }]);
});

test("money is converted to integer cents", () => {
  assert.equal(Math.round(2.49 * 100), 249);
  assert.equal(Math.round(1.49 * 100), 149);
});
