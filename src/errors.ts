import type { ErrorCode, ErrorResult, Recovery } from "./types.js";

export class InterfaceError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly recovery?: Recovery;

  constructor(
    code: ErrorCode,
    message: string,
    options: { retryable?: boolean; recovery?: Recovery; cause?: unknown } = {},
  ) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "InterfaceError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    if (options.recovery !== undefined) this.recovery = options.recovery;
  }
}

export function errorResult(error: unknown): ErrorResult {
  const normalized =
    error instanceof InterfaceError
      ? error
      : new InterfaceError(
          "UPSTREAM_UNAVAILABLE",
          "Home Assistant request failed.",
          {
            retryable: true,
            cause: error,
          },
        );
  return {
    ok: false,
    error: {
      code: normalized.code,
      message: normalized.message,
      retryable: normalized.retryable,
      ...(normalized.recovery === undefined
        ? {}
        : { recovery: normalized.recovery }),
    },
  };
}

export async function toolResult<T>(
  operation: () => Promise<T>,
): Promise<T | ErrorResult> {
  try {
    return await operation();
  } catch (error) {
    return errorResult(error);
  }
}
