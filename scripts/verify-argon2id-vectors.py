#!/usr/bin/env python3
"""Verify docs/test-vectors/argon2id-v1.json against argon2-cffi.

Usage (from repo root):
  pip install -r scripts/requirements-dev.txt
  python3 scripts/verify-argon2id-vectors.py

Optional env:
  SKIP_HEAVY=1   skip profiles with memory_kib > 256 (keeps CI / RFC / wrap)
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from argon2.low_level import Type, ffi, hash_secret_raw, lib

ROOT = Path(__file__).resolve().parent.parent
SUITE_PATH = ROOT / "docs/test-vectors/argon2id-v1.json"
SKIP_HEAVY = os.environ.get("SKIP_HEAVY") == "1"
HEAVY_KIB = 256

WRAP_JS = """\
import { createDecipheriv } from "node:crypto";
import { readFileSync } from "node:fs";
const v = JSON.parse(readFileSync(process.argv[2], "utf8"));
const d = createDecipheriv("aes-256-gcm", Buffer.from(v.key, "hex"), Buffer.from(v.nonce, "hex"));
d.setAAD(Buffer.from(v.aad || "", "hex"));
d.setAuthTag(Buffer.from(v.tag, "hex"));
const pt = Buffer.concat([d.update(Buffer.from(v.ciphertext, "hex")), d.final()]);
process.stdout.write(pt.toString("hex"));
"""


def _argon2id(
    password: bytes,
    salt: bytes,
    t: int,
    m: int,
    p: int,
    hlen: int = 32,
    secret: bytes = b"",
    ad: bytes = b"",
) -> bytes:
    if secret or ad:
        ctx = ffi.new("argon2_context *")
        out = ffi.new("uint8_t[]", hlen)
        pwd_buf = ffi.new("uint8_t[]", password) if password else ffi.NULL
        salt_buf = ffi.new("uint8_t[]", salt)
        sec_buf = ffi.new("uint8_t[]", secret) if secret else ffi.NULL
        ad_buf = ffi.new("uint8_t[]", ad) if ad else ffi.NULL
        ctx.out = out
        ctx.outlen = hlen
        ctx.pwd = pwd_buf
        ctx.pwdlen = len(password)
        ctx.salt = salt_buf
        ctx.saltlen = len(salt)
        ctx.secret = sec_buf
        ctx.secretlen = len(secret)
        ctx.ad = ad_buf
        ctx.adlen = len(ad)
        ctx.t_cost = t
        ctx.m_cost = m
        ctx.lanes = p
        ctx.threads = p
        ctx.version = lib.ARGON2_VERSION_13
        ctx.allocate_cbk = ffi.NULL
        ctx.free_cbk = ffi.NULL
        ctx.flags = lib.ARGON2_DEFAULT_FLAGS
        rc = lib.argon2_ctx(ctx, lib.Argon2_id)
        if rc != lib.ARGON2_OK:
            raise RuntimeError(f"argon2_ctx failed rc={rc}")
        return bytes(ffi.buffer(out, hlen))
    return hash_secret_raw(
        password,
        salt,
        time_cost=t,
        memory_cost=m,
        parallelism=p,
        hash_len=hlen,
        type=Type.ID,
        version=19,
    )


def _from_hex(h: str) -> bytes:
    return bytes.fromhex(h or "")


failed = 0
skipped = 0


def ok(vid: str, cond: bool, detail: str = "") -> None:
    global failed
    if cond:
        print(f"  PASS  {vid}")
    else:
        failed += 1
        extra = f" — {detail}" if detail else ""
        print(f"  FAIL  {vid}{extra}")


def skip(vid: str, reason: str) -> None:
    global skipped
    skipped += 1
    print(f"  SKIP  {vid} — {reason}")


def derive(v: dict) -> bytes:
    return _argon2id(
        password=_from_hex(v["password"]),
        salt=_from_hex(v["salt"]),
        t=v["iterations"],
        m=v["memory_kib"],
        p=v["parallelism"],
        hlen=v.get("hash_len", 32),
        secret=_from_hex(v.get("secret", "")),
        ad=_from_hex(v.get("associated_data", "")),
    )


def check_derive(v: dict) -> None:
    if SKIP_HEAVY and v.get("memory_kib", 0) > HEAVY_KIB:
        skip(v["id"], f"memory_kib={v['memory_kib']} (SKIP_HEAVY=1)")
        return
    try:
        got = derive(v)
        ok(v["id"], got == _from_hex(v["dk"]), f"got {got.hex()}")
    except Exception as exc:  # noqa: BLE001
        ok(v["id"], False, str(exc))


def aes_gcm_decrypt(v: dict) -> bytes:
    node = shutil.which("node")
    if not node:
        raise RuntimeError("node not found (needed for wrap AES-GCM check)")
    with tempfile.TemporaryDirectory() as tmp:
        js = Path(tmp) / "unwrap.mjs"
        payload = Path(tmp) / "vec.json"
        js.write_text(WRAP_JS, encoding="utf-8")
        payload.write_text(json.dumps(v), encoding="utf-8")
        proc = subprocess.run(
            [node, str(js), str(payload)],
            check=False,
            capture_output=True,
            text=True,
        )
    if proc.returncode != 0:
        raise RuntimeError((proc.stderr or proc.stdout or "aes-gcm decrypt failed").strip())
    return bytes.fromhex(proc.stdout.strip())


def main() -> int:
    suite = json.loads(SUITE_PATH.read_text(encoding="utf-8"))

    print("RFC 9106 interop")
    for v in suite["rfc9106"]:
        check_derive(v)

    print("Protocol success")
    for v in suite["success"]:
        check_derive(v)

    print("Negative (dk must differ)")
    ci = next(x for x in suite["success"] if x["id"] == "TV-ARGON2-CI")
    for v in suite["negative"]:
        if SKIP_HEAVY and v.get("memory_kib", 0) > HEAVY_KIB:
            skip(v["id"], "SKIP_HEAVY=1")
            continue
        got = derive(v)
        ok(
            v["id"],
            got == _from_hex(v["dk"]) and got != _from_hex(ci["dk"]),
            f"got {got.hex()}",
        )

    print("Composite wrap (Argon2id MK → AES-GCM)")
    for v in suite["wrap"]:
        try:
            pt = aes_gcm_decrypt(v)
            if v["expect"] == "decrypt_ok":
                ok(v["id"], pt == _from_hex(v["plaintext"]))
            else:
                ok(v["id"], False, "decrypt unexpectedly succeeded")
        except Exception as exc:  # noqa: BLE001
            if v["expect"] == "auth_fail":
                ok(v["id"], True)
            else:
                ok(v["id"], False, str(exc))

    if failed:
        print(f"\n{failed} vector(s) failed ({skipped} skipped)")
        return 1
    print(f"\nAll Argon2id v1 vectors passed ({skipped} skipped).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
