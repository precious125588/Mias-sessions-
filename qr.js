import express from 'express';
import fs from 'fs';
import pino from 'pino';
import { makeWASocket, useMultiFileAuthState, makeCacheableSignalKeyStore, Browsers, jidNormalizedUser, fetchLatestBaileysVersion, delay } from '@whiskeysockets/baileys';
import QRCode from 'qrcode';

const router = express.Router();

function removeFile(FilePath) {
    try {
        if (!fs.existsSync(FilePath)) return false;
        fs.rmSync(FilePath, { recursive: true, force: true });
        return true;
    } catch (e) {
        console.error('Error removing file:', e);
        return false;
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
    const sessionId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    const dirs = `./qr_sessions/session_${sessionId}`;

    if (!fs.existsSync('./qr_sessions')) {
        fs.mkdirSync('./qr_sessions', { recursive: true });
    }

    async function initiateSession() {
        if (!fs.existsSync(dirs)) fs.mkdirSync(dirs, { recursive: true });

        const { state, saveCreds } = await useMultiFileAuthState(dirs);

        try {
            const { version } = await fetchLatestBaileysVersion();
            
            let qrGenerated = false;
            let responseSent = false;

            const handleQRCode = async (qr) => {
                if (qrGenerated || responseSent) return;
                qrGenerated = true;
                console.log('🟢 QR Code Generated!');
                
                try {
                    const qrDataURL = await QRCode.toDataURL(qr, {
                        errorCorrectionLevel: 'M',
                        type: 'image/png',
                        quality: 0.92,
                        margin: 1,
                        color: { dark: '#000000', light: '#FFFFFF' }
                    });

                    if (!responseSent) {
                        responseSent = true;
                        await res.send({ 
                            qr: qrDataURL, 
                            message: 'QR Code Generated! Scan it with your WhatsApp app.',
                            instructions: [
                                '1. Open WhatsApp on your phone',
                                '2. Go to Settings > Linked Devices',
                                '3. Tap "Link a Device"',
                                '4. Scan the QR code above'
                            ]
                        });
                    }
                } catch (qrError) {
                    console.error('Error generating QR code:', qrError);
                    if (!responseSent) {
                        responseSent = true;
                        res.status(500).send({ error: 'Failed to generate QR code' });
                    }
                }
            };

            const socketConfig = {
                version,
                logger: pino({ level: 'silent' }),
                browser: Browsers.windows('Chrome'),
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

            const handleConnectionUpdate = async (update) => {
                const { connection, lastDisconnect, qr } = update;
                console.log(`🔄 Connection update: ${connection || 'undefined'}`);

                if (qr && !qrGenerated) {
                    await handleQRCode(qr);
                }

                if (connection === 'open') {
                    console.log('✅ Connected successfully via QR!');
                    reconnectAttempts = 0;
                    
                    try {
                        await delay(3000);
                        
                        // Get FULL session (all auth files as JSON → base64)
                        const sessionString = getFullSessionString(dirs);
                        
                        const userJid = sock.authState.creds.me?.id
                            ? jidNormalizedUser(sock.authState.creds.me.id) 
                            : null;
                            
                        if (userJid && sessionString) {
                            await sock.sendMessage(userJid, {
                                text: `🔐 *Your Mias MDX Session ID*\n\n\`\`\`${sessionString}\`\`\`\n\n⚠️ *IMPORTANT:* Keep this secure! Do not share it with anyone.\n\n📌 Paste this entire string as SESSION_ID in your bot's .env file`
                            });
                            console.log("📄 Session ID sent successfully to", userJid);
                            
                            await sock.sendMessage(userJid, {
                                text: `⚠️ *Security Notice*\n\nDo not share this session ID with anybody.\n\n┌┤✑  Thanks for using Mias MDX\n│└────────────┈ ⳹        \n│©2025 Mias MDX — Powered by Precious\n└─────────────────┈ ⳹\n\n`
                            });
                        } else {
                            console.log("❌ Could not determine user JID or generate session string");
                        }
                    } catch (error) {
                        console.error("Error sending session string:", error);
                    }
                    
                    setTimeout(() => {
                        console.log('🧹 Cleaning up session...');
                        removeFile(dirs);
                    }, 15000);
                }

                if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    
                    if (statusCode === 401) {
                        console.log('🔐 Logged out - need new QR code');
                        removeFile(dirs);
                    } else if (statusCode === 515 || statusCode === 503) {
                        reconnectAttempts++;
                        if (reconnectAttempts <= maxReconnectAttempts) {
                            console.log(`🔄 Reconnect attempt ${reconnectAttempts}/${maxReconnectAttempts}`);
                            setTimeout(() => {
                                try {
                                    sock = makeWASocket(socketConfig);
                                    sock.ev.on('connection.update', handleConnectionUpdate);
                                    sock.ev.on('creds.update', saveCreds);
                                } catch (err) {
                                    console.error('Failed to reconnect:', err);
                                }
                            }, 2000);
                        } else {
                            if (!responseSent) {
                                responseSent = true;
                                res.status(503).send({ error: 'Connection failed after multiple attempts' });
                            }
                        }
                    }
                }
            };

            sock.ev.on('connection.update', handleConnectionUpdate);
            sock.ev.on('creds.update', saveCreds);

        } catch (err) {
            console.error('Error initializing QR session:', err);
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
    if (e.includes("statusCode: 515")) return;
    if (e.includes("statusCode: 503")) return;
    console.log('Caught exception: ', err);
});

export default router;
