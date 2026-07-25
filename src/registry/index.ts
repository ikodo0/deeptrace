import { readFileSync } from "node:fs";

import { z } from "zod";

import { ApplicationError } from "../errors/application-error.js";
import { ErrorCode } from "../errors/codes.js";
import { BASE_CHAIN_ID } from "../schemas/source-adapter.js";
import type { SourceRegistryRecord } from "./types.js";

/**
 * Repository configuration is an untrusted deploy input: it is validated at
 * load time and never asserted into shape. Every failure names the offending
 * JSON path so a bad deploy is diagnosable without reading the loader.
 */
export class RegistryConfigurationError extends ApplicationError {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    const detail = [...issues];
    super(ErrorCode.INVALID_CONFIGURATION, `Invalid registry configuration: ${detail.join("; ")}`);
    this.name = "RegistryConfigurationError";
    this.issues = detail;
  }
}

/**
 * The only gateway host a Graph locator may name. The client builds its URL
 * from this validated host, so an unlisted host never reaches the network.
 */
export const GRAPH_GATEWAY_HOST_ALLOWLIST = ["gateway.thegraph.com"] as const;

const RECORDS_LABEL = "records.json";

const DEFAULT_RECORDS_URL = new URL("./records.json", import.meta.url);

const nonEmptyStringSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim() === value, "Must not have leading or trailing whitespace");

const registryRecordBaseShape = {
  source_id: nonEmptyStringSchema,
  category: z.literal("dex"),
  protocol: nonEmptyStringSchema,
  chain_id: z.literal(BASE_CHAIN_ID),
  deployment_or_view_id: nonEmptyStringSchema,
  schema_version: nonEmptyStringSchema.nullable(),
  methodology_version: nonEmptyStringSchema.nullable(),
  supported_entities: z.array(nonEmptyStringSchema).min(1),
  status: z.enum(["active", "inactive"]),
};

const graphSourceRegistryRecordSchema = z
  .object({
    ...registryRecordBaseShape,
    source_type: z.enum(["standardized_subgraph", "native_subgraph"]),
    locator: z
      .object({
        kind: z.literal("graph_subgraph"),
        gateway_host: z.enum(GRAPH_GATEWAY_HOST_ALLOWLIST),
        subgraph_id: nonEmptyStringSchema,
      })
      .strict(),
  })
  .strict();

const nuthatchSourceRegistryRecordSchema = z
  .object({
    ...registryRecordBaseShape,
    source_type: z.literal("nuthatch_view"),
    locator: z
      .object({
        kind: z.literal("nuthatch_view"),
        base_url_env: z.literal("NUTHATCH_BASE_URL"),
        view_id: nonEmptyStringSchema,
      })
      .strict(),
  })
  .strict();

const sourceRegistryRecordsSchema = z
  .array(
    z.discriminatedUnion("source_type", [
      graphSourceRegistryRecordSchema,
      nuthatchSourceRegistryRecordSchema,
    ]),
  )
  .min(1);

/**
 * A JSON location to read, or an already-parsed value supplied by a test.
 * Omitting the field loads the file that ships next to this module.
 */
export interface RegistryLoadOptions {
  readonly records?: unknown;
}

function formatIssuePath(label: string, path: readonly PropertyKey[]): string {
  const rendered = path
    .map((segment) =>
      typeof segment === "number" ? `[${String(segment)}]` : `.${String(segment)}`,
    )
    .join("");
  return `${label}${rendered}`;
}

function toIssues(label: string, error: z.ZodError): string[] {
  return error.issues.map((issue) => `${formatIssuePath(label, issue.path)}: ${issue.message}`);
}

function readJson(location: URL, label: string): unknown {
  let text: string;
  try {
    text = readFileSync(location, "utf8");
  } catch (cause) {
    throw new RegistryConfigurationError([
      `${label}: could not be read at ${location.href} (${(cause as Error).message})`,
    ]);
  }

  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new RegistryConfigurationError([
      `${label}: is not valid JSON (${(cause as Error).message})`,
    ]);
  }
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}

function addOnce(seen: Set<string>, value: string): boolean {
  if (seen.has(value)) {
    return false;
  }
  seen.add(value);
  return true;
}

function parseRecords(source: unknown, label: string): readonly SourceRegistryRecord[] {
  const parsed = sourceRegistryRecordsSchema.safeParse(source);
  if (!parsed.success) {
    throw new RegistryConfigurationError(toIssues(label, parsed.error));
  }

  const records: readonly SourceRegistryRecord[] = parsed.data;

  const seen = new Set<string>();
  const duplicates = records
    .filter((record) => !addOnce(seen, record.source_id))
    .map((record) => `${label}: duplicate source_id "${record.source_id}"`);
  if (duplicates.length > 0) {
    throw new RegistryConfigurationError(duplicates);
  }

  return deepFreeze(records);
}

let cachedRecords: readonly SourceRegistryRecord[] | undefined;

function loadRecords(source: unknown): readonly SourceRegistryRecord[] {
  if (source === undefined) {
    cachedRecords ??= parseRecords(readJson(DEFAULT_RECORDS_URL, RECORDS_LABEL), RECORDS_LABEL);
    return cachedRecords;
  }

  if (source instanceof URL) {
    return parseRecords(readJson(source, RECORDS_LABEL), RECORDS_LABEL);
  }

  return parseRecords(source, RECORDS_LABEL);
}

/**
 * Drops the memoized default-location load. Only the shipped files are cached;
 * values injected through {@link RegistryLoadOptions} are parsed every call.
 */
export function resetRegistryCache(): void {
  cachedRecords = undefined;
}

/**
 * Looks up a registry record of any type or status. Callers that need an
 * active Graph binding use {@link getActiveComparePoolGraphSources} instead.
 */
export function getSourceById(
  sourceId: string,
  options: RegistryLoadOptions = {},
): SourceRegistryRecord | undefined {
  return loadRecords(options.records).find((record) => record.source_id === sourceId);
}
