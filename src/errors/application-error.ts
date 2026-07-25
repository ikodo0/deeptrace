import { ErrorCode, type ErrorCode as ErrorCodeValue } from "./codes.js";

export class ApplicationError extends Error {
  readonly code: ErrorCodeValue;

  constructor(code: ErrorCodeValue, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ApplicationError";
    this.code = code;
  }
}

export class ConfigurationError extends ApplicationError {
  readonly variableNames: readonly string[];

  constructor(variableNames: readonly string[]) {
    const names = [...variableNames];
    super(
      ErrorCode.INVALID_CONFIGURATION,
      names.length === 1
        ? `Invalid configuration for ${names[0]}`
        : `Invalid configuration for ${names.join(", ")}`,
    );
    this.name = "ConfigurationError";
    this.variableNames = names;
  }
}

export class RateLimitError extends ApplicationError {
  constructor() {
    super(ErrorCode.RATE_LIMITED, "Rate limit exceeded");
    this.name = "RateLimitError";
  }
}
