import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pino from "pino";
import {
  makeWASocket,
  useMultiFileAuthState,
  delay,
  makeCacheableSignalKeyStore,
  Browsers,
  jidNormalizedUser,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import pn from "awesome-phonenumber";
import QRCode from "qrcode";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Helpers ────────────────────────────────────────────
function removeFile(fp) {
  try { if (fs.existsSync(fp)) fs.rmSync(fp, { recursive: true, force: true }); } catch {}
}
function getCredsSession(dir) {
  try {
    const p = dir + "/creds.json";
    if (!fs.existsSync(p)) return null;
    const d = fs.readFileSync(p, "utf8");
    JSON.parse(d);
    return "prezzy_" + Buffer.from(d).toString("base64");
  } catch { return null; }
}
const silentLogger = pino({ level: "fatal" }).child({ level: "fatal" });

// ─── Serve pair.html at root ────────────────────────────
app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "pair.html")));

// ─── Health ─────────────────────────────────────────────
app.get("/healthz", (_req, res) => res.json({ status: "ok" }));

// ─── Pair Code Route ────────────────────────────────────
app.get("/pair", async (req, res) => {
  let num = req.query.number;
  if (!num) return res.status(400).json({ error: "Missing ?number= parameter" });

  let dirs = "./" + num.replace(/[^0-9]/g, "");
  removeFile(dirs);
  num = num.replace(/[^0-9]/g, "");

  const phone = pn("+" + num);
  if (!phone.isValid()) {
    if (!res.headersSent) return res.status(400).json({ error: "Invalid phone number. Use full international format (e.g. 2348012345678)" });
    return;
  }
  num = phone.getNumber("e164").replace("+", "");

  async function initiateSession() {
    const { state, saveCreds } = await useMultiFileAuthState(dirs);
    try {
      const { version } = await fetchLatestBaileysVersion();
      let sock = makeWASocket({
        version,
        auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, silentLogger) },
        printQRInTerminal: false,
        logger: silentLogger,
        browser: Browsers.windows("Chrome"),
        markOnlineOnConnect: false,
        generateHighQualityLinkPreview: false,
        defaultQueryTimeoutMs: 60000,
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 30000,
        retryRequestDelayMs: 250,
        maxRetries: 5,
      });

      sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, isNewLogin } = update;
        if (connection === "open") {
          console.log("✅ Connected! Generating session...");
          try {
            await delay(3000);
            const sess = getCredsSession(dirs);
            if (sess) {
              const userJid = jidNormalizedUser(num + "@s.whatsapp.net");
              await sock.sendMessage(userJid, { text: sess });
              await sock.sendMessage(userJid, {
                text: `✅ *Session ID sent above* ☝️\n\nCopy the message above and paste it as *SESSION_ID* in your bot's .env file.\n\n⚠️ *Keep it private — do not share with anyone.*\n\n> ᴘᴏᴡᴇʀᴇᴅ ʙʏ *𝑷𝑹𝑬𝑪𝑰𝑶𝑼𝑺 x* ⚡`
              });
              if (!res.headersSent) res.json({ success: true, session: sess, message: "Session ID sent to your WhatsApp" });
            } else {
              if (!res.headersSent) res.status(500).json({ error: "Failed to generate session string" });
            }
            await delay(1000);
            removeFile(dirs);
          } catch (err) {
            console.error("❌ Error:", err);
            if (!res.headersSent) res.status(500).json({ error: "Error sending session" });
            removeFile(dirs);
          }
        }
        if (isNewLogin) console.log("🔐 New login via pair code");
        if (connection === "close") {
          const sc = lastDisconnect?.error?.output?.statusCode;
          if (sc === 401) console.log("❌ Logged out.");
          else { console.log("🔁 Reconnecting..."); initiateSession(); }
        }
      });

      if (!sock.authState.creds.registered) {
        await delay(3000);
        num = num.replace(/[^\d]/g, "");
        try {
          let code = await sock.requestPairingCode(num);
          code = code?.match(/.{1,4}/g)?.join("-") || code;
          if (!res.headersSent) { console.log({ num, code }); res.json({ code }); }
        } catch (err) {
          console.error("Error requesting pairing code:", err);
          if (!res.headersSent) res.status(503).json({ error: "Failed to get pairing code. Check your number and try again." });
        }
      }
      sock.ev.on("creds.update", saveCreds);
    } catch (err) {
      console.error("Error initializing session:", err);
      if (!res.headersSent) res.status(503).json({ error: "Service Unavailable" });
    }
  }
  await initiateSession();
});

