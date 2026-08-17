export class CryptoError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class AuthFailureError extends CryptoError {
  constructor(message = "authentication failed") {
    super(message);
  }
}

export class ProtocolError extends CryptoError {}

export class RollbackError extends CryptoError {
  readonly lastSeenRevision: number;
  readonly incomingRevision: number;

  constructor(lastSeenRevision: number, incomingRevision: number) {
    super(
      `rollback detected: incoming revision ${incomingRevision} is older than last seen ${lastSeenRevision}`,
    );
    this.lastSeenRevision = lastSeenRevision;
    this.incomingRevision = incomingRevision;
  }
}

export class IntegrityError extends CryptoError {}
