import express from 'express';
import fs from 'fs';
import pino from 'pino';
import { makeWASocket, useMultiFileAuthState, makeCacheableSignalKeyStore, Browsers, jidNormalizedUser, fetchLatestBaileysVersion, delay } from '@whiskeysockets/baileys';
import QRCode from 'qrcode';

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
    const dirs = `./qr_temp_${Date.now()}`;
    async function initiateSession() {
        if (!fs.existsSync(dirs)) fs.mkdirSync(dirs, { recursive: true });
        const { state, saveCreds } = await useMultiFileAuthState(dirs);
        try {
            const { version } = await fetchLatestBaileysVersion();
            let qrGenerated = false;
            let responseSent = false;

            const socketConfig = {
                version,
                logger: pino({ level: 'silent' }),
                browser: Browsers.ubuntu('Chrome'),
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
                },
                markOnlineOnConnect: false,
                generateHighQualityLinkPreview: false,
                defaultQueryTimeoutMs: 60000,
                connectTimeoutMs: 60000,
                keepAliveIntervalMs: 10000,
                retryRequestDelayMs: 200,
                maxRetries: 10,
                emitOwnEvents: true,
                fireInitQueries: true,
            };

            let sock = makeWASocket(socketConfig);

            sock.ev.on('connection.update', async (update) => {
                const { connection, qr } = update;
                if (qr && !qrGenerated) {
                    qrGenerated = true;
                    try {
                        const qrDataURL = await QRCode.toDataURL(qr, { errorCorrectionLevel: 'M', margin: 1 });
                        if (!responseSent) { responseSent = true; await res.send({ qr: qrDataURL, message: 'Scan QR with WhatsApp' }); }
                    } catch (e) {
                        if (!responseSent) { responseSent = true; res.status(500).send({ error: 'Failed to generate QR' }); }
                    }
                }
                if (connection === 'open') {
                    try {
                        await delay(1500);
                        await saveCreds();
                        await delay(1000);
                        const sessionString = getCredsSessionString(dirs);
                        const userJid = sock.authState.creds.me?.id ? jidNormalizedUser(sock.authState.creds.me.id) : null;
                        if (userJid && sessionString) {
                            await sock.sendMessage(userJid, { text: sessionString });
                            await delay(500);
                            await sock.sendMessage(userJid, {
                                text: `✅ *Mias MDX Session ID*\n\n☝️ The message above is your SESSION_ID.\nCopy & paste in your bot .env file.\n\n⚠️ Do NOT share!\n_Lasts 30+ days_\n\n> Powered by 𝑷𝑹𝑬𝑪𝑰𝑶𝑼𝑺 x ⚡`
                            });
                        }
                    } catch (e) { console.error("Error:", e); }
                    setTimeout(() => { try { sock.end(); } catch {} removeFile(dirs); }, 5000);
                }
                if (connection === 'close') removeFile(dirs);
            });
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
