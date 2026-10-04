const SECRET_KEYS = /api[_-]?key|authorization|cookie|password|secret|token/i;
const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi;

export class Redactor {
  constructor(
    private readonly sensitiveNames: ReadonlySet<string> = new Set(),
    private readonly sensitiveValues: ReadonlySet<string> = new Set(),
  ) {}

  redact(value: unknown, key = ""): unknown {
    if (this.sensitiveNames.has(key) || SECRET_KEYS.test(key)) return "[REDACTED]";
    if (typeof value === "string") {
      let redacted = value.replace(BEARER_PATTERN, "Bearer [REDACTED]");
      for (const sensitive of this.sensitiveValues) {
        if (sensitive) redacted = redacted.replaceAll(sensitive, "[REDACTED]");
      }
      return redacted;
    }
    if (Array.isArray(value)) return value.map(item => this.redact(item, key));
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([childKey, childValue]) => [
          childKey,
          this.redact(childValue, childKey),
        ]),
      );
    }
    return value;
  }
}
