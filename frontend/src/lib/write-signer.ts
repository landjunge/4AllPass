/**
 * Write-signer selection for the desktop app and the browser.
 *
 * The shipped macOS WKWebView cannot import our PKCS#8 seed (recorded in
 * tools/wk-ed25519-probe-evidence.json), so the desktop app signs through the
 * native Tauri command, which also derives the public key from the same seed.
 * A browser only signs when its own WebCrypto Ed25519 actually reproduces the
 * RFC vector; otherwise it fails closed. There is no unsigned or v1 fallback.
 */
import {
  SignerUnavailableError,
  bytesToHex,
  deriveWritePublicKey,
  probeSigner,
  type SignerProbe,
  type WriteSigner,
} from "@4allpass/crypto";

export type NativeInvoke = (command: string, args: Record<string, unknown>) => Promise<unknown>;

let invokeOverride: NativeInvoke | null = null;

/** Test seam: inject a mock IPC invoke without a running Tauri shell. */
export function setNativeInvokeForTests(fn: NativeInvoke | null): void {
  invokeOverride = fn;
}

export function isNativeRuntime(): boolean {
  return invokeOverride !== null || (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window);
}

async function nativeInvoke(): Promise<NativeInvoke> {
  if (invokeOverride) return invokeOverride;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke as NativeInvoke;
}

interface NativeWriteSignature {
  publicKey: number[];
  signature: number[];
}

const toHex = (bytes: Uint8Array) => bytesToHex(bytes);
const fromHex = (value: string) =>
  Uint8Array.from(value.match(/../g)!.map((pair) => Number.parseInt(pair, 16)));

// Canonical KAT: the shared TS encoder vector (write-request-vectors.json[0])
// signed with the RFC 8032 seed. The native command must reproduce it exactly.
const PROBE_PREIMAGE =
  "0000001734616c6c706173732d7661756c742d77726974652d76320000002436663063316331612d336634652d346331642d396137652d326238643066356131633333000000066465762d303100000004504f5354000000222f6170692f76312f7661756c74732f7b7661756c7449647d2f736e617073686f7473000000057661756c740000000000000000000000040000000000000004000000010000000400000001000000040000000100000004000000000000000000000020d801aa1fb7ddcc330a5e3173372ea6af4a3d08ec58074478e85aa5603e9266580000000400000000000000000000002430623964326237652d356134312d346338662d386630652d36643163326133623463356400000010000102030405060708090a0b0c0d0e0f0000000469153ec0";
const PROBE_SEED = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";
const PROBE_PUBLIC = "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a";
const PROBE_SIGNATURE =
  "c57996b4770b6b7d7886edb4887b6dc3db7e9a83c24681a3d2abed1c78b28173810353409d77a1b09d87bee23002ee89942a8c12ef6d6e0b73b8699c9289c50f";

async function callNative(seed: Uint8Array, message: Uint8Array): Promise<NativeWriteSignature> {
  const invoke = await nativeInvoke();
  const out = (await invoke("sign_ed25519_v2", {
    seed: Array.from(seed),
    message: Array.from(message),
  })) as NativeWriteSignature;
  if (!Array.isArray(out?.publicKey) || !Array.isArray(out?.signature)) {
    throw new SignerUnavailableError("native signer returned an invalid shape");
  }
  return out;
}

/** Real capability proof on the native runtime: exact KAT, not just "import exists". */
export async function probeNativeSigner(): Promise<SignerProbe> {
  if (!isNativeRuntime()) return { available: false, reason: "not_native_runtime" };
  try {
    const out = await callNative(fromHex(PROBE_SEED), fromHex(PROBE_PREIMAGE));
    if (toHex(Uint8Array.from(out.publicKey)) !== PROBE_PUBLIC) {
      return { available: false, reason: "native_public_key_mismatch" };
    }
    if (toHex(Uint8Array.from(out.signature)) !== PROBE_SIGNATURE) {
      return { available: false, reason: "native_signature_mismatch" };
    }
    return { available: true };
  } catch {
    return { available: false, reason: "native_signer_failed" };
  }
}

/** Native signer: the public key is derived from the same seed by the command. */
export async function nativeWriteSigner(seed: Uint8Array): Promise<WriteSigner> {
  const ownedSeed = seed.slice();
  let boot: NativeWriteSignature;
  try {
    boot = await callNative(ownedSeed, fromHex(PROBE_PREIMAGE));
  } catch (error) {
    ownedSeed.fill(0);
    throw error;
  }
  const publicKey = Uint8Array.from(boot.publicKey);
  let disposed = false;
  return {
    publicKey,
    sign: async (canonical) => {
      if (disposed) throw new SignerUnavailableError("native signer was disposed");
      return Uint8Array.from((await callNative(ownedSeed, canonical)).signature);
    },
    dispose: () => {
      ownedSeed.fill(0);
      disposed = true;
    },
  };
}

const PKCS8_PREFIX = fromHex("302e020100300506032b657004220420");

/**
 * Browser signer: derive the raw public key from the seed, then import the
 * PKCS#8 seed as a non-extractable signing key. Only used after probeSigner passes.
 */
async function webCryptoSignerFromSeed(seed: Uint8Array): Promise<WriteSigner> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new SignerUnavailableError("no SubtleCrypto");
  const publicKey = await deriveWritePublicKey(seed);
  const der = new Uint8Array(PKCS8_PREFIX.length + seed.length);
  der.set(PKCS8_PREFIX);
  der.set(seed, PKCS8_PREFIX.length);
  let privateKey: CryptoKey | null = null;
  try {
    privateKey = await subtle.importKey("pkcs8", der.buffer, "Ed25519", false, ["sign"]);
  } catch {
    throw new SignerUnavailableError("Ed25519 PKCS#8 import is unavailable");
  } finally {
    der.fill(0);
  }
  return {
    publicKey,
    sign: async (canonical) => {
      if (!privateKey) throw new SignerUnavailableError("browser signer was disposed");
      return new Uint8Array(await subtle.sign("Ed25519", privateKey, canonical.slice().buffer));
    },
    // CryptoKey is non-extractable; dropping the last JS reference is the
    // strongest disposal available to this runtime.
    dispose: () => {
      privateKey = null;
    },
  };
}

/**
 * Select a signer for a derived write seed. Native first; otherwise a probed
 * WebCrypto backend. Fail closed (SignerUnavailableError) when neither can sign.
 */
export async function createWriteSigner(seed: Uint8Array): Promise<WriteSigner> {
  if (isNativeRuntime()) return nativeWriteSigner(seed);
  const probe = await probeSigner();
  if (!probe.available) throw new SignerUnavailableError(probe.reason ?? "signer_unavailable");
  return webCryptoSignerFromSeed(seed);
}

/** Capability probe for the current runtime (native KAT or WebCrypto KAT). */
export async function probeWriteSigner(): Promise<SignerProbe> {
  if (isNativeRuntime()) return probeNativeSigner();
  return probeSigner();
}
