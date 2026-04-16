import { Router } from "express";
import fs from "fs";
import pino from "pino";
// @ts-ignore
import { makeWASocket, useMultiFileAuthState, makeCacheableSignalKeyStore, Browsers, jidNormalizedUser, fetchLatestBaileysVersion, delay } from "@whiskeysockets/baileys";
import QRCode from "qrcode";

const router = Router();

function removeFile(FilePath: string) {
    try {
        if (!fs.existsSync(FilePath)) return false;
        fs.rmSync(FilePath, { recursive: true, force: true });
        return true;
    } catch (e) {
        console.error("Error removing file:", e);
        return false;
    }
}

// prezzy_ prefix + base64(creds.json only) — small, fast, matches bot format
function getCredsSessionString(dirs: string): string | null {
    try {
        const credsPath = dirs + "/creds.json";
        if (!fs.existsSync(credsPath)) return null;
        const credsData = fs.readFileSync(credsPath, "utf8");
        JSON.parse(credsData); // validate
        return "prezzy_" + Buffer.from(credsData).toString("base64");
    } catch (error) {
        console.error("Error reading creds:", error);
        return null;
    }
}

router.get("/", async (req: any, res: any) => {
    const sessionId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    const dirs = `./qr_sessions/session_${sessionId}`;

    if (!fs.existsSync("./qr_sessions")) {
        fs.mkdirSync("./qr_sessions", { recursive: true });
    }

    async function initiateSession() {
        if (!fs.existsSync(dirs)) fs.mkdirSync(dirs, { recursive: true });

        const { state, saveCreds } = await useMultiFileAuthState(dirs);

        try {
            const { version } = await fetchLatestBaileysVersion();

            let qrGenerated = false;
            let responseSent = false;

            const handleQRCode = async (qr: string) => {
                if (qrGenerated || responseSent) return;
                qrGenerated = true;
                console.log("🟢 QR Code Generated!");

                try {
                    const qrDataURL = await QRCode.toDataURL(qr, {
                        errorCorrectionLevel: "M",
                        type: "image/png",
                        quality: 0.92,
                        margin: 1,
                        color: { dark: "#000000", light: "#FFFFFF" }
                    });

                    if (!responseSent) {
                        responseSent = true;
                        await res.send({
                            qr: qrDataURL,
                            message: "QR Code Generated! Scan it with your WhatsApp app.",
                        });
                    }
                } catch (qrError) {
                    console.error("Error generating QR code:", qrError);
                    if (!responseSent) {
                        responseSent = true;
                        res.status(500).send({ error: "Failed to generate QR code" });
                    }
                }
            };

            const socketConfig: any = {
                version,
                logger: pino({ level: "silent" }),
                browser: Browsers.windows("Chrome"),
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
                },
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
            const maxReconnectAttempts = 3;

            const handleConnectionUpdate = async (update: any) => {
                const { connection, lastDisconnect, qr } = update;

                if (qr && !qrGenerated) {
                    await handleQRCode(qr);
                }

                if (connection === "open") {
                    console.log("✅ Connected via QR! Generating session...");
                    reconnectAttempts = 0;

                    try {
                        await delay(3000);
                        const sessionString = getCredsSessionString(dirs);

                        const userJid = sock.authState.creds.me?.id
                            ? jidNormalizedUser(sock.authState.creds.me.id)
                            : null;

                        if (userJid && sessionString) {
                            // Message 1 — ONLY the session string (clean, easy to copy)
                            await sock.sendMessage(userJid, {
                                text: sessionString
                            });

                            // Message 2 — instructions separately
                            await sock.sendMessage(userJid, {
                                text: `✅ *Session ID sent above* ☝️\n\nCopy the message above and paste it as *SESSION_ID* in your bot's .env file.\n\n⚠️ *Keep it private — do not share with anyone.*\n\n> ᴘᴏᴡᴇʀᴇᴅ ʙʏ *𝑷𝑹𝑬𝑪𝑰𝑶𝑼𝑺 x* ⚡`
                            });

                            console.log("📄 Session sent to WhatsApp DM:", userJid);
                        } else {
                            console.log("❌ Could not determine user JID or generate session");
                        }
                    } catch (error) {
                        console.error("Error sending session:", error);
                    }

                    setTimeout(() => {
                        console.log("🧹 Cleaning up session...");
                        removeFile(dirs);
                    }, 15000);
                }

                if (connection === "close") {
                    const statusCode = (lastDisconnect as any)?.error?.output?.statusCode;

                    if (statusCode === 401) {
                        console.log("🔐 Logged out - need new QR code");
                        removeFile(dirs);
                    } else if (statusCode === 515 || statusCode === 503) {
                        reconnectAttempts++;
                        if (reconnectAttempts <= maxReconnectAttempts) {
                            console.log(`🔄 Reconnect attempt ${reconnectAttempts}/${maxReconnectAttempts}`);
                            setTimeout(() => {
                                try {
                                    sock = makeWASocket(socketConfig);
                                    sock.ev.on("connection.update", handleConnectionUpdate);
                                    sock.ev.on("creds.update", saveCreds);
                                } catch (err) {
                                    console.error("Failed to reconnect:", err);
                                }
                            }, 2000);
                        } else {
                            if (!responseSent) {
                                responseSent = true;
                                res.status(503).send({ error: "Connection failed after multiple attempts" });
                            }
                        }
                    }
                }
            };

            sock.ev.on("connection.update", handleConnectionUpdate);
            sock.ev.on("creds.update", saveCreds);

        } catch (err) {
            console.error("Error initializing QR session:", err);
            if (!res.headersSent) {
                res.status(503).send({ error: "Service Unavailable" });
            }
        }
    }

    await initiateSession();
});

process.on("uncaughtException", (err) => {
    const e = String(err);
    if (e.includes("conflict")) return;
    if (e.includes("not-authorized")) return;
    if (e.includes("Socket connection timeout")) return;
    if (e.includes("rate-overlimit")) return;
    if (e.includes("Connection Closed")) return;
    if (e.includes("Timed Out")) return;
    if (e.includes("Value not found")) return;
    if (e.includes("Stream Errored")) return;
    if (e.includes("statusCode: 515")) return;
    if (e.includes("statusCode: 503")) return;
    console.log("Caught exception:", err);
});

export default router;
