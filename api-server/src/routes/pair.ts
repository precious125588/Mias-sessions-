import { Router } from "express";
import fs from "fs";
import pino from "pino";
// @ts-ignore
import { makeWASocket, useMultiFileAuthState, delay, makeCacheableSignalKeyStore, Browsers, jidNormalizedUser, fetchLatestBaileysVersion } from "@whiskeysockets/baileys";
// @ts-ignore
import pn from "awesome-phonenumber";

const router = Router();

function removeFile(FilePath: string) {
    try {
        if (!fs.existsSync(FilePath)) return false;
        fs.rmSync(FilePath, { recursive: true, force: true });
    } catch (e) {
        console.error("Error removing file:", e);
    }
}

// prezzy_ prefix + base64(creds.json content only) — small, fast, matches bot format
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
    let num = req.query.number as string;
    if (!num) return res.status(400).send({ error: "Missing ?number= parameter" });

    let dirs = "./" + num.replace(/[^0-9]/g, "");

    await removeFile(dirs);

    num = num.replace(/[^0-9]/g, "");

    const phone = pn("+" + num);
    if (!phone.isValid()) {
        if (!res.headersSent) {
            return res.status(400).send({ error: "Invalid phone number. Enter your full international number (e.g., 2348012345678)" });
        }
        return;
    }
    num = phone.getNumber("e164").replace("+", "");

    async function initiateSession() {
        const { state, saveCreds } = await useMultiFileAuthState(dirs);

        try {
            const { version } = await fetchLatestBaileysVersion();
            let miasBot = makeWASocket({
                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
                },
                printQRInTerminal: false,
                logger: pino({ level: "fatal" }).child({ level: "fatal" }),
                browser: Browsers.windows("Chrome"),
                markOnlineOnConnect: false,
                generateHighQualityLinkPreview: false,
                defaultQueryTimeoutMs: 60000,
                connectTimeoutMs: 60000,
                keepAliveIntervalMs: 30000,
                retryRequestDelayMs: 250,
                maxRetries: 5,
            });

            miasBot.ev.on("connection.update", async (update: any) => {
                const { connection, lastDisconnect, isNewLogin } = update;

                if (connection === "open") {
                    console.log("✅ Connected! Generating session...");
                    try {
                        await delay(3000);
                        const sessionString = getCredsSessionString(dirs);

                        if (sessionString) {
                            const userJid = jidNormalizedUser(num + "@s.whatsapp.net");

                            // Message 1 — ONLY the session string (clean, easy to copy)
                            await miasBot.sendMessage(userJid, {
                                text: sessionString
                            });

                            // Message 2 — instructions/notice separately
                            await miasBot.sendMessage(userJid, {
                                text: `✅ *Session ID sent above* ☝️\n\nCopy the message above and paste it as *SESSION_ID* in your bot's .env file.\n\n⚠️ *Keep it private — do not share with anyone.*\n\n> ᴘᴏᴡᴇʀᴇᴅ ʙʏ *𝑷𝑹𝑬𝑪𝑰𝑶𝑼𝑺 x* ⚡`
                            });

                            console.log("📄 Session sent to WhatsApp DM");

                            if (!res.headersSent) {
                                await res.send({
                                    success: true,
                                    session: sessionString,
                                    message: "Session ID sent to your WhatsApp"
                                });
                            }
                        } else {
                            console.error("❌ Failed to generate session");
                            if (!res.headersSent) {
                                res.status(500).send({ error: "Failed to generate session string" });
                            }
                        }

                        await delay(1000);
                        removeFile(dirs);
                    } catch (error) {
                        console.error("❌ Error:", error);
                        if (!res.headersSent) {
                            res.status(500).send({ error: "Error sending session" });
                        }
                        removeFile(dirs);
                    }
                }

                if (isNewLogin) console.log("🔐 New login via pair code");

                if (connection === "close") {
                    const statusCode = (lastDisconnect as any)?.error?.output?.statusCode;
                    if (statusCode === 401) {
                        console.log("❌ Logged out. Need new pair code.");
                    } else {
                        console.log("🔁 Connection closed — restarting...");
                        initiateSession();
                    }
                }
            });

            if (!miasBot.authState.creds.registered) {
                await delay(3000);
                num = num.replace(/[^\d]/g, "");

                try {
                    let code = await miasBot.requestPairingCode(num);
                    code = code?.match(/.{1,4}/g)?.join("-") || code;
                    if (!res.headersSent) {
                        console.log({ num, code });
                        await res.send({ code });
                    }
                } catch (error) {
                    console.error("Error requesting pairing code:", error);
                    if (!res.headersSent) {
                        res.status(503).send({ error: "Failed to get pairing code. Check your number and try again." });
                    }
                }
            }

            miasBot.ev.on("creds.update", saveCreds);
        } catch (err) {
            console.error("Error initializing session:", err);
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
