import {
  DEVICE_UNLOCK_MECHANISMS,
  prfEvalFirst,
  selectDeviceUnlock,
} from "@4allpass/crypto";

export function App() {
  const evalFirst = prfEvalFirst("pass.example.local", "vault_01HZX4ALLPASS000000000001");
  const preferred = selectDeviceUnlock(DEVICE_UNLOCK_MECHANISMS);

  return (
    <main>
      <h1>4AllPass</h1>
      <p>Zero-knowledge vault. The server never sees the Master Password or Vault Key.</p>
      <p>
        Device unlock rank: <code>{preferred}</code> (then largeBlob, then UV-gated local
        store). Master Password remains available.
      </p>
      <p>
        <code>prf.eval.first</code> length: {evalFirst.byteLength} bytes
      </p>
    </main>
  );
}
