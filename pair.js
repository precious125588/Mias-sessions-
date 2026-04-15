import express from 'express';
import fs from 'fs';
import pino from 'pino';
import { makeWASocket, useMultiFileAuthState, delay, makeCacheableSignalKeyStore, Browsers, jidNormalizedUser, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import pn from 'awesome-phonenumber';

const router = express.Router();
const SESSION_PREFIX = "prezzy_";

function removeFile(FilePath) {
    try {
        if (!fs.existsSync(FilePath)) return false;
        fs.rmSync(FilePath, { recursive: true, force: true });
    } catch (e) {}
}

function getCredsSessionString(dirs) {
    try {
        const credsPath = dirs + '/creds.json';
        if (!fs.existsSync(credsPath)) return null;
        const credsData = fs.readFileSync(credsPath, 'utf8');
        JSON.parse(credsData);
        return SESSION_PREFIX + Buffer.from(credsData).toString('base64');
    } catch (error) {
        console.error('Error reading creds:', error);
        return null;
    }
}

router.get('/', async (req, res) => {
    let num = req.query.number;
    if (!num) {
        if (!res.headersSent) return res.status(400).send({ error: 'Missing ?number= parameter' });
        return;
    }
    let dirs = './pair_temp_' + Date.now();
    num = num.replace(/[^0-9]/g, '');

    const phone = pn('+' + num);
    if (!phone.isValid()) {
        if (!res.headersSent) return res.status(400).send({ error: 'Invalid phone number. Enter full international number (e.g., 2348012345678)' });
        return;
    }
    num = phone.getNumber('e164').replace('+', '');

    async function initiateSession() {
        const { state, saveCreds } = await useMultiFileAuthState(dirs);
        try {
            const { version } = await fetchLatestBaileysVersion();
            let sock = makeWASocket({
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

            sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect } = update;
                if (connection === 'open') {
                    try {
                        await delay(2000);
                        await saveCreds();
                        await delay(1000);
                        const sessionString = getCredsSessionString(dirs);
                        if (sessionString) {
                            const userJid = jidNormalizedUser(num + '@s.whatsapp.net');
                            await sock.sendMessage(userJid, { text: sessionString });
                            await delay(500);
                            await sock.sendMessage(userJid, {
                                text: `✅ *Mias MDX Session ID*\n\n☝️ The message above is your SESSION_ID.\nCopy it and paste in your bot .env file.\n\n⚠️ Do NOT share with anyone!\n_Session lasts 30+ days_\n\n> Powered by 𝑷𝑹𝑬𝑪𝑰𝑶𝑼𝑺 x ⚡`
                            });
                            if (!res.headersSent) {
                                await res.send({ success: true, session: sessionString, message: "Session ID sent to your WhatsApp" });
                            }
                        } else {
                            if (!res.headersSent) res.status(500).send({ error: "Failed to generate session" });
                        }
                        await delay(1000);
                        try { sock.end(); } catch {}
                        removeFile(dirs);
                    } catch (error) {
                        if (!res.headersSent) res.status(500).send({ error: "Error generating session" });
                        try { sock.end(); } catch {}
                        removeFile(dirs);
                    }
                }
                if (connection === 'close') removeFile(dirs);
            });

            if (!sock.authState.creds.registered) {
                await delay(2000);
                num = num.replace(/[^\d]/g, '');
                try {
                    let code = await sock.requestPairingCode(num);
                    code = code?.match(/.{1,4}/g)?.join('-') || code;
                    if (!res.headersSent) await res.send({ code });
                } catch (error) {
                    if (!res.headersSent) res.status(503).send({ error: 'Failed to get pairing code. Check your number.' });
                }
            }
            sock.ev.on('creds.update', saveCreds);
        } catch (err) {
            if (!res.headersSent) res.status(503).send({ error: 'Service Unavailable' });
        }
    }
    await initiateSession();
});

process.on('uncaughtException', (err) => {
    let e = String(err);
    if (e.includes("conflict") || e.includes("not-authorized") || e.includes("Socket connection timeout") ||
        e.includes("rate-overlimit") || e.includes("Connection Closed") || e.includes("Timed Out") ||
        e.includes("Value not found") || e.includes("Stream Errored") || e.includes("statusCode: 515") ||
        e.includes("statusCode: 503")) return;
    console.log('Caught exception: ', err);
});

export default router;
