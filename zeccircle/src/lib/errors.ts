/**
 * An error whose message is safe and useful to show to the end user.
 * Anything that is not a DomainError is treated as internal and replaced with a generic message.
 */
export class DomainError extends Error {
  constructor(
    message: string,
    readonly code: DomainErrorCode,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export type DomainErrorCode =
  | "not_found"
  | "forbidden"
  | "conflict"
  | "invalid_input"
  | "expired"
  | "limit_exceeded"
  | "upstream";

export const notFound = (msg: string) => new DomainError(msg, "not_found");
export const forbidden = (msg: string) => new DomainError(msg, "forbidden");
export const conflict = (msg: string) => new DomainError(msg, "conflict");
export const invalidInput = (msg: string) => new DomainError(msg, "invalid_input");
export const expired = (msg: string) => new DomainError(msg, "expired");
