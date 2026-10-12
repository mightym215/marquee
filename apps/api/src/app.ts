import express, { type ErrorRequestHandler, type Express, type Request, type Response } from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { z, ZodError } from "zod";
import {
  blendLoaded,
  LetterboxdError,
  loadLetterboxdDiary,
  TmdbError,
  type LetterboxdDiary,
  type TmdbClient,
} from "@marquee/tmdb-mcp";
import { conciergeRequestSchema, type ConciergeEvent, type ConciergeRequest, type ConciergeResult } from "./agent.js";
import { createRateLimiter } from "./rateLimit.js";

export interface ConciergeHooks {
  onEvent?: (event: ConciergeEvent) => void;
  signal?: AbortSignal;
}

export interface AppOptions {
  tmdb: TmdbClient;
  /** Runs the concierge agent. Null when no Anthropic key is configured. */
  concierge: ((req: ConciergeRequest, hooks?: ConciergeHooks) => Promise<ConciergeResult>) | null;
  /** Tool names the concierge can use, shown in the UI. */
  tools?: { name: string; title?: string; description?: string }[];
  demo?: boolean;
  staticDir?: string;
  limiter?: ReturnType<typeof createRateLimiter>;
  /** fetch used for Letterboxd feeds (demo mode and tests pass a fake). */
  letterboxdFetch?: typeof fetch;
}

const DIARY_TTL_MS = 10 * 60_000;
const pageParam = z.coerce.number().int().min(1).max(500).default(1);
const usernameParam = z
  .string()
  .trim()
  .min(1, "Enter a Letterboxd username")
  .max(40)
  .transform((u) => u.replace(/^@/, ""));

