export type CompactResult = {
  value: unknown;
  truncated: boolean;
};

type CompactLimits = {
  maxDepth?: number;
  maxArrayItems?: number;
  maxObjectKeys?: number;
  maxStringLength?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function compactJson(
  input: unknown,
  limits: CompactLimits = {},
): CompactResult {
  const maxDepth = limits.maxDepth ?? 5;
  const maxArrayItems = limits.maxArrayItems ?? 50;
  const maxObjectKeys = limits.maxObjectKeys ?? 100;
  const maxStringLength = limits.maxStringLength ?? 2_000;
  let truncated = false;

  const visit = (value: unknown, depth: number): unknown => {
    if (typeof value === "string") {
      if (value.length <= maxStringLength) return value;
      truncated = true;
      return `${value.slice(0, maxStringLength)}…`;
    }
    if (
      value === null ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      return value;
    }
    if (depth >= maxDepth && (Array.isArray(value) || isRecord(value))) {
      truncated = true;
      return "[truncated]";
    }
    if (Array.isArray(value)) {
      if (value.length > maxArrayItems) truncated = true;
      return value
        .slice(0, maxArrayItems)
        .map((item) => visit(item, depth + 1));
    }
    if (isRecord(value)) {
      const entries = Object.entries(value).sort(([left], [right]) =>
        left.localeCompare(right),
      );
      if (entries.length > maxObjectKeys) truncated = true;
      return Object.fromEntries(
        entries
          .slice(0, maxObjectKeys)
          .map(([key, item]) => [key, visit(item, depth + 1)]),
      );
    }
    if (value === undefined) return null;
    truncated = true;
    return String(value).slice(0, maxStringLength);
  };

  return { value: visit(input, 0), truncated };
}
