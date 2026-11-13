// Client -> integrated server. Start backend with SIGNED_WRITES_ENABLED=true,
// SESSION_BACKEND=memory, PROFILE=server, throwaway SQLite; then run with tsx.
import { randomUUID } from "node:crypto";
import { classifySignedWriteResponse, signWriteV2 } from "../../src/index.ts";
import { writePublicKeyDigestV2 } from "../../src/requester.ts";
import { sealedManifestDigest } from "../../src/encoding/digest.ts";

const BASE = process.env.BASE_URL || "http://127.0.0.1:8799";
const DEVICE = "dev_integration_0001";
const PASSWORD = "CorrectHorseBatteryStaple9!";
const b64 = (b) => Buffer.from(b).toString("base64");
const json = (o) => JSON.stringify(o);
const hex = (h) => Uint8Array.from(h.match(/../g).map((x) => parseInt(x, 16)));
const key1 = { seed: hex("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60"), publicKey: hex("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a") };
const key2 = { seed: hex("4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb"), publicKey: hex("3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c") };
const now = () => Math.floor(Date.now() / 1000);

async function req(path, { method = "GET", token, body, headers = {} } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), "X-Device-Id": DEVICE, ...headers },
    body: body && typeof body !== "string" ? json(body) : body,
  });
  const text = await res.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, headers: res.headers, data };
}

const email = `client-${randomUUID()}@example.com`;
if ((await req("/api/v1/auth/register", { method: "POST", body: { email, password: PASSWORD } })).status !== 200) throw new Error("register");
const token = (await req("/api/v1/auth/login", { method: "POST", body: { email, password: PASSWORD } })).data.token;
const created = await req("/api/v1/vaults", { method: "POST", token, body: { cryptoProtocolVersion: 2, accountPassword: PASSWORD } });
if (created.status !== 201) throw new Error(`create ${created.status} ${json(created.data)}`);
const vaultId = created.data.vaultId;

const deviceBody = json({ deviceId: DEVICE });
const boot = await signWriteV2({
  vaultId, deviceId: DEVICE, method: "POST", route: "/api/v1/vaults/{vaultId}/devices",
  resourceType: "device", resourceId: DEVICE, parentId: "", baseRevision: 0, resultRevision: 0,
  keyVersion: 1, resultKeyVersion: 1, hasManifest: false, manifestDigest: new Uint8Array(),
  payloadDigest: new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(deviceBody))),
  hasNextKey: true, nextPublicKeyDigest: writePublicKeyDigestV2(key1.publicKey),
  operationId: randomUUID(), nonce: crypto.getRandomValues(new Uint8Array(16)), timestamp: now(),
}, key1, key1);
const bootResp = await req(`/api/v1/vaults/${vaultId}/devices`, { method: "POST", token, body: deviceBody, headers: { ...boot.headers, "X-4AP-Creation-Grant": created.data.creationGrant } });
if (bootResp.status !== 200) throw new Error(`bootstrap ${bootResp.status} ${json(bootResp.data)}`);

const manifest = { version: 1, encryption: "AES-256-GCM", nonce: b64(crypto.getRandomValues(new Uint8Array(12))), ciphertext: b64(new TextEncoder().encode("manifest")), tag: b64(crypto.getRandomValues(new Uint8Array(16))) };
const envelope = { version: 1, type: "master", vaultKeyVersion: 1, encryption: "AES-256-GCM", nonce: b64(crypto.getRandomValues(new Uint8Array(12))), ciphertext: b64(new TextEncoder().encode("master-key")), tag: b64(crypto.getRandomValues(new Uint8Array(16))), kdf: { algorithm: "argon2id", version: 19, memory: 65536, iterations: 3, parallelism: 2, hashLen: 32, salt: b64(crypto.getRandomValues(new Uint8Array(16))) } };
const snap1 = json({ expectedRevision: 0, revision: 1, vaultKeyVersion: 1, cryptoProtocolVersion: 2, envelopes: [envelope], entries: [], sealedManifest: manifest });
const s1 = await signWriteV2({
  vaultId, deviceId: DEVICE, method: "POST", route: "/api/v1/vaults/{vaultId}/snapshots",
  resourceType: "vault", resourceId: "", parentId: "", baseRevision: 0, resultRevision: 1,
  keyVersion: 1, resultKeyVersion: 1, hasManifest: true, manifestDigest: sealedManifestDigest(manifest),
  payloadDigest: new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(snap1))),
  hasNextKey: false, nextPublicKeyDigest: new Uint8Array(), operationId: randomUUID(), nonce: crypto.getRandomValues(new Uint8Array(16)), timestamp: now(),
}, key1);
const first = await req(`/api/v1/vaults/${vaultId}/snapshots`, { method: "POST", token, body: snap1, headers: s1.headers });
if (first.status !== 200) throw new Error(`snapshot ${first.status} ${json(first.data)}`);
const replay = await req(`/api/v1/vaults/${vaultId}/snapshots`, { method: "POST", token, body: snap1, headers: s1.headers });
const replayExpectation = { operationId: s1.request.operationId, vaultId, route: "/api/v1/vaults/{vaultId}/snapshots", resourceType: "vault", resourceId: "", parentId: "" };
if (replay.status !== 200 || classifySignedWriteResponse(replay.status, replay.headers, replay.data, replayExpectation).kind !== "replayed") throw new Error("replay");

