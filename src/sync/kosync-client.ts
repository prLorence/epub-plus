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
			console.info("[EPUB++] KoSync GET /users/auth");
			const resp = await requestUrl({
				url: `${this.baseUrl}/users/auth`,
				method: "GET",
				headers: this.authHeaders(),
				throw: false,
			});
			console.info("[EPUB++] KoSync GET /users/auth →", resp.status);
			return resp.status === 200;
		} catch (e) {
			console.error("[EPUB++] KoSync GET /users/auth failed:", e);
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
			console.info("[EPUB++] KoSync POST /users/create");
			const resp = await requestUrl({
				url: `${this.baseUrl}/users/create`,
				method: "POST",
				headers: {
					Accept: API_ACCEPT,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ username, password }),
			});
			console.info("[EPUB++] KoSync POST /users/create →", resp.status);
			return { ok: resp.status === 201 || resp.status === 200 };
		} catch (e: unknown) {
			const message = e instanceof Error ? e.message : String(e);
			console.error("[EPUB++] KoSync POST /users/create failed:", message);
			return { ok: false, message };
		}
	}

	/**
	 * Get reading progress for a document.
	 * GET /syncs/progress/:document
	 * Returns null if no progress exists.
	 */
	async getProgress(documentHash: string): Promise<KoSyncProgress | null> {
		const shortHash = documentHash.slice(0, 8);
		try {
			console.info(`[EPUB++] KoSync GET /syncs/progress/${shortHash}...`);
			const resp = await requestUrl({
				url: `${this.baseUrl}/syncs/progress/${documentHash}`,
				method: "GET",
				headers: this.authHeaders(),
				throw: false,
			});
			if (resp.status !== 200) {
				console.info(`[EPUB++] KoSync GET /syncs/progress/${shortHash}... → ${resp.status} (no data)`);
				return null;
			}
			const data = resp.json as Record<string, unknown>;
			if (!data || !data.document) {
				console.info(`[EPUB++] KoSync GET /syncs/progress/${shortHash}... → empty`);
				return null;
			}
			const progress = data as unknown as KoSyncProgress;
			console.info(
				`[EPUB++] KoSync GET /syncs/progress/${shortHash}... → ${Math.round(progress.percentage * 100)}% from "${progress.device}"`,
			);
			return progress;
		} catch (e) {
			console.error(`[EPUB++] KoSync GET /syncs/progress/${shortHash}... failed:`, e);
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
		const shortHash = progress.document.slice(0, 8);
		try {
			console.info(
				`[EPUB++] KoSync PUT /syncs/progress ${shortHash}... → ${Math.round(progress.percentage * 100)}%`,
			);
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
				const result = resp.json as { document: string; timestamp: number };
				console.info(
					`[EPUB++] KoSync PUT /syncs/progress ${shortHash}... → OK (ts: ${result.timestamp})`,
				);
				return result;
			}
			console.warn(
				`[EPUB++] KoSync PUT /syncs/progress ${shortHash}... → ${resp.status}`,
			);
			return null;
		} catch (e) {
			console.error(`[EPUB++] KoSync PUT /syncs/progress ${shortHash}... failed:`, e);
			return null;
		}
	}
}
