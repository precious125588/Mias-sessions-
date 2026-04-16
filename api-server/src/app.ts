import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import { fileURLToPath } from "url";
import router from "./routes";
import pairRouter from "./routes/pair";
import qrRouter from "./routes/qr";
import { logger } from "./lib/logger";

const app: Express = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend (pair.html) at root
app.use(express.static(path.join(__dirname, "public")));

// WhatsApp pairing routes
app.use("/pair", pairRouter);
app.use("/qr", qrRouter);

// Session validation
app.post("/validate", (req: any, res: any) => {
    const { session } = req.body;
    if (!session || typeof session !== "string" || session.trim().length < 10) {
        return res.json({ valid: false, error: "Empty or too short" });
    }
    const raw = session.trim();
    try {
        // Strip prezzy_ prefix if present
        const b64 = raw.startsWith("prezzy_") ? raw.slice(7) : raw;
        const decoded = Buffer.from(b64, "base64").toString("utf8");
        const parsed = JSON.parse(decoded);

        // Resolve creds object — supports both formats:
        // 1. New (small): base64(creds.json content) — parsed IS the creds object
        // 2. Legacy (multi-file): base64({creds.json: "...", ...}) — parsed["creds.json"] is the file content
        let creds: any = null;
        if (parsed["creds.json"]) {
            creds = typeof parsed["creds.json"] === "string" ? JSON.parse(parsed["creds.json"]) : parsed["creds.json"];
        } else {
            creds = parsed; // direct creds object
        }

        const checks: Record<string, boolean> = {
            hasNoiseKey: !!creds.noiseKey,
            hasSignedIdentityKey: !!creds.signedIdentityKey,
            hasSignedPreKey: !!creds.signedPreKey,
            hasRegistrationId: typeof creds.registrationId === "number",
            isRegistered: creds.registered === true,
            hasMe: !!creds.me,
            hasAccount: !!creds.account,
        };
        const passed = Object.values(checks).filter(Boolean).length;
        const total = Object.keys(checks).length;
        const valid = passed >= 5;
        let phoneNumber: string | null = null;
        if (creds.me?.id) phoneNumber = creds.me.id.split("@")[0].split(":")[0];
        return res.json({
            valid, score: `${passed}/${total}`, phone: phoneNumber,
            registered: creds.registered || false, checks,
            message: valid ? "✅ Session is valid and ready to use!" : "❌ Session is invalid or corrupted. Generate a new one.",
        });
    } catch {
        return res.json({ valid: false, error: "Invalid format", message: "❌ Not a valid prezzy_ session string." });
    }
});

// Serve pair.html for root
app.get("/", (_req, res) => {
    res.sendFile(path.join(__dirname, "public", "pair.html"));
});

// Existing API routes
app.use("/api", router);

export default app;
              
