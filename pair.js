import express from 'express';
import fs from 'fs';
import pino from 'pino';
import { makeWASocket, useMultiFileAuthState, delay, makeCacheableSignalKeyStore, Browsers, jidNormalizedUser, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import pn from 'awesome-phonenumber';

const router = express.Router();

// Ensure the session directory exists
function removeFile(FilePath) {
    try {
        if (!fs.existsSync(FilePath)) return false;
        fs.rmSync(FilePath, { recursive: true, force: true });
    } catch (e) {
        console.error('Error removing file:', e);
    }
}

// Function to convert creds.json to base64 session string
function getSessionString(dirs) {
    try {
        const credsPath = dirs + '/creds.json';
        if (!fs.existsSync(credsPath)) return null;
        const sessionFile = fs.readFileSync(credsPath);
        return sessionFile.toString('base64'); // Return as base64 string
    } catch (error) {
        console.error('Error reading session file:', error);
        return null;
    }
}

router.get('/', async (req, res) => {
    let num = req.query.number;
    let dirs = './' + (num || `session`);

    // Remove existing session if present
    await removeFile(dirs);

    // Clean the phone number - remove any non-digit characters
    num = num.replace(/[^0-9]/g, '');

    // Validate the phone number using awesome-phonenumber
    const phone = pn('+' + num);
    if (!phone.isValid()) {
        if (!res.headersSent) {
            return res.status(400).send({ error: 'Invalid phone number. Please enter your full international number (e.g., 15551234567 for US, 447911123456 for UK)' });
        }
        return;
    }
    // Use the international number format (E.164, without '+')
    num = phone.getNumber('e164').replace('+', '');

    async function initiateSession() {
        const { state, saveCreds } = await useMultiFileAuthState(dirs);

        try {
            const { version, isLatest } = await fetchLatestBaileysVersion();
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
                        // Wait a moment for creds to be fully saved
                        await delay(2000);
                        
                        // Get session string from creds.json
                        const sessionString = getSessionString(dirs);
                        
                        if (sessionString) {
                            const userJid = jidNormalizedUser(num + '@s.whatsapp.net');
                            
                            // Format session as "mias-xmd [base64-string]"
                            const formattedSession = `mias-xmd ${sessionString}`;
                            
                            // Send formatted session string as text message
                            await miasBot.sendMessage(userJid, {
                                text: `🔐 *Your mias-xmd Session String*\n\n\`\`\`${formattedSession}\`\`\`\n\n⚠️ *IMPORTANT:* Keep this string secure! Do not share it with anyone.\n\n📌 Copy the entire string starting with "mias-xmd"`
                            });
                            console.log("📄 Formatted session string sent successfully");
                            
                            // Send warning message
                            await miasBot.sendMessage(userJid, {
                                text: `⚠️ *Security Notice*\n\nDo not share this session string with anybody.\n\n┌┤✑  Thanks for using mias-xmd\n│└────────────┈ ⳹        \n│©2025 mias-xmd \n└─────────────────┈ ⳹\n\n`
                            });
                            console.log("⚠️ Warning message sent successfully");
                            
                            // Also return formatted session in API response
                            if (!res.headersSent) {
                                await res.send({ 
                                    success: true,
                                    session: formattedSession,
                                    message: "Session string sent to your WhatsApp number"
                                });
                            }
                        } else {
                            console.error("❌ Failed to generate session string");
                            if (!res.headersSent) {
                                res.status(500).send({ error: "Failed to generate session string" });
                            }
                        }
                        
                        // Clean up session after use
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

// Global uncaught exception handler
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