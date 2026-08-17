export class CryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class AuthFailureError extends CryptoError {
  constructor(message = "authentication failed") {
    super(message);
  }
}

export class ProtocolError extends CryptoError {}
