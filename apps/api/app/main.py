from fastapi import FastAPI

from app.api.routes import devices, vaults

app = FastAPI(
    title="4AllPass API",
    description=(
        "Zero-knowledge password manager backend. Stores only ciphertext, "
        "envelopes, and public WebAuthn material — never plaintext or keys."
    ),
    version="0.1.0",
)

app.include_router(vaults.router)
app.include_router(devices.router)


@app.get("/health", tags=["meta"])
def health() -> dict[str, str]:
    return {"status": "ok"}
