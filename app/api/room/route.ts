import { env } from "cloudflare:workers";
import { cards } from "../../../lib/catalog";
import { advanceAuctionClock, applyAction, newGame, newPlayer, publicView, RuleError, insist, log, type Game, type Action } from "../../../lib/game";
import { advanceAutomatedGame, scheduleBots } from "../../../lib/automation";

export const dynamic = "force-dynamic";
const WEEK = 7 * 24 * 60 * 60 * 1000;
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
type Row = { code: string; version: number; state: string; expires_at: number };
function randomString(length: number) { const bytes = crypto.getRandomValues(new Uint8Array(length)); return Array.from(bytes, x => alphabet[x % alphabet.length]).join(""); }
async function digest(value: string) { return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), x => x.toString(16).padStart(2, "0")).join(""); }
function token() { return `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", ""); }
function random() { return crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296; }
function response(data: unknown, status = 200) { return Response.json(data, { status, headers: { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" } }); }
function roomResponse(game: Game, playerId: string, version: number, extra: Record<string, unknown> = {}) {
  return response({ ...extra, room: publicView(game, playerId, cards), version, serverNow: Date.now() });
}
function conflictResponse() { return response({ error: "Iný hráč práve vykonal akciu. Stav sa obnoví; potom skús akciu znova." }, 409); }
function database() { if (!env.DB) throw new Error("Database binding unavailable"); return env.DB; }
function codeOf(value: unknown) { insist(typeof value === "string" && /^[A-HJ-NP-Z2-9]{6}$/.test(value.toUpperCase()), "Kód miestnosti má 6 písmen alebo číslic."); return value.toUpperCase(); }
async function findRoom(code: string): Promise<Row> {
  const row = await database().prepare("SELECT code, version, state, expires_at FROM rooms WHERE code = ?").bind(code).first<Row>();
  insist(row && row.expires_at > Date.now(), "Miestnosť neexistuje alebo už vypršala.");
  return row;
}
async function authorize(request: Request, game: Game) {
  const secret = request.headers.get("X-Player-Token");
  insist(secret && /^[a-f0-9]{64}$/.test(secret), "Pripoj sa do miestnosti alebo obnov uloženú reláciu.");
  const hash = await digest(secret);
  const player = game.players.find(p => !p.bot && p.tokenHash === hash);
  insist(player, "Táto relácia nepatrí žiadnemu hráčovi v miestnosti.");
  return player;
}
function failure(error: unknown) {
  if (error instanceof RuleError) return response({ error: error.message }, 400);
  console.error("Room request failed", error instanceof Error ? error.message : "Unknown error");
  return response({ error: "Spojenie so serverom sa nepodarilo. Skús to znova." }, 500);
}
export async function GET(request: Request) {
  try {
    const url = new URL(request.url); const code = codeOf(url.searchParams.get("code"));
    for (let attempt = 0; attempt < 12; attempt++) {
      const row = await findRoom(code); const game = JSON.parse(row.state) as Game;
      const player = await authorize(request, game);
      const settled = advanceAutomatedGame(game, cards, Date.now(), random);
      if (settled === game) return roomResponse(game, player.id, row.version);
      if (await save(row, settled)) return roomResponse(settled, player.id, row.version + 1);
    }
    return conflictResponse();
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const origin = request.headers.get("Origin");
    insist(!origin || origin === new URL(request.url).origin, "Požiadavka musí prísť z tejto stránky.");
    insist(request.headers.get("Content-Type")?.includes("application/json"), "Očakáva sa požiadavka JSON.");
    const text = await request.text(); insist(text.length <= 16000, "Požiadavka je príliš veľká.");
    let body: Record<string, unknown>;
    try { body = JSON.parse(text); } catch { throw new RuleError("Neplatná požiadavka."); }
    insist(body && !Array.isArray(body) && typeof body === "object", "Neplatná požiadavka.");
    if (body.op === "create") {
      const botCount = body.botCount ?? 0;
      insist(Number.isInteger(botCount) && Number(botCount) >= 0 && Number(botCount) <= 7, "Vyber 0 až 7 počítačových súperov.");
      const secret = token(); const player = newPlayer(crypto.randomUUID(), body.name as string, await digest(secret));
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = randomString(6); let game = newGame(code, player, (body.options || { goal: 25, selection: "random" }) as Game["options"]);
        for (let i = 0; i < Number(botCount); i++) game = applyAction(game, player.id, { type: "addBot" }, cards, random);
        const now = Date.now();
        const result = await database().prepare("INSERT OR IGNORE INTO rooms (code, version, state, updated_at, expires_at) VALUES (?, 0, ?, ?, ?)").bind(code, JSON.stringify(game), now, now + WEEK).run();
        if (result.meta.changes) return roomResponse(game, player.id, 0, { token: secret });
      }
      throw new Error("Room creation collision");
    }
    const code = codeOf(body.code);
    if (body.op === "join") {
      const secret = token(); const player = newPlayer(crypto.randomUUID(), body.name as string, await digest(secret));
      for (let attempt = 0; attempt < 12; attempt++) {
        const row = await findRoom(code); const game = JSON.parse(row.state) as Game;
        insist(game.phase === "lobby", "Partia už prebieha. Pripojenie je možné pred jej začiatkom.");
        insist(game.players.length < 8, "Miestnosť je plná. Maximum je 8 hráčov.");
        insist(!game.players.some(p => p.name.toLocaleLowerCase() === player.name.toLocaleLowerCase()), "Toto meno už niekto v miestnosti používa.");
        game.players.push(player); if (!game.hostId) game.hostId = player.id;
        log(game, `${player.name} sa pripojil do miestnosti.`);
        if (await save(row, game)) return roomResponse(game, player.id, row.version + 1, { token: secret });
      }
    } else if (body.op === "action") {
      for (let attempt = 0; attempt < 12; attempt++) {
        const row = await findRoom(code); let game = JSON.parse(row.state) as Game;
        const player = await authorize(request, game);
        const now = Date.now();
        const settled = advanceAuctionClock(game, cards, now);
        // Persist elapsed time independently, even when the requested action is rejected.
        if (settled !== game) {
          if (!await save(row, settled)) continue;
          game = settled; row.version++;
        }
        insist(typeof body.actionId === "string" && /^[a-zA-Z0-9-]{12,64}$/.test(body.actionId), "Neplatné označenie akcie.");
        const event = `${player.id}:${body.actionId}`;
        if (game.events.includes(event)) return roomResponse(game, player.id, row.version);
        const next = scheduleBots(applyAction(game, player.id, body.action as Action, cards, random, now), cards, now);
        next.events = [...next.events, event].slice(-100);
        if (await save(row, next)) {
          if (!next.players.some(p => p.id === player.id)) return response({ left: true, serverNow: Date.now() });
          return roomResponse(next, player.id, row.version + 1);
        }
      }
    } else throw new RuleError("Neznáma požiadavka.");
    return conflictResponse();
  } catch (error) { return failure(error); }
}
async function save(row: Row, game: Game) {
  const now = Date.now();
  const result = await database().prepare("UPDATE rooms SET state = ?, version = version + 1, updated_at = ?, expires_at = ? WHERE code = ? AND version = ?").bind(JSON.stringify(game), now, now + WEEK, row.code, row.version).run();
  return !!result.meta.changes;
}
