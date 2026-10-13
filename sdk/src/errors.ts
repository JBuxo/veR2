export type Ver2ErrorCode =
  | "INVALID_KEY"
  | "OBJECT_NOT_FOUND"
  | "VERSION_NOT_FOUND"
  | "CONCURRENCY_CONFLICT"
  | "INTEGRITY_CHECK_FAILED"
  | "OPERATION_INCOMPLETE"
  | "CONFIGURATION_ERROR"
  | "STORAGE_ERROR";

/** Base class for every error veR2 throws on purpose. Switch on `code`, not on class names. */
export class Ver2Error extends Error {
  readonly code: Ver2ErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: Ver2ErrorCode, message: string, details: Record<string, unknown> = {}, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
    this.details = details;
  }
}

export class InvalidKeyError extends Ver2Error {
  constructor(key: string, reason: string) {
    super("INVALID_KEY", `Invalid key ${JSON.stringify(key)}: ${reason}`, { key, reason });
  }
}

export class ObjectNotFoundError extends Ver2Error {
  constructor(key: string) {
    super("OBJECT_NOT_FOUND", `No current object for ${JSON.stringify(key)}`, { key });
  }
}

export class VersionNotFoundError extends Ver2Error {
  constructor(key: string, versionId: string) {
    super("VERSION_NOT_FOUND", `No restorable version ${versionId} for ${JSON.stringify(key)}`, { key, versionId });
  }
}

export class ConcurrencyConflictError extends Ver2Error {
  constructor(key: string, reason: string) {
    super("CONCURRENCY_CONFLICT", `Concurrent change to ${JSON.stringify(key)}: ${reason}`, { key, reason });
  }
}

export class IntegrityCheckFailedError extends Ver2Error {
  constructor(key: string, versionId: string, reason: string) {
    super(
      "INTEGRITY_CHECK_FAILED",
      `Integrity check failed for ${JSON.stringify(key)} version ${versionId}: ${reason}`,
      { key, versionId, reason },
    );
  }
}

export class OperationIncompleteError extends Ver2Error {
  constructor(key: string, opId: string, reason: string, options?: { cause?: unknown }) {
    super(
      "OPERATION_INCOMPLETE",
      `Operation ${opId} on ${JSON.stringify(key)} did not complete: ${reason}. Run \`ver2 reconcile\`.`,
      { key, opId, reason },
      options,
    );
  }
}

export class ConfigurationError extends Ver2Error {
  constructor(message: string) {
    super("CONFIGURATION_ERROR", message);
  }
}

export class StorageError extends Ver2Error {
  readonly retryable: boolean;

  constructor(message: string, details: { status?: number; retryable: boolean }, options?: { cause?: unknown }) {
    super("STORAGE_ERROR", message, details, options);
    this.retryable = details.retryable;
  }
}