const tampered = JSON.parse(snap1); tampered.sealedManifest.ciphertext = b64(new TextEncoder().encode("different"));
const conflict = await req(`/api/v1/vaults/${vaultId}/snapshots`, { method: "POST", token, body: json(tampered), headers: s1.headers });
if (conflict.status !== 409) throw new Error(`mismatch ${conflict.status} ${json(conflict.data)}`);

const manifest2 = { ...manifest, ciphertext: b64(new TextEncoder().encode("manifest-2")) };
const snap2 = json({ expectedRevision: 1, revision: 2, vaultKeyVersion: 2, cryptoProtocolVersion: 2, envelopes: [{ ...envelope, vaultKeyVersion: 2 }], entries: [], sealedManifest: manifest2 });
const s2 = await signWriteV2({
  vaultId, deviceId: DEVICE, method: "POST", route: "/api/v1/vaults/{vaultId}/snapshots",
  resourceType: "vault", resourceId: "", parentId: "", baseRevision: 1, resultRevision: 2,
  keyVersion: 1, resultKeyVersion: 2, hasManifest: true, manifestDigest: sealedManifestDigest(manifest2),
  payloadDigest: new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(snap2))),
  hasNextKey: true, nextPublicKeyDigest: writePublicKeyDigestV2(key2.publicKey),
  operationId: randomUUID(), nonce: crypto.getRandomValues(new Uint8Array(16)), timestamp: now(),
}, key1, key2);
const rotated = await req(`/api/v1/vaults/${vaultId}/snapshots`, { method: "POST", token, body: snap2, headers: s2.headers });
if (rotated.status !== 200) throw new Error(`rotation ${rotated.status} ${json(rotated.data)}`);

if ((await req(`/api/v1/vaults/${vaultId}/devices/${DEVICE}`, { method: "DELETE", token })).status !== 200) throw new Error("revoke");
const snap3 = JSON.parse(snap2); snap3.expectedRevision = 2; snap3.revision = 3; snap3.sealedManifest.ciphertext = b64(new TextEncoder().encode("manifest-3"));
const s3 = await signWriteV2({
  vaultId, deviceId: DEVICE, method: "POST", route: "/api/v1/vaults/{vaultId}/snapshots",
  resourceType: "vault", resourceId: "", parentId: "", baseRevision: 2, resultRevision: 3,
  keyVersion: 2, resultKeyVersion: 2, hasManifest: true, manifestDigest: sealedManifestDigest(snap3.sealedManifest),
  payloadDigest: new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(json(snap3)))),
  hasNextKey: false, nextPublicKeyDigest: new Uint8Array(), operationId: randomUUID(), nonce: crypto.getRandomValues(new Uint8Array(16)), timestamp: now(),
}, key2);
const blocked = await req(`/api/v1/vaults/${vaultId}/snapshots`, { method: "POST", token, body: json(snap3), headers: s3.headers });
if (blocked.status !== 403 || blocked.data.detail !== "device_revoked") throw new Error(`revoked ${blocked.status} ${json(blocked.data)}`);

const unknown = classifySignedWriteResponse(502, new Headers(), {});
if (unknown.kind !== "unknown") throw new Error("unknown classification");
console.log(json({ ok: true, vaultId, bootstrap: bootResp.status, snapshot: first.status, replay: replay.status, mismatch: conflict.status, rotation: rotated.status, revoked: blocked.status, unknown: unknown.kind }));
