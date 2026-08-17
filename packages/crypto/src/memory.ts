/** Best-effort zeroization. JS/WASM cannot guarantee the bytes leave all copies. */
export function zeroize(...buffers: Array<Uint8Array | undefined>): void {
  for (const buf of buffers) {
    if (buf) buf.fill(0);
  }
}