export function createApp(options: AppOptions): Express {
  const { tmdb, concierge, tools = [], demo = false, staticDir, letterboxdFetch } = options;
  const letterboxdLimiter = createRateLimiter({ perIpLimit: 12, windowMs: 60_000, dailyLimit: 3000 });
  const diaryCache = new Map<string, { at: number; diary: LetterboxdDiary }>();
  const limiter =
    options.limiter ??
    createRateLimiter({
      perIpLimit: Number(process.env.CONCIERGE_PER_MINUTE ?? 4),
      windowMs: 60_000,
      perIpDaily: Number(process.env.CONCIERGE_PER_VISITOR_DAILY ?? 8),
      dailyLimit: Number(process.env.CONCIERGE_DAILY_LIMIT ?? 30),
    });

  /** Loads a diary through a 10 minute cache. Only cache misses count against the rate limit. */
  async function getDiary(req: Request, username: string): Promise<LetterboxdDiary | { limited: number }> {
    const key = username.toLowerCase();
    const cached = diaryCache.get(key);
    if (cached && Date.now() - cached.at < DIARY_TTL_MS) return cached.diary;
    const limit = letterboxdLimiter.check(req.ip ?? "unknown");
    if (!limit.ok) return { limited: limit.retryAfterSeconds };
    const diary = await loadLetterboxdDiary(tmdb, username, letterboxdFetch);
    if (diaryCache.size > 500) diaryCache.delete(diaryCache.keys().next().value!);
    diaryCache.set(key, { at: Date.now(), diary });
    return diary;
  }

  function tooMany(res: Response, seconds: number, message: string) {
    res.setHeader("Retry-After", String(seconds));
    res.status(429).json({ error: message });
  }

  /** Shared checks for both concierge endpoints. Returns the parsed body, or null after responding. */
  function conciergeGate(req: Request, res: Response): ConciergeRequest | null {
    if (!concierge) {
      res.status(503).json({ error: "The concierge isn't set up yet. Add ANTHROPIC_API_KEY on the server to turn it on." });
      return null;
    }
    const body = conciergeRequestSchema.parse(req.body);
    const limit = limiter.check(req.ip ?? "unknown");
    if (!limit.ok) {
      tooMany(
        res,
        limit.retryAfterSeconds,
        limit.reason === "daily"
          ? "The concierge hit its daily limit. Browsing, Letterboxd, and Blend still work, and the concierge is back tomorrow."
          : limit.reason === "ip_daily"
            ? "You've used today's concierge questions. Browsing, Letterboxd, and Blend still work, and you get more tomorrow."
            : `That's a lot of questions at once. Try again in ${limit.retryAfterSeconds} seconds.`,
      );
      return null;
    }
    return body;
  }

  const app = express();
  app.set("trust proxy", 1); // behind Render's proxy, so req.ip is the real client
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    next();
  });
  app.use(express.json({ limit: "64kb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, demo, concierge: concierge !== null });
  });

  app.get("/api/tools", (_req, res) => {
    res.json({ tools });
  });

  app.get("/api/genres", async (_req, res) => {
    res.json({ genres: await tmdb.genres() });
  });

  app.get("/api/movies", async (req, res) => {
    const list = z.enum(["now_playing", "trending"]).default("now_playing").parse(req.query.list);
    const page = pageParam.parse(req.query.page);
    res.json(list === "trending" ? await tmdb.trending("week", page) : await tmdb.nowPlaying(page));
  });

  app.get("/api/search", async (req, res) => {
    const q = z.string().trim().min(1).max(200).parse(req.query.q);
    const page = pageParam.parse(req.query.page);
    res.json(await tmdb.search(q, { page }));
  });

  app.get("/api/movies/:id", async (req, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    res.json(await tmdb.details(id));
  });

  app.get("/api/movies/:id/recommendations", async (req, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    res.json(await tmdb.recommendations(id));
  });

  app.get("/api/letterboxd/:username", async (req, res) => {
    const diary = await getDiary(req, usernameParam.parse(req.params.username));
    if ("limited" in diary) return tooMany(res, diary.limited, `Too many imports. Try again in ${diary.limited} seconds.`);
    res.json(diary);
  });

  app.get("/api/blend", async (req, res) => {
    const a = usernameParam.parse(req.query.a);
    const b = usernameParam.parse(req.query.b);
    if (a.toLowerCase() === b.toLowerCase()) {
      res.status(400).json({ error: "Pick two different Letterboxd accounts to blend." });
      return;
    }
    const [da, db] = await Promise.all([getDiary(req, a), getDiary(req, b)]);
    if ("limited" in da || "limited" in db) {
      const wait = "limited" in da ? da.limited : (db as { limited: number }).limited;
      return tooMany(res, wait, `Too many lookups. Try again in ${wait} seconds.`);
    }
    res.json(await blendLoaded(tmdb, da, db));
  });

  app.post("/api/concierge", async (req, res) => {
    const body = conciergeGate(req, res);
    if (!body) return;
    res.json(await concierge!(body));
  });

  /**
   * Same agent, streamed as server-sent events so the UI can show each step live:
   * event "step" | "tool_start" | "tool_end", then "done" with the full result (or "error").
   */
  app.post("/api/concierge/stream", async (req, res) => {
    const body = conciergeGate(req, res);
    if (!body) return;

    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const abort = new AbortController();
    res.on("close", () => abort.abort());
    const send = (event: string, data: unknown) => {
      if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const heartbeat = setInterval(() => !res.writableEnded && res.write(": keep-alive\n\n"), 15_000);

    try {
      const result = await concierge!(body, { onEvent: (e) => send(e.type, e), signal: abort.signal });
      send("done", result);
    } catch (err) {
      console.error(err);
      send("error", { error: "The concierge hit a problem. Try asking again." });
    } finally {
      clearInterval(heartbeat);
      res.end();
    }
  });

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  if (staticDir && existsSync(staticDir)) {
    app.use("/assets", express.static(path.join(staticDir, "assets"), { maxAge: "1y", immutable: true }));
    app.use(express.static(staticDir, { maxAge: "1h", index: false }));
    app.get("/{*splat}", (_req, res) => {
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(path.join(staticDir, "index.html"));
    });
  }

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    if (res.headersSent) {
      res.end();
      return;
    }
    if (err instanceof ZodError) {
      res.status(400).json({ error: err.issues[0]?.message ?? "Invalid request" });
      return;
    }
    if (err instanceof LetterboxdError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if (err instanceof TmdbError) {
      res
        .status(err.status === 404 ? 404 : 502)
        .json({ error: err.status === 404 ? "Movie not found" : "TMDB is having trouble. Try again in a moment." });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Something went wrong on our side." });
  };
  app.use(onError);

  return app;
}
