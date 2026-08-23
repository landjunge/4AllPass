import { useEffect, useState, type ReactNode } from "react";
import { parseOtpauth, totpFromBase32, totpRemaining } from "../lib/totp.ts";

export function TotpCode({ secret }: { secret: string }): ReactNode {
  const [code, setCode] = useState("");
  const [left, setLeft] = useState(30);

  useEffect(() => {
    let alive = true;
    async function tick(): Promise<void> {
      try {
        const now = Date.now() / 1000;
        const parsed = parseOtpauth(secret);
        const next = await totpFromBase32(parsed?.secret ?? secret, now);
        if (!alive) return;
        setCode(next);
        setLeft(totpRemaining(now));
      } catch {
        if (alive) setCode("");
      }
    }
    void tick();
    const id = window.setInterval(() => void tick(), 1000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [secret]);

  if (!code) {
    return <p className="error-text">TOTP-Secret ungültig / invalid TOTP secret</p>;
  }
  return (
    <p className="ok" data-testid="totp-code">
      <span className="mono">{code}</span>
      <span className="muted"> · {left}s</span>
    </p>
  );
}
