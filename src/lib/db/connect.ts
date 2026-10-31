import mongoose from "mongoose";

/**
 * One cached connection per server process. In development, HMR re-evaluates
 * modules, so the promise is kept on globalThis to avoid opening a new pool per edit.
 */
const globalForMongoose = globalThis as unknown as {
  __mongoose?: { promise: Promise<typeof mongoose> | null };
};

const cache = (globalForMongoose.__mongoose ??= { promise: null });

// Operations inside connection.transaction() automatically join its session —
// a safety net on top of the explicit `session` options used by the ledger code.
mongoose.set("transactionAsyncLocalStorage", true);
mongoose.set("strictQuery", true);

export async function connectDB(): Promise<typeof mongoose> {
  if (mongoose.connection.readyState === 1) return mongoose;
  if (!cache.promise) {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error("MONGODB_URI is not set. Add it to .env.local");
    cache.promise = mongoose
      .connect(uri, {
        dbName: process.env.MONGODB_DB || "pocketledger",
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 10_000,
        autoIndex: true,
      })
      .catch((err) => {
        cache.promise = null;
        throw err;
      });
  }
  return cache.promise;
}

/** Close the connection (used by scripts and tests). */
export async function disconnectDB(): Promise<void> {
  cache.promise = null;
  await mongoose.disconnect();
}
