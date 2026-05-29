/**
 * In-memory sliding-window rate limiter for Telegram messages.
 *
 * Why in-memory, not Redis?
 * The bot runs as a single process on Render. A simple Map is O(1) and adds
 * zero infrastructure cost. If the process restarts, counters reset — which
 * is acceptable (restarts are rare and brief). Upgrade to Redis if you ever
 * run multiple bot replicas.
 *
 * How it works:
 * - Each chatId has a list of timestamps of recent messages.
 * - On every message, timestamps older than WINDOW_MS are pruned first.
 * - If the remaining count >= MAX_MESSAGES, the request is rate-limited.
 * - Cleanup of idle chatIds runs every CLEANUP_INTERVAL_MS.
 */

const WINDOW_MS           = 60_000;   // sliding window: 60 seconds
const MAX_MESSAGES        = 10;       // max messages per window per chatId
const CLEANUP_INTERVAL_MS = 5 * 60_000; // prune idle entries every 5 minutes

interface RateLimitEntry {
  timestamps: number[];
  lastSeen:   number;
}

const store = new Map<string, RateLimitEntry>();

// Prune chatIds that have been idle for > 10 minutes to keep memory bounded
setInterval(() => {
  const cutoff = Date.now() - 10 * 60_000;
  for (const [chatId, entry] of store.entries()) {
    if (entry.lastSeen < cutoff) {
      store.delete(chatId);
    }
  }
}, CLEANUP_INTERVAL_MS);

/**
 * Returns true if the chatId is within the rate limit.
 * Returns false if the chatId has exceeded MAX_MESSAGES in the last WINDOW_MS.
 */
export const checkRateLimit = (chatId: string): boolean => {
  const now    = Date.now();
  const cutoff = now - WINDOW_MS;

  let entry = store.get(chatId);

  if (!entry) {
    entry = { timestamps: [], lastSeen: now };
    store.set(chatId, entry);
  }

  // Drop timestamps outside the window
  entry.timestamps = entry.timestamps.filter(ts => ts > cutoff);
  entry.lastSeen   = now;

  if (entry.timestamps.length >= MAX_MESSAGES) {
    return false; // rate-limited
  }

  entry.timestamps.push(now);
  return true; // allowed
};

/**
 * How long (in seconds) until the oldest timestamp in the window expires.
 * Useful for building "try again in X seconds" messages.
 */
export const secondsUntilReset = (chatId: string): number => {
  const entry = store.get(chatId);
  if (!entry || entry.timestamps.length === 0) return 0;

  const oldest = Math.min(...entry.timestamps);
  const remaining = Math.ceil((oldest + WINDOW_MS - Date.now()) / 1000);
  return Math.max(0, remaining);
};
