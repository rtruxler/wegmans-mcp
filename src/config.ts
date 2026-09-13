import os from "node:os";
import path from "node:path";

export interface WegmansConfig {
  apiBaseUrl: string;
  tokenUrl: string;
  clientId: string;
  scope: string;
  tokenFile: string;
  bootstrapRefreshToken?: string;
  storeNumber: string;
  storeKey: string;
  algoliaAppId: string;
  algoliaApiKey: string;
}

export const DEFAULT_SCOPE = [
  "https://wegmansonline.onmicrosoft.com/api.digitaldevelopment.wegmans.cloud/Users.Profile.Read",
  "https://wegmansonline.onmicrosoft.com/api.digitaldevelopment.wegmans.cloud/Google.AddressValidation",
  "https://wegmansonline.onmicrosoft.com/api.digitaldevelopment.wegmans.cloud/InstacartConnect.Fulfillment",
  "https://wegmansonline.onmicrosoft.com/api.digitaldevelopment.wegmans.cloud/DigitalCoupons.Offers",
  "https://wegmansonline.onmicrosoft.com/api.digitaldevelopment.wegmans.cloud/Commerce.SignalR",
  "https://wegmansonline.onmicrosoft.com/api.digitaldevelopment.wegmans.cloud/InstacartConnect.PostCheckout",
  "https://wegmansonline.onmicrosoft.com/api.digitaldevelopment.wegmans.cloud/InstacartConnect.Feedback",
  "https://wegmansonline.onmicrosoft.com/api.digitaldevelopment.wegmans.cloud/Feedback.Write",
  "https://wegmansonline.onmicrosoft.com/api.digitaldevelopment.wegmans.cloud/Users.Profile.Write",
  "openid",
  "profile",
  "offline_access"
].join(" ");

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WegmansConfig {
  return {
    apiBaseUrl: env.WEGMANS_API_BASE_URL ?? "https://api.digitaldevelopment.wegmans.cloud",
    tokenUrl:
      env.WEGMANS_TOKEN_URL ??
      "https://myaccount.wegmans.com/wegmansonline.onmicrosoft.com/b2c_1a_wegmanssignupsigninwithphoneverification/oauth2/v2.0/token",
    clientId: env.WEGMANS_CLIENT_ID ?? "38c78f8d-d124-4796-8430-1cd476d9a982",
    scope: env.WEGMANS_SCOPE ?? DEFAULT_SCOPE,
    tokenFile:
      env.WEGMANS_TOKEN_FILE ?? path.join(os.homedir(), ".config", "wegmans-mcp", "tokens.json"),
    bootstrapRefreshToken: env.WEGMANS_REFRESH_TOKEN,
    storeNumber: env.WEGMANS_STORE_NUMBER ?? "59",
    storeKey: env.WEGMANS_STORE_KEY ?? "59-BURLINGTON",
    algoliaAppId: env.WEGMANS_ALGOLIA_APP_ID ?? "QGPPR19V8V",
    // Search-only browser credential observed in Wegmans' public web client.
    algoliaApiKey: env.WEGMANS_ALGOLIA_API_KEY ?? "9a10b1401634e9a6e55161c3a60c200d"
  };
}
