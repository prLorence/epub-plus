import { requestUrl } from "obsidian";

export interface KoSyncCredentials {
	server: string;
	username: string;
	password: string; // MD5-hashed
}

export interface KoSyncProgress {
	document: string;
	progress: string;
	percentage: number;
	device: string;
	device_id: string;
	timestamp?: number;
}

const API_ACCEPT = "application/vnd.koreader.v1+json";

export class KoSyncClient {
	constructor(private credentials: KoSyncCredentials) {}

	private get baseUrl(): string {
		return this.credentials.server.replace(/\/+$/, "");
	}

	private authHeaders(): Record<string, string> {
		return {
			"x-auth-user": this.credentials.username,
			"x-auth-key": this.credentials.password,
			Accept: API_ACCEPT,
			Authorization:
				"Basic " +
				btoa(
					`${this.credentials.username}:${this.credentials.password}`,
				),
		};
	}

	/**
	 * Verify credentials against the server.
	 * GET /users/auth
	 */
	async authorize(): Promise<boolean> {
		try {
			const resp = await requestUrl({
				url: `${this.baseUrl}/users/auth`,
				method: "GET",
				headers: this.authHeaders(),
				throw: false,
			});
			return resp.status === 200;
		} catch (e) {
			console.error("[EPUB++] KoSync: authorize failed:", e);
			return false;
		}
	}

	/**
	 * Register a new user.
	 * POST /users/create
	 */
	async register(
		username: string,
		password: string,
	): Promise<{ ok: boolean; message?: string }> {
		try {
			const resp = await requestUrl({
				url: `${this.baseUrl}/users/create`,
				method: "POST",
				headers: {
					Accept: API_ACCEPT,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ username, password }),
			});
			return { ok: resp.status === 201 || resp.status === 200 };
		} catch (e: unknown) {
			const message = e instanceof Error ? e.message : String(e);
			return { ok: false, message };
		}
	}

	/**
	 * Get reading progress for a document.
	 * GET /syncs/progress/:document
	 * Returns null if no progress exists.
	 */
	async getProgress(documentHash: string): Promise<KoSyncProgress | null> {
		try {
			const resp = await requestUrl({
				url: `${this.baseUrl}/syncs/progress/${documentHash}`,
				method: "GET",
				headers: this.authHeaders(),
				throw: false,
			});
			if (resp.status !== 200) return null;
			const data = resp.json as Record<string, unknown>;
			if (!data || !data.document) return null;
			return data as unknown as KoSyncProgress;
		} catch (e) {
			console.error("[EPUB++] KoSync: getProgress failed:", e);
			return null;
		}
	}

	/**
	 * Update reading progress for a document.
	 * PUT /syncs/progress
	 */
	async putProgress(
		progress: Omit<KoSyncProgress, "timestamp">,
	): Promise<{ timestamp: number } | null> {
		try {
			const resp = await requestUrl({
				url: `${this.baseUrl}/syncs/progress`,
				method: "PUT",
				headers: {
					...this.authHeaders(),
					"Content-Type": "application/json",
				},
				body: JSON.stringify(progress),
				throw: false,
			});
			if (resp.status === 200) {
				return resp.json as { document: string; timestamp: number };
			}
			return null;
		} catch (e) {
			console.error("[EPUB++] KoSync: putProgress failed:", e);
			return null;
		}
	}
}
