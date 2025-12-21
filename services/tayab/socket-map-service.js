import { redisClient } from "./redis-service.js";

async function ensureRedisConnected() {
	if (!redisClient.isOpen) {
		await redisClient.connect();
	}
}

export async function setUserSocketId(userId, socketId) {
	if (!userId || !socketId) {
		return;
	}

	await ensureRedisConnected();
	const userKey = `userIdToSocketId:${String(userId)}`;
	await redisClient.set(userKey, String(socketId));
}

export async function getUserSocketId(userId) {
	if (!userId) {
		return;
	}

	await ensureRedisConnected();
	const userKey = `userIdToSocketId:${String(userId)}`;
	return redisClient.get(userKey);
}

export async function deleteUserSocketId(userId) {
	if (!userId) {
		return;
	}

	await ensureRedisConnected();
	const userKey = `userIdToSocketId:${String(userId)}`;
	await redisClient.del(userKey);
}
