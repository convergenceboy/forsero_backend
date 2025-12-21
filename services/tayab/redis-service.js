import process from "node:process";
import { createClient } from "redis";
import { config } from "dotenv";

config();

const connectionString = process.env.REDIS_CONNECTION_STRING;
const useTls = connectionString?.startsWith("rediss://");

const redisClient = createClient({
	url: connectionString,
	socket: useTls
		? {
				tls: true,
				rejectUnauthorized: false,
		  }
		: {},
	enableReadyCheck: false,
	maxRetriesPerRequest: null,
});

export { redisClient };
