MIAS MDX — WhatsApp Session Generator (Pairing Site)
=====================================================

FOLDER STRUCTURE:
  api-server/   — Node.js + Express backend (TypeScript). Handles /pair, /qr, /validate
  whatsapp-pairing/  — React + Vite frontend

HOW TO DEPLOY (e.g. Render, Railway, Koyeb):
  1. Deploy api-server as a Node.js service
     - Build: pnpm install && pnpm run build
     - Start: pnpm run start
     - Port: 8080
  2. Deploy whatsapp-pairing as a static site
     - Build: pnpm install && pnpm run build
     - Dist folder: dist/
     - Set env VITE_API_URL to your api-server URL

SESSION FORMAT:
  prezzy_ + base64(creds.json content)
  This is the small, fast format compatible with MIAS-MDX-Bot.

HOW SESSION IS DELIVERED:
  When a user pairs, two WhatsApp messages are sent:
    Message 1: Just the session ID (easy to long-press and copy)
    Message 2: Instructions and warning
