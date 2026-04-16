import { useState, useRef, KeyboardEvent } from "react";

type Tab = "pair" | "qr" | "validate";

interface CheckResult {
  valid: boolean;
  score?: string;
  phone?: string;
  registered?: boolean;
  checks?: Record<string, boolean>;
  message?: string;
  error?: string;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>("pair");

  // Pair tab state
  const [pairNum, setPairNum] = useState("");
  const [pairLoading, setPairLoading] = useState(false);
  const [pairLoadingText, setPairLoadingText] = useState("Connecting to WhatsApp...");
  const [pairCode, setPairCode] = useState("");
  const [pairSession, setPairSession] = useState("");
  const [pairMsg, setPairMsg] = useState<{ text: string; color: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const loadingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // QR tab state
  const [qrLoading, setQrLoading] = useState(false);
  const [qrDataURL, setQrDataURL] = useState("");
  const [qrMsg, setQrMsg] = useState<{ text: string; color: string } | null>(null);
  const [qrCopied, setQrCopied] = useState(false);

  // Validate tab state
  const [validateInput, setValidateInput] = useState("");
  const [valLoading, setValLoading] = useState(false);
  const [valResult, setValResult] = useState<CheckResult | null>(null);

  async function getPairCode() {
    const num = pairNum.replace(/[^0-9]/g, "");
    if (!num || num.length < 7) {
      setPairMsg({ text: "❌ Enter a valid phone number (with country code)", color: "#ff4757" });
      return;
    }
    setPairLoading(true);
    setPairMsg(null);
    setPairCode("");
    setPairSession("");
    setCopied(false);

    const msgs = ["Connecting to WhatsApp...", "Requesting pairing code...", "Waiting for WhatsApp response...", "Almost there...", "Still working, please wait..."];
    let idx = 0;
    setPairLoadingText(msgs[0]);
    loadingIntervalRef.current = setInterval(() => {
      idx = (idx + 1) % msgs.length;
      setPairLoadingText(msgs[idx]);
    }, 3000);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 90000);
      const r = await fetch("/pair?number=" + encodeURIComponent(num), { signal: controller.signal });
      clearTimeout(timeout);
      const d = await r.json();
      if (d.code) {
        setPairCode(d.code);
        setPairMsg({ text: "📱 Open WhatsApp → Linked Devices → Link with phone number → Enter the code above", color: "#00c896" });
      } else if (d.session) {
        setPairSession(d.session);
        setPairMsg({ text: "✅ Session generated! Also sent to your WhatsApp.", color: "#00c896" });
      } else if (d.error) {
        setPairMsg({ text: "❌ " + d.error, color: "#ff4757" });
      } else {
        setPairMsg({ text: "❌ Unexpected response. Please try again.", color: "#ff4757" });
      }
    } catch (e: any) {
      if (e?.name === "AbortError") {
        setPairMsg({ text: "❌ Request timed out. Please try again.", color: "#ff4757" });
      } else {
        setPairMsg({ text: "❌ Connection error. Please try again.", color: "#ff4757" });
      }
    }
    if (loadingIntervalRef.current) clearInterval(loadingIntervalRef.current);
    setPairLoading(false);
  }

  async function getQR() {
    setQrLoading(true);
    setQrMsg(null);
    setQrDataURL("");
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 90000);
      const r = await fetch("/qr", { signal: controller.signal });
      clearTimeout(timeout);
      const d = await r.json();
      if (d.qr) {
        setQrDataURL(d.qr);
        setQrMsg({ text: "📱 Scan now. Your session will be sent to your WhatsApp once linked.", color: "#00c896" });
      } else if (d.error) {
        setQrMsg({ text: "❌ " + d.error, color: "#ff4757" });
      } else {
        setQrMsg({ text: "❌ Could not generate QR. Try again.", color: "#ff4757" });
      }
    } catch (e: any) {
      if (e?.name === "AbortError") {
        setQrMsg({ text: "❌ Request timed out. Try again.", color: "#ff4757" });
      } else {
        setQrMsg({ text: "❌ Connection error. Try again.", color: "#ff4757" });
      }
    }
    setQrLoading(false);
  }

  async function validateSession() {
    const s = validateInput.trim();
    if (!s) {
      setValResult({ valid: false, error: "Paste a session string first" });
      return;
    }
    setValLoading(true);
    setValResult(null);
    try {
      const r = await fetch("/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session: s }),
      });
      const d = await r.json();
      setValResult(d);
    } catch {
      setValResult({ valid: false, error: "Error validating session" });
    }
    setValLoading(false);
  }

  function copyText(text: string, setCopiedFn: (v: boolean) => void) {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedFn(true);
      setTimeout(() => setCopiedFn(false), 2000);
    }).catch(() => {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopiedFn(true);
      setTimeout(() => setCopiedFn(false), 2000);
    });
  }

  const checkLabels: Record<string, string> = {
    hasNoiseKey: "Noise Key",
    hasSignedIdentityKey: "Identity Key",
    hasSignedPreKey: "Pre Key",
    hasRegistrationId: "Registration ID",
    isRegistered: "Registered",
    hasMe: "Account Info",
    hasAccount: "Account Data",
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');
        :root{--bg:#0a0a0f;--surface:#12121a;--surface-hover:#1a1a28;--border:rgba(255,255,255,0.06);--border-focus:rgba(0,200,150,0.5);--text:#e8e8ef;--text-muted:rgba(255,255,255,0.45);--accent:#00c896;--accent-glow:rgba(0,200,150,0.15);--gradient-1:linear-gradient(135deg,#00c896 0%,#00b4d8 100%);--radius:16px}
        *{margin:0;padding:0;box-sizing:border-box}
        body{font-family:'Space Grotesk',sans-serif;background:var(--bg);color:var(--text);min-height:100vh;display:flex;justify-content:center;align-items:center;padding:16px}
        body::before{content:'';position:fixed;top:-50%;left:-50%;width:200%;height:200%;background:radial-gradient(circle at 30% 20%,rgba(0,200,150,0.04) 0%,transparent 50%),radial-gradient(circle at 70% 80%,rgba(0,180,216,0.03) 0%,transparent 50%);pointer-events:none;z-index:0}
        @keyframes pulse-ring{0%,100%{opacity:0.4;transform:scale(1)}50%{opacity:0.7;transform:scale(1.05)}}
        @keyframes blink{0%,100%{opacity:1}50%{opacity:0.3}}
        @keyframes spin{to{transform:rotate(360deg)}}
      `}</style>

      <div style={{ width: "100%", maxWidth: 440, background: "var(--surface)", borderRadius: "var(--radius)", padding: "32px 28px", border: "1px solid var(--border)", position: "relative", zIndex: 1, boxShadow: "0 0 80px rgba(0,200,150,0.03), 0 20px 60px rgba(0,0,0,0.4)" }}>

        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ width: 80, height: 80, margin: "0 auto 18px", position: "relative" }}>
            <div style={{ position: "absolute", inset: -4, borderRadius: "50%", background: "var(--gradient-1)", opacity: 0.6, animation: "pulse-ring 3s ease-in-out infinite" }} />
            <div style={{ width: 80, height: 80, background: "var(--bg)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 30, position: "relative", zIndex: 1, color: "var(--accent)" }}>
              <svg viewBox="0 0 24 24" fill="currentColor" width="34" height="34"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
            </div>
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 700, background: "var(--gradient-1)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>Mias MDX</h1>
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 6, letterSpacing: 2, textTransform: "uppercase" }}>Session Generator</p>
        </div>

        {/* Status badge */}
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: "var(--accent-glow)", color: "var(--accent)", letterSpacing: 0.5, textTransform: "uppercase" }}>
            <span style={{ width: 6, height: 6, background: "var(--accent)", borderRadius: "50%", animation: "blink 2s ease-in-out infinite", display: "inline-block" }} />
            Online &amp; Ready
          </span>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", background: "var(--bg)", borderRadius: 12, padding: 4, marginBottom: 24, border: "1px solid var(--border)" }}>
          {(["pair", "qr", "validate"] as Tab[]).map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)} style={{ flex: 1, padding: "11px 8px", textAlign: "center", cursor: "pointer", borderRadius: 9, fontSize: 12, fontWeight: 600, color: activeTab === tab ? "#000" : "var(--text-muted)", background: activeTab === tab ? "var(--accent)" : "transparent", border: "none", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, transition: "all 0.3s", boxShadow: activeTab === tab ? "0 4px 20px rgba(0,200,150,0.25)" : "none" }}>
              {tab === "pair" ? "🔗" : tab === "qr" ? "📱" : "🛡️"} {tab === "pair" ? "Pair Code" : tab === "qr" ? "QR Code" : "Validate"}
            </button>
          ))}
        </div>

        {/* Pair Tab */}
        {activeTab === "pair" && (
          <div>
            <label style={{ display: "block", marginBottom: 8, fontWeight: 500, fontSize: 12, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 1 }}>📞 Phone Number</label>
            <input
              value={pairNum}
              onChange={e => setPairNum(e.target.value)}
              onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => e.key === "Enter" && getPairCode()}
              placeholder="2348012345678"
              maxLength={15}
              style={{ width: "100%", padding: "14px 16px", border: "1.5px solid var(--border)", borderRadius: 12, background: "var(--bg)", color: "var(--text)", fontSize: 16, fontFamily: "'JetBrains Mono', monospace", fontWeight: 500, outline: "none", transition: "all 0.3s" }}
            />
            <button onClick={getPairCode} disabled={pairLoading} style={{ width: "100%", padding: 15, border: "none", borderRadius: 12, cursor: pairLoading ? "not-allowed" : "pointer", fontFamily: "'Space Grotesk', sans-serif", fontSize: 14, fontWeight: 700, letterSpacing: 0.5, background: "var(--gradient-1)", color: "#000", marginTop: 16, opacity: pairLoading ? 0.5 : 1 }}>
              ⚡ Generate Pairing Code
            </button>
            {pairLoading && (
              <div style={{ textAlign: "center", padding: "20px 0", color: "var(--text-muted)", fontSize: 13 }}>
                <div style={{ width: 36, height: 36, border: "3px solid var(--border)", borderTopColor: "var(--accent)", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 12px" }} />
                {pairLoadingText}
              </div>
            )}
            {pairCode && (
              <div style={{ marginTop: 20, padding: 20, background: "var(--bg)", borderRadius: 12, border: "1px solid var(--border)", textAlign: "center" }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 10, letterSpacing: 1, textTransform: "uppercase" }}>Your Pairing Code</div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 32, fontWeight: 700, background: "var(--gradient-1)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text", letterSpacing: 4 }}>{pairCode}</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8 }}>Enter this code in WhatsApp → Linked Devices</div>
              </div>
            )}
            {pairSession && (
              <>
                <div style={{ marginTop: 16, padding: 14, background: "var(--bg)", borderRadius: 10, border: "1px solid var(--border)", fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: "var(--text-muted)", wordBreak: "break-all", maxHeight: 80, overflowY: "auto" }}>{pairSession}</div>
                <button onClick={() => copyText(pairSession, setCopied)} style={{ width: "100%", padding: 12, marginTop: 10, border: "1.5px solid var(--accent)", borderRadius: 10, background: "transparent", color: "var(--accent)", cursor: "pointer", fontFamily: "'Space Grotesk', sans-serif", fontSize: 13, fontWeight: 600 }}>
                  {copied ? "✅ Copied!" : "📋 Copy Session ID"}
                </button>
              </>
            )}
            {pairMsg && <div style={{ marginTop: 14, padding: "12px 14px", borderRadius: 10, fontSize: 13, fontWeight: 500, border: "1px solid var(--border)", background: "var(--bg)", color: pairMsg.color }}>{pairMsg.text}</div>}
          </div>
        )}

        {/* QR Tab */}
        {activeTab === "qr" && (
          <div>
            <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16, lineHeight: 1.6 }}>Scan the QR code with WhatsApp to link your session. Your session ID will be sent to your chat.</p>
            <button onClick={getQR} disabled={qrLoading} style={{ width: "100%", padding: 15, border: "none", borderRadius: 12, cursor: qrLoading ? "not-allowed" : "pointer", fontFamily: "'Space Grotesk', sans-serif", fontSize: 14, fontWeight: 700, background: "var(--gradient-1)", color: "#000", opacity: qrLoading ? 0.5 : 1 }}>
              📱 Generate QR Code
            </button>
            {qrLoading && (
              <div style={{ textAlign: "center", padding: "20px 0", color: "var(--text-muted)", fontSize: 13 }}>
                <div style={{ width: 36, height: 36, border: "3px solid var(--border)", borderTopColor: "var(--accent)", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 12px" }} />
                Generating QR Code...
              </div>
            )}
            {qrDataURL && (
              <div style={{ textAlign: "center", marginTop: 16 }}>
                <img src={qrDataURL} alt="QR Code" style={{ width: "100%", maxWidth: 260, borderRadius: 12, margin: "0 auto", display: "block" }} />
                <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 10 }}>QR expires in ~20 seconds. Scan quickly!</p>
              </div>
            )}
            {qrMsg && <div style={{ marginTop: 14, padding: "12px 14px", borderRadius: 10, fontSize: 13, fontWeight: 500, border: "1px solid var(--border)", background: "var(--bg)", color: qrMsg.color }}>{qrMsg.text}</div>}
          </div>
        )}

        {/* Validate Tab */}
        {activeTab === "validate" && (
          <div>
            <label style={{ display: "block", marginBottom: 8, fontWeight: 500, fontSize: 12, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 1 }}>🔑 Session String</label>
            <textarea value={validateInput} onChange={e => setValidateInput(e.target.value)} placeholder="prezzy_..." style={{ width: "100%", padding: "14px 16px", border: "1.5px solid var(--border)", borderRadius: 12, background: "var(--bg)", color: "var(--text)", fontSize: 12, fontFamily: "'JetBrains Mono', monospace", fontWeight: 500, minHeight: 100, resize: "vertical", outline: "none" }} />
            <button onClick={validateSession} disabled={valLoading} style={{ width: "100%", padding: 15, border: "none", borderRadius: 12, cursor: valLoading ? "not-allowed" : "pointer", fontFamily: "'Space Grotesk', sans-serif", fontSize: 14, fontWeight: 700, background: "var(--gradient-1)", color: "#000", marginTop: 16, opacity: valLoading ? 0.5 : 1 }}>
              🛡️ Validate Session
            </button>
            {valLoading && (
              <div style={{ textAlign: "center", padding: "20px 0", color: "var(--text-muted)", fontSize: 13 }}>
                <div style={{ width: 36, height: 36, border: "3px solid var(--border)", borderTopColor: "var(--accent)", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 12px" }} />
                Validating...
              </div>
            )}
            {valResult && (
              <div style={{ marginTop: 16, padding: 14, borderRadius: 10, fontSize: 13, background: "var(--bg)", border: "1px solid var(--border)", lineHeight: 1.7 }}>
                <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 12, color: valResult.valid ? "#00c896" : "#ff4757" }}>
                  {valResult.valid ? "✅ Session is VALID!" : "❌ Session is INVALID"}
                </div>
                {valResult.phone && <div style={{ color: "var(--text-muted)" }}>📱 Phone: +{valResult.phone}</div>}
                {valResult.score && <div style={{ color: "var(--text-muted)" }}>📊 Score: {valResult.score} checks passed</div>}
                {valResult.checks && (
                  <div style={{ marginTop: 10 }}>
                    {Object.entries(valResult.checks).map(([k, v]) => (
                      <div key={k} style={{ color: v ? "#00c896" : "#ff4757" }}>{v ? "✅" : "❌"} {checkLabels[k] || k}</div>
                    ))}
                  </div>
                )}
                {valResult.message && <div style={{ marginTop: 12, fontWeight: 600, color: "var(--text)" }}>{valResult.message}</div>}
                {valResult.error && !valResult.valid && <div style={{ marginTop: 8, color: "#ff4757" }}>{valResult.error}</div>}
              </div>
            )}
          </div>
        )}

        <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "20px 0" }} />
        <p style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "center", lineHeight: 1.6 }}>
          ⚠️ Keep your session ID private. Do not share it with anyone.<br />
          Powered by <strong>Mias MDX</strong> x ⚡ Precious
        </p>
      </div>
    </>
  );
  }
    
