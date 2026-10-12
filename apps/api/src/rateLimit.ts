/**
 * A small in-memory limiter for anything that spends money:
 * - a short window per visitor (stops rapid fire requests),
 * - a daily cap per visitor (so one person can't use up the whole day),
 * - a daily cap for the whole app (a hard ceiling on the bill).
 * Counts reset at midnight UTC. Everything lives in memory, so a restart also resets it.
 */
export interface RateLimiterOptions {
  perIpLimit: number;
  windowMs: number;
  dailyLimit: number;
  /** Max requests per visitor per day. Defaults to no per visitor daily cap. */
  perIpDaily?: number;
  now?: () => number;
}

export type LimitResult =
  | { ok: true }
  | { ok: false; reason: "ip" | "ip_daily" | "daily"; retryAfterSeconds: number };

export function createRateLimiter({
  perIpLimit,
  windowMs,
  dailyLimit,
  perIpDaily = Number.POSITIVE_INFINITY,
  now = Date.now,
}: RateLimiterOptions) {
  const hits = new Map<string, number[]>();
  const perIpToday = new Map<string, number>();
  let day = new Date(now()).toISOString().slice(0, 10);
  let dailyCount = 0;

  return {
    check(ip: string): LimitResult {
      const t = now();
      const today = new Date(t).toISOString().slice(0, 10);
      if (today !== day) {
        day = today;
        dailyCount = 0;
        hits.clear();
        perIpToday.clear();
      }
      const untilMidnight = Math.ceil((Date.parse(`${today}T00:00:00Z`) + 86_400_000 - t) / 1000);

      if (dailyCount >= dailyLimit) return { ok: false, reason: "daily", retryAfterSeconds: untilMidnight };
      if ((perIpToday.get(ip) ?? 0) >= perIpDaily) return { ok: false, reason: "ip_daily", retryAfterSeconds: untilMidnight };

      const recent = (hits.get(ip) ?? []).filter((at) => t - at < windowMs);
      if (recent.length >= perIpLimit) {
        hits.set(ip, recent);
        return { ok: false, reason: "ip", retryAfterSeconds: Math.ceil((windowMs - (t - recent[0]!)) / 1000) };
      }
      recent.push(t);
      hits.set(ip, recent);
      perIpToday.set(ip, (perIpToday.get(ip) ?? 0) + 1);
      dailyCount += 1;
      return { ok: true };
    },
  };
}
