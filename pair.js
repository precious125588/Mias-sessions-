import express from 'express';
import fs from 'fs';
import pino from 'pino';
import { makeWASocket, useMultiFileAuthState, delay, makeCacheableSignalKeyStore, Browsers, jidNormalizedUser, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import pn from 'awesome-phonenumber';

const router = express.Router();

function removeFile(FilePath) {
    try {
        if (!fs.existsSync(FilePath)) return false;
        fs.rmSync(FilePath, { recursive: true, force: true });
    } catch (e) {
        console.error('Error removing file:', e);
    }
}

// Encode ALL auth files as JSON → base64 (matches bot's restoreSession format)
function getFullSessionString(dirs) {
    try {
        if (!fs.existsSync(dirs)) return null;
        const files = fs.readdirSync(dirs);
        if (files.length === 0) return null;
        const sessionObj = {};
        for (const f of files) {
            const filePath = dirs + '/' + f;
            if (fs.statSync(filePath).isFile()) {
                sessionObj[f] = fs.readFileSync(filePath, 'utf8');
            }
        }
        return Buffer.from(JSON.stringify(sessionObj)).toString('base64');
    } catch (error) {
        console.error('Error reading session files:', error);
        return null;
    }
}

router.get('/', async (req, res) => {
    let num = req.query.number;
    let dirs = './' + (num || `session`);

    await removeFile(dirs);

    num = num.replace(/[^0-9]/g, '');

    const phone = pn('+' + num);
    if (!phone.isValid()) {
        if (!res.headersSent) {
            return res.status(400).send({ error: 'Invalid phone number. Please enter your full international number (e.g., 15551234567 for US, 447911123456 for UK)' });
        }
        return;
    }
    num = phone.getNumber('e164').replace('+', '');

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
                browser: Browsers.windows('Chrome'),
                markOnlineOnConnect: false,
                generateHighQualityLinkPreview: false,
                defaultQueryTimeoutMs: 60000,
                connectTimeoutMs: 60000,
                keepAliveIntervalMs: 30000,
                retryRequestDelayMs: 250,
                maxRetries: 5,
            });

            miasBot.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, isNewLogin, isOnline } = update;

                if (connection === 'open') {
                    console.log("✅ Connected successfully!");
                    console.log("📱 Generating session string for user...");
                    
                    try {
                        await delay(3000);
                        
                        // Get FULL session (all auth files as JSON → base64)
                        const sessionString = getFullSessionString(dirs);
                        
                        if (sessionString) {
                            const userJid = jidNormalizedUser(num + '@s.whatsapp.net');
                            
                            // Send session string — this IS the SESSION_ID for the bot's .env
                            await miasBot.sendMessage(userJid, {
                                text: `🔐 *Your Mias MDX Session ID*\n\n\`\`\`${sessionString}\`\`\`\n\n⚠️ *IMPORTANT:* Keep this secure! Do not share it with anyone.\n\n📌 Paste this entire string as SESSION_ID in your bot's .env file`
                            });
                            console.log("📄 Session ID sent successfully");
                            
                            await miasBot.sendMessage(userJid, {
                                text: `⚠️ *Security Notice*\n\nDo not share this session ID with anybody.\n\n┌┤✑  Thanks for using Mias MDX\n│└────────────┈ ⳹        \n│©2025 Mias MDX — Powered by Precious\n└─────────────────┈ ⳹\n\n`
                            });
                            console.log("⚠️ Warning message sent successfully");
                            
                            if (!res.headersSent) {
                                await res.send({ 
                                    success: true,
                                    session: sessionString,
                                    message: "Session ID sent to your WhatsApp number"
                                });
                            }
                        } else {
                            console.error("❌ Failed to generate session string");
                            if (!res.headersSent) {
                                res.status(500).send({ error: "Failed to generate session string" });
                            }
                        }
                        
                        console.log("🧹 Cleaning up session...");
                        await delay(1000);
                        removeFile(dirs);
                        console.log("✅ Session cleaned up successfully");
                    } catch (error) {
                        console.error("❌ Error sending session string:", error);
                        if (!res.headersSent) {
                            res.status(500).send({ error: "Error sending session string" });
                        }
                        removeFile(dirs);
                    }
                }

                if (isNewLogin) {
                    console.log("🔐 New login via pair code");
                }

                if (isOnline) {
                    console.log("📶 Client is online");
                }

                if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    if (statusCode === 401) {
                        console.log("❌ Logged out from WhatsApp. Need to generate new pair code.");
                    } else {
                        console.log("🔁 Connection closed — restarting...");
                        initiateSession();
                    }
                }
            });

            if (!miasBot.authState.creds.registered) {
                await delay(3000);
                num = num.replace(/[^\d+]/g, '');
                if (num.startsWith('+')) num = num.substring(1);

                try {
                    let code = await miasBot.requestPairingCode(num);
                    code = code?.match(/.{1,4}/g)?.join('-') || code;
                    if (!res.headersSent) {
                        console.log({ num, code });
                        await res.send({ code });
                    }
                } catch (error) {
                    console.error('Error requesting pairing code:', error);
                    if (!res.headersSent) {
                        res.status(503).send({ error: 'Failed to get pairing code. Please check your phone number and try again.' });
                    }
                }
            }

            miasBot.ev.on('creds.update', saveCreds);
        } catch (err) {
            console.error('Error initializing session:', err);
            if (!res.headersSent) {
                res.status(503).send({ error: 'Service Unavailable' });
            }
        }
    }

    await initiateSession();
});

process.on('uncaughtException', (err) => {
    let e = String(err);
    if (e.includes("conflict")) return;
    if (e.includes("not-authorized")) return;
    if (e.includes("Socket connection timeout")) return;
    if (e.includes("rate-overlimit")) return;
    if (e.includes("Connection Closed")) return;
    if (e.includes("Timed Out")) return;
    if (e.includes("Value not found")) return;
    if (e.includes("Stream Errored")) return;
    if (e.includes("Stream Errored (restart required)")) return;
    if (e.includes("statusCode: 515")) return;
    if (e.includes("statusCode: 503")) return;
    console.log('Caught exception: ', err);
});

export default router;
