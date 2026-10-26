import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import OpenAI from "openai";
import Database from "better-sqlite3";
import path from "node:path";
import { timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "200kb" }));
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

const PORT = process.env.PORT || 3000;
const TEAM_ACCESS_CODE = process.env.TEAM_ACCESS_CODE;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!TEAM_ACCESS_CODE) console.warn("WARNING: TEAM_ACCESS_CODE is not set. API access will be denied.");
if (!OPENAI_API_KEY) console.warn("WARNING: OPENAI_API_KEY is not set. AI chat will not work.");

const db = new Database(process.env.DB_PATH || path.join(__dirname, "team-checklist.sqlite"));
db.pragma("journal_mode = WAL");
db.exec(`
 CREATE TABLE IF NOT EXISTS shared_state (
   id INTEGER PRIMARY KEY CHECK (id = 1),
   json TEXT NOT NULL,
   updated_at TEXT NOT NULL
 );
 INSERT OR IGNORE INTO shared_state(id,json,updated_at) VALUES(1,'{"checks":{},"assignees":{},"meta":{}}',CURRENT_TIMESTAMP);
`);
const readState = db.prepare("SELECT json, updated_at FROM shared_state WHERE id=1");
const writeState = db.prepare("UPDATE shared_state SET json=?, updated_at=? WHERE id=1");
const limiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: "draft-7", legacyHeaders: false });
app.use("/api", limiter);

function auth(req, res, next) {
  if (!TEAM_ACCESS_CODE) return res.status(503).json({ error: "Team access is not configured on the server." });
  const supplied = req.get("X-Team-Code") || "";
  // Constant-time comparison for the shared team code.
  const a = Buffer.from(supplied);
  const b = Buffer.from(TEAM_ACCESS_CODE);
  if (a.length !== b.length || !a.length || !timingSafeEqual(a, b)) {
    return res.status(401).json({ error: "Invalid team access code." });
  }
  next();
}
function cleanState(value) {
  if (!value || typeof value !== "object") throw new Error("State must be an object.");
  const checks = value.checks && typeof value.checks === "object" ? value.checks : {};
  const assignees = value.assignees && typeof value.assignees === "object" ? value.assignees : {};
  const meta = value.meta && typeof value.meta === "object" ? value.meta : {};
  // Keep payload compact and only accept basic checklist values.
  const safeChecks = {};
  for (const [k,v] of Object.entries(checks).slice(0,1500)) {
    if (/^[a-z0-9-]{1,100}$/i.test(k)) safeChecks[k] = Boolean(v);
  }
  const names = new Set(["Brennan Pays","Carter Mcilwain","Fletcher Hamilton","Jay Versochoyle","Micheal Glass","Ryan Ecker","Spencer Brooks","Trey Adams","Copeland Brown","Trey Parker","Alex Hansen"]);
  const safeAssignees = {};
  for (const [k,v] of Object.entries(assignees).slice(0,1500)) {
    if (/^[a-z0-9-]{1,100}$/i.test(k) && names.has(v)) safeAssignees[k] = v;
  }
  const safeMeta = {};
  for (const k of ["eventName","tipTime","managerName","completedBy","verifiedBy","notes"]) {
    if (typeof meta[k] === "string") safeMeta[k] = meta[k].slice(0,250);
  }
  return { checks: safeChecks, assignees: safeAssignees, meta: safeMeta };
}
app.get("/api/state", auth, (req, res) => {
  const row = readState.get();
  res.json({ state: JSON.parse(row.json), updatedAt: row.updated_at });
});
app.put("/api/state", auth, (req, res) => {
  try {
    const state = cleanState(req.body?.state);
    writeState.run(JSON.stringify(state), new Date().toISOString());
    res.json({ ok: true, updatedAt: new Date().toISOString() });
  } catch {
    res.status(400).json({ error: "Invalid checklist state." });
  }
});
app.post("/api/chat", auth, async (req, res) => {
  if (!OPENAI_API_KEY) return res.status(503).json({ error: "AI chat is not configured. The administrator must set OPENAI_API_KEY on the server." });
  const question = typeof req.body?.question === "string" ? req.body.question.trim().slice(0,1000) : "";
  if (!question) return res.status(400).json({ error: "Enter a question." });
  // Use server-held current state as authority; don't trust a browser-supplied snapshot.
  const current = JSON.parse(readState.get().json);
  const snapshot = req.body?.snapshot && typeof req.body.snapshot === "object" ? req.body.snapshot : {};
  const safeHistory = Array.isArray(req.body?.history) ? req.body.history.slice(-8).filter(m =>
    m && ["user","assistant"].includes(m.role) && typeof m.content === "string"
  ).map(m => ({ role:m.role, content:m.content.slice(0,1000) })) : [];
  // Server state is authoritative for completion and assignments. Client provides the static manual/schedule facts.
  const tasks = Array.isArray(snapshot.tasks) ? snapshot.tasks.slice(0,1500).map(t => ({
    section: String(t.section||"").slice(0,120),
    taskId: String(t.taskId||"").slice(0,100),
    stage: String(t.stage||"").slice(0,120),
    task: String(t.task||"").slice(0,300),
    complete: Boolean(current.checks?.[t.taskId]),
    assignedTo: current.assignees?.[t.taskId] || null
  })) : [];
  const games = Array.isArray(snapshot.games) ? snapshot.games.slice(0,40) : [];
  const event = current.meta?.eventName || null;
  const tipoff = current.meta?.tipTime || null;
  const system = `You are the Ole Miss Men's Basketball Manager Assistant for the 2026-27 season. Answer manager questions using only the supplied checklist and schedule facts. Use concise, direct language.
Rules:
- Treat the current server checklist state as the source of truth for completion and assignments.
- Never say a task is done unless the recorded checkbox is complete. Say "not recorded as complete" when appropriate.
- For "what's coming up", use the schedule dates and event/tipoff fields. Current date is supplied by runtime context only if available; if you cannot determine which event is next from the provided date, ask which game or explain the limitation.
- Never invent official procedures, times, owners, assignments, or missing details. The final page of the uploaded master checklist was unreadable, so its game-day assignment details are unknown.
- The Director of Operations' official itinerary overrides times in this app.
- The source checklist says scouting reports, play cards, injuries, and internal plans are confidential. Do not ask for or reveal confidential content. This app should not be used to store such information.
- If asked to take an action such as marking a task complete, explain that you can answer questions but the user must update the task checkbox in the app.
- Do not claim to have access to anything outside the supplied schedule and checklist data.
Current date in the team's likely Central Time zone: ${new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())}.
Current selected event: ${event || "not set"}.
Current selected tipoff: ${tipoff || "not set"}.
Checklist tasks JSON: ${JSON.stringify(tasks)}
Schedule JSON: ${JSON.stringify(games)}`;
  try {
    const client = new OpenAI({ apiKey: OPENAI_API_KEY });
    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      messages: [{role:"system",content:system}, ...safeHistory, {role:"user",content:question}],
      temperature: 0.2,
      max_tokens: 700
    });
    res.json({ answer: completion.choices[0]?.message?.content || "I couldn't produce an answer. Please try again." });
  } catch (err) {
    console.error("AI request failed:", err?.message || "unknown error");
    res.status(502).json({ error: "The AI service could not answer right now. Try again shortly." });
  }
});
app.get("/api/health", (req,res)=>res.json({ok:true,aiConfigured:Boolean(OPENAI_API_KEY),teamAccessConfigured:Boolean(TEAM_ACCESS_CODE)}));
app.get("*", (req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
app.listen(PORT, ()=>console.log(`Ole Miss Manager Assistant listening on port ${PORT}`));
