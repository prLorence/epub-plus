import SparkMD5 from "spark-md5";

/**
 * Byte offsets sampled by KOReader's `util.partialMD5()`.
 * Pattern: offset 0, then 1024 * 4^i for i = 0..10.
 */
const SAMPLE_OFFSETS = [
	0, 1024, 4096, 16384, 65536, 262144, 1048576, 4194304,
	16777216, 67108864, 268435456, 1073741824,
];

const CHUNK_SIZE = 1024;

/**
 * Compute the partial MD5 checksum of a file, matching KOReader's
 * `util.partialMD5()` algorithm exactly.
 *
 * Reads 1024-byte chunks at exponentially-spaced offsets and feeds
 * them incrementally into MD5. Stops at the first offset beyond the
 * data length.
 *
 * @returns Lowercase 32-character hex MD5 digest.
 */
export function partialMD5(data: ArrayBuffer): string {
	const spark = new SparkMD5.ArrayBuffer();
	const byteLength = data.byteLength;

	for (const offset of SAMPLE_OFFSETS) {
		if (offset >= byteLength) break;
		const end = Math.min(offset + CHUNK_SIZE, byteLength);
		spark.append(data.slice(offset, end));
	}

	return spark.end();
}

/**
 * Compute the MD5 of a filename (basename only, no path).
 * Matches KOReader's filename checksum mode.
 */
export function filenameMD5(filename: string): string {
	return SparkMD5.hash(filename);
}
