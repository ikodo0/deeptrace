export const ErrorCode = {
  INVALID_CONFIGURATION: "INVALID_CONFIGURATION",
  RATE_LIMITED: "RATE_LIMITED",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
