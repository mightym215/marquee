import { createFixtureFetch, createTmdbClient } from "@marquee/tmdb-mcp";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { ConciergeResult } from "../src/agent.js";
import { createApp } from "../src/app.js";
import { createRateLimiter } from "../src/rateLimit.js";

const fixtureFetch = createFixtureFetch();
const tmdb = createTmdbClient({ apiKey: "test", fetch: fixtureFetch });
const fakeResult: ConciergeResult = { reply: "hi", picks: [], trace: [], steps: 1, usage: { inputTokens: 1, outputTokens: 1 }, droppedPicks: 0, ms: 5 };

describe("API", () => {
  const app = createApp({ tmdb, concierge: null });

  it("reports health and whether the concierge is on", async () => {
    const res = await request(app).get("/api/health");
    expect(res.body).toEqual({ ok: true, demo: false, concierge: false });
  });

  it("lists now playing and trending movies", async () => {
    const res = await request(app).get("/api/movies?list=trending");
    expect(res.status).toBe(200);
    expect(res.body.movies.length).toBeGreaterThan(3);
    expect(res.body.movies[0]).toHaveProperty("genres");
  });

  it("searches and rejects empty queries", async () => {
    expect((await request(app).get("/api/search?q=arrival")).body.movies[0].title).toBe("Arrival");
    expect((await request(app).get("/api/search?q=")).status).toBe(400);
  });

  it("returns details and a clean 404", async () => {
    expect((await request(app).get("/api/movies/496243")).body.director).toBe("Bong Joon Ho");
    const missing = await request(app).get("/api/movies/1");
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe("Movie not found");
  });

  it("imports a Letterboxd diary matched to TMDB, and caches it", async () => {
    const spy = vi.fn(fixtureFetch);
    const lb = createApp({ tmdb, concierge: null, letterboxdFetch: spy });
    const res = await request(lb).get("/api/letterboxd/@michael");
    expect(res.status).toBe(200);
    expect(res.body.username).toBe("michael");
    expect(res.body.films[0]).toMatchObject({ title: "Arrival", rating: 5, liked: true, movie: { id: 329865 } });
    await request(lb).get("/api/letterboxd/Michael");
    expect(spy.mock.calls.filter(([u]) => String(u).includes("letterboxd.com"))).toHaveLength(1);
  });

  it("returns clear Letterboxd errors", async () => {
    const lb = createApp({ tmdb, concierge: null, letterboxdFetch: fixtureFetch });
    const missing = await request(lb).get("/api/letterboxd/nobody");
    expect(missing.status).toBe(404);
    expect(missing.body.error).toMatch(/No public Letterboxd profile/);
    expect((await request(lb).get("/api/letterboxd/bad%20name!")).status).toBe(400);
  });

  it("blends two Letterboxd diaries for movie night", async () => {
    const lb = createApp({ tmdb, concierge: null, letterboxdFetch: fixtureFetch });
    const res = await request(lb).get("/api/blend?a=michael&b=@friend");
    expect(res.status).toBe(200);
    expect(res.body.people.map((p: { username: string }) => p.username)).toEqual(["michael", "friend"]);
    expect(res.body.picks.length).toBeGreaterThan(0);
    expect((await request(lb).get("/api/blend?a=michael&b=Michael")).status).toBe(400);
    expect((await request(lb).get("/api/blend?a=michael")).status).toBe(400);
  });

  it("streams concierge progress as server-sent events", async () => {
    const concierge = vi.fn(async (_req, hooks?: { onEvent?: (e: unknown) => void }) => {
      hooks?.onEvent?.({ type: "step", step: 1 });
      hooks?.onEvent?.({ type: "tool_start", id: "t1", tool: "search_movies", args: { query: "Arrival" } });
      hooks?.onEvent?.({ type: "tool_end", id: "t1", tool: "search_movies", ok: true, ms: 12, summary: "1 movie" });
      return fakeResult;
    });
    const app2 = createApp({ tmdb, concierge });
    const res = await request(app2).post("/api/concierge/stream").send({ message: "like Arrival" });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/event-stream/);
    const events = [...res.text.matchAll(/event: (\w+)/g)].map((m) => m[1]);
    expect(events).toEqual(["step", "tool_start", "tool_end", "done"]);
    expect(res.text).toContain('"reply":"hi"');
  });

  it("streams a friendly error event when the agent fails", async () => {
    const app2 = createApp({ tmdb, concierge: async () => { throw new Error("boom"); } });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await request(app2).post("/api/concierge/stream").send({ message: "hi" });
    errSpy.mockRestore();
    expect(res.text).toMatch(/event: error/);
    expect(res.text).not.toContain("boom");
  });

  it("sets basic security headers", async () => {
    const res = await request(app).get("/api/health");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");
  });

  it("explains when the concierge is not configured", async () => {
    const res = await request(app).post("/api/concierge").send({ message: "hi" });
    expect(res.status).toBe(503);
  });

  it("validates concierge input and rate limits it", async () => {
    const concierge = vi.fn(async () => fakeResult);
    const limited = createApp({
      tmdb,
      concierge,
      limiter: createRateLimiter({ perIpLimit: 2, windowMs: 60_000, dailyLimit: 100 }),
    });
    expect((await request(limited).post("/api/concierge").send({ message: "" })).status).toBe(400);
    expect((await request(limited).post("/api/concierge").send({ message: "one" })).status).toBe(200);
    expect((await request(limited).post("/api/concierge").send({ message: "two" })).status).toBe(200);
    const third = await request(limited).post("/api/concierge").send({ message: "three" });
    expect(third.status).toBe(429);
    expect(third.headers["retry-after"]).toBeDefined();
    expect(concierge).toHaveBeenCalledTimes(2);
  });
});

describe("rate limiter", () => {
  it("caps each visitor per day so one person can't use up the whole day", () => {
    const t = Date.parse("2026-10-11T12:00:00Z");
    const limiter = createRateLimiter({ perIpLimit: 100, windowMs: 1000, perIpDaily: 2, dailyLimit: 30, now: () => t });
    expect(limiter.check("a").ok).toBe(true);
    expect(limiter.check("a").ok).toBe(true);
    expect(limiter.check("a")).toMatchObject({ ok: false, reason: "ip_daily" });
    expect(limiter.check("b").ok).toBe(true);
  });

  it("enforces a daily cap across all users and resets the next day", () => {
    let t = Date.parse("2026-10-11T12:00:00Z");
    const limiter = createRateLimiter({ perIpLimit: 10, windowMs: 1000, dailyLimit: 2, now: () => t });
    expect(limiter.check("a").ok).toBe(true);
    expect(limiter.check("b").ok).toBe(true);
    expect(limiter.check("c")).toMatchObject({ ok: false, reason: "daily" });
    t = Date.parse("2026-10-12T00:00:01Z");
    expect(limiter.check("c").ok).toBe(true);
  });
});