// ─── QR Code Route ──────────────────────────────────────
app.get("/qr", async (_req, res) => {
  const sessionId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
  const dirs = `./qr_sessions/session_${sessionId}`;
  if (!fs.existsSync("./qr_sessions")) fs.mkdirSync("./qr_sessions", { recursive: true });

  async function initiateSession() {
    if (!fs.existsSync(dirs)) fs.mkdirSync(dirs, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(dirs);
    try {
      const { version } = await fetchLatestBaileysVersion();
      let qrGenerated = false, responseSent = false;

      const socketConfig = {
        version,
        logger: pino({ level: "silent" }),
        browser: Browsers.windows("Chrome"),
        auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, silentLogger) },
        markOnlineOnConnect: false,
        generateHighQualityLinkPreview: false,
        defaultQueryTimeoutMs: 60000,
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 30000,
        retryRequestDelayMs: 250,
        maxRetries: 5,
      };

      let sock = makeWASocket(socketConfig);
      let reconnectAttempts = 0;

      const handleUpdate = async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr && !qrGenerated) {
          qrGenerated = true;
          try {
            const qrDataURL = await QRCode.toDataURL(qr, { errorCorrectionLevel: "M", type: "image/png", quality: 0.92, margin: 1, color: { dark: "#000000", light: "#FFFFFF" } });
            if (!responseSent) { responseSent = true; res.json({ qr: qrDataURL, message: "QR Code Generated! Scan it with your WhatsApp app." }); }
          } catch (e) {
            if (!responseSent) { responseSent = true; res.status(500).json({ error: "Failed to generate QR code" }); }
          }
        }
        if (connection === "open") {
          console.log("✅ Connected via QR!");
          try {
            await delay(3000);
            const sess = getCredsSession(dirs);
            const userJid = sock.authState.creds.me?.id ? jidNormalizedUser(sock.authState.creds.me.id) : null;
            if (userJid && sess) {
              await sock.sendMessage(userJid, { text: sess });
              await sock.sendMessage(userJid, { text: `✅ *Session ID sent above* ☝️\n\nCopy the message above and paste it as *SESSION_ID* in your bot's .env file.\n\n⚠️ *Keep it private — do not share with anyone.*\n\n> ᴘᴏᴡᴇʀᴇᴅ ʙʏ *𝑷𝑹𝑬𝑪𝑰𝑶𝑼𝑺 x* ⚡` });
            }
          } catch (e) { console.error("Error sending session:", e); }
          setTimeout(() => removeFile(dirs), 15000);
        }
        if (connection === "close") {
          const sc = lastDisconnect?.error?.output?.statusCode;
          if (sc === 401) { removeFile(dirs); }
          else if ((sc === 515 || sc === 503) && ++reconnectAttempts <= 3) {
            setTimeout(() => { try { sock = makeWASocket(socketConfig); sock.ev.on("connection.update", handleUpdate); sock.ev.on("creds.update", saveCreds); } catch {} }, 2000);
          } else if (!responseSent) { responseSent = true; res.status(503).json({ error: "Connection failed" }); }
        }
      };
      sock.ev.on("connection.update", handleUpdate);
      sock.ev.on("creds.update", saveCreds);
    } catch (err) {
      if (!res.headersSent) res.status(503).json({ error: "Service Unavailable" });
    }
  }
  await initiateSession();
});

// ─── Validate Route ─────────────────────────────────────
app.post("/validate", (req, res) => {
  const { session } = req.body;
  if (!session || typeof session !== "string" || session.trim().length < 10) return res.json({ valid: false, error: "Empty or too short" });
  const raw = session.trim();
  try {
    const b64 = raw.startsWith("prezzy_") ? raw.slice(7) : raw;
    const decoded = Buffer.from(b64, "base64").toString("utf8");
    const parsed = JSON.parse(decoded);
    let creds = parsed["creds.json"] ? (typeof parsed["creds.json"] === "string" ? JSON.parse(parsed["creds.json"]) : parsed["creds.json"]) : parsed;
    const checks = {
      hasNoiseKey: !!creds.noiseKey, hasSignedIdentityKey: !!creds.signedIdentityKey, hasSignedPreKey: !!creds.signedPreKey,
      hasRegistrationId: typeof creds.registrationId === "number", isRegistered: creds.registered === true, hasMe: !!creds.me, hasAccount: !!creds.account,
    };
    const passed = Object.values(checks).filter(Boolean).length;
    const total = Object.keys(checks).length;
    const valid = passed >= 5;
    let phoneNumber = null;
    if (creds.me?.id) phoneNumber = creds.me.id.split("@")[0].split(":")[0];
    return res.json({ valid, score: `${passed}/${total}`, phone: phoneNumber, registered: creds.registered || false, checks,
      message: valid ? "✅ Session is valid and ready to use!" : "❌ Session is invalid or corrupted. Generate a new one." });
  } catch { return res.json({ valid: false, error: "Invalid format", message: "❌ Not a valid prezzy_ session string." }); }
});

// ─── Start ──────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Mias MDX running on port ${PORT}`));

// ─── Global error handler ───────────────────────────────
process.on("uncaughtException", (err) => {
  const e = String(err);
  const ignore = ["conflict","not-authorized","Socket connection timeout","rate-overlimit","Connection Closed","Timed Out","Value not found","Stream Errored","statusCode: 515","statusCode: 503"];
  if (ignore.some(i => e.includes(i))) return;
  console.log("Caught exception:", err);
});
