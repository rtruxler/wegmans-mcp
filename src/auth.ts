import fs from "node:fs/promises";
import path from "node:path";
import type { WegmansConfig } from "./config.js";

interface TokenState {
  accessToken?: string;
  accessTokenExpiresAt?: number;
  refreshToken: string;
  refreshTokenExpiresAt?: number;
}

interface RefreshResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  token_type?: string;
}

export class WegmansAuth {
  private state?: TokenState;
  private refreshPromise?: Promise<string>;

  constructor(private readonly config: WegmansConfig) {}

  async getAccessToken(forceRefresh = false): Promise<string> {
    await this.ensureLoaded();
    const now = Date.now();
    if (
      !forceRefresh &&
      this.state?.accessToken &&
      this.state.accessTokenExpiresAt &&
      this.state.accessTokenExpiresAt - now > 60_000
    ) {
      return this.state.accessToken;
    }

    if (!this.refreshPromise) {
      this.refreshPromise = this.refreshAccessToken().finally(() => {
        this.refreshPromise = undefined;
      });
    }
    return this.refreshPromise;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.state) return;

    try {
      const raw = await fs.readFile(this.config.tokenFile, "utf8");
      const parsed = JSON.parse(raw) as TokenState;
      if (parsed.refreshToken) {
        this.state = parsed;
        return;
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw error;
    }

    if (!this.config.bootstrapRefreshToken) {
      throw new Error(
        `No Wegmans refresh token configured. Set WEGMANS_REFRESH_TOKEN once, or create ${this.config.tokenFile}.`
      );
    }

    this.state = { refreshToken: this.config.bootstrapRefreshToken };
  }

  private async refreshAccessToken(): Promise<string> {
    if (!this.state?.refreshToken) throw new Error("Missing Wegmans refresh token.");

    if (this.state.refreshTokenExpiresAt && this.state.refreshTokenExpiresAt <= Date.now()) {
      throw new Error(
        "The stored Wegmans refresh token has expired. Sign in to Wegmans again and provide a new WEGMANS_REFRESH_TOKEN."
      );
    }

    const body = new URLSearchParams({
      client_id: this.config.clientId,
      scope: this.config.scope,
      grant_type: "refresh_token",
      client_info: "1",
      refresh_token: this.state.refreshToken
    });

    const response = await fetch(this.config.tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Wegmans token refresh failed (${response.status}): ${text.slice(0, 500)}`);
    }

    const payload = JSON.parse(text) as RefreshResponse;
    if (!payload.access_token) throw new Error("Wegmans token response did not include access_token.");

    const now = Date.now();
    this.state = {
      accessToken: payload.access_token,
      accessTokenExpiresAt: now + Math.max(0, payload.expires_in - 30) * 1000,
      refreshToken: payload.refresh_token ?? this.state.refreshToken,
      refreshTokenExpiresAt: payload.refresh_token_expires_in
        ? now + payload.refresh_token_expires_in * 1000
        : this.state.refreshTokenExpiresAt
    };

    await this.persist();
    return payload.access_token;
  }

  private async persist(): Promise<void> {
    if (!this.state) return;
    const dir = path.dirname(this.config.tokenFile);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const temp = `${this.config.tokenFile}.${process.pid}.tmp`;
    await fs.writeFile(temp, JSON.stringify(this.state, null, 2), { mode: 0o600 });
    await fs.rename(temp, this.config.tokenFile);
  }
}
