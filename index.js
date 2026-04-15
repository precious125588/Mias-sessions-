import express from 'express';
import bodyParser from 'body-parser';
import { fileURLToPath } from 'url';
import path from 'path';

import pairRouter from './pair.js';
import qrRouter from './qr.js';

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 8000;

import('events').then(events => { events.EventEmitter.defaultMaxListeners = 500; });

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(__dirname));

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'pair.html')); });
app.use('/pair', pairRouter);
app.use('/qr', qrRouter);

// Session Validation
app.post('/validate', (req, res) => {
    const { session } = req.body;
    if (!session || typeof session !== 'string' || session.trim().length < 10) {
        return res.json({ valid: false, error: 'Empty or too short' });
    }
    const raw = session.trim();
    if (!raw.startsWith('prezzy_')) {
        return res.json({ valid: false, message: '❌ Session must start with prezzy_' });
    }
    try {
        const b64 = raw.slice(7); // remove "prezzy_"
        const decoded = Buffer.from(b64, 'base64').toString('utf8');
        const parsed = JSON.parse(decoded);
        const checks = {
            hasNoiseKey: !!parsed.noiseKey,
            hasSignedIdentityKey: !!parsed.signedIdentityKey,
            hasSignedPreKey: !!parsed.signedPreKey,
            hasRegistrationId: typeof parsed.registrationId === 'number',
            isRegistered: parsed.registered === true,
            hasMe: !!parsed.me,
            hasAccount: !!parsed.account,
        };
        const passed = Object.values(checks).filter(Boolean).length;
        const total = Object.keys(checks).length;
        const valid = passed >= 5;
        let phoneNumber = null;
        if (parsed.me?.id) phoneNumber = parsed.me.id.split('@')[0].split(':')[0];
        return res.json({ valid, score: `${passed}/${total}`, phone: phoneNumber, registered: parsed.registered || false, checks,
            message: valid ? '✅ Session is valid and ready to use!' : '❌ Session is invalid or corrupted. Generate a new one.' });
    } catch (e) {
        return res.json({ valid: false, error: 'Invalid format', message: '❌ Not a valid prezzy_ session string.' });
    }
});

app.listen(PORT, () => { console.log(`⚡ Mias MDX Session Server → http://localhost:${PORT}`); });
export default app;
