import { redisClient } from "./redis-service.js";

async function ensureRedisConnected() {
	if (!redisClient.isOpen) {
		await redisClient.connect();
	}
}

function heartbeatKeyForUser(userId) {
	return `userHeartbeat:${String(userId)}`;
}

export async function userHeartbeat(userId, timestampMs = Date.now()) {
	if (!userId) {
		return;
	}

	await ensureRedisConnected();
	const key = heartbeatKeyForUser(userId);
	await redisClient.set(key, String(timestampMs));
}

export async function checkUserOnline(userId, thresholdMs = 10_000) {
	if (!userId) {
		return { online: false, lastHeartbeat: null };
	}

	await ensureRedisConnected();
	const key = heartbeatKeyForUser(userId);
	const tsString = await redisClient.get(key);
	if (!tsString) {
		return { online: false, lastHeartbeat: null };
	}

	const ts = Number(tsString);
	if (Number.isNaN(ts) || ts <= 0) {
		return { online: false, lastHeartbeat: null };
	}

	const now = Date.now();
	const online = now - ts < thresholdMs;
	return { online, lastHeartbeat: ts };
}
