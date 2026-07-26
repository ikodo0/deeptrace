import { readFileSync } from "node:fs";

import { z } from "zod";

import { ApplicationError } from "../errors/application-error.js";
import { ErrorCode } from "../errors/codes.js";
import { BASE_CHAIN_ID } from "../schemas/source-adapter.js";
import type { GraphSourceRegistryRecord, SourceCategory, SourceRegistryRecord } from "./types.js";

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
const COMPARE_POOLS_LABEL = "compare-pools.json";
const COMPARE_LENDING_LABEL = "compare-lending.json";

const DEFAULT_RECORDS_URL = new URL("./records.json", import.meta.url);
const DEFAULT_PROFILE_URL = new URL("./compare-pools.json", import.meta.url);
const DEFAULT_LENDING_PROFILE_URL = new URL("./compare-lending.json", import.meta.url);

/**
 * `compare_pools` compares exactly two fee tiers of the locked pair. Enforcing
 * the count here makes the selection a load-time invariant.
 */
export const COMPARE_POOLS_SOURCE_COUNT = 2;

/**
 * `compare_lending_markets` fans out to exactly three Base lending protocols.
 * A deploy that drops one must fail loudly rather than compare fewer.
 */
export const COMPARE_LENDING_SOURCE_COUNT = 3;

const nonEmptyStringSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim() === value, "Must not have leading or trailing whitespace");

const lowercaseAddressSchema = z
  .string()
  .regex(/^0x[0-9a-f]{40}$/, "Expected a lowercase 20-byte hexadecimal address");

const registryRecordBaseShape = {
  source_id: nonEmptyStringSchema,
  category: z.enum(["dex", "lending"]),
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

const comparePoolBindingSchema = z
  .object({
    source_id: nonEmptyStringSchema,
    pool_address: lowercaseAddressSchema,
    query_id: nonEmptyStringSchema,
    schema_contract_id: nonEmptyStringSchema,
    priority: z.number().int().positive(),
  })
  .strict();

const comparePoolsProfileSchema = z
  .object({
    profile_id: nonEmptyStringSchema,
    chain_id: z.literal(BASE_CHAIN_ID),
    token0: lowercaseAddressSchema,
    token1: lowercaseAddressSchema,
    window_methodology: nonEmptyStringSchema,
    sources: z.array(comparePoolBindingSchema).length(COMPARE_POOLS_SOURCE_COUNT),
  })
  .strict();

const compareLendingBindingSchema = z
  .object({
    source_id: nonEmptyStringSchema,
    query_id: nonEmptyStringSchema,
    schema_contract_id: nonEmptyStringSchema,
    priority: z.number().int().positive(),
  })
  .strict();

const compareLendingProfileSchema = z
  .object({
    profile_id: nonEmptyStringSchema,
    chain_id: z.literal(BASE_CHAIN_ID),
    /** The single market asset every selected protocol is compared on. */
    market_token: lowercaseAddressSchema,
    sources: z.array(compareLendingBindingSchema).length(COMPARE_LENDING_SOURCE_COUNT),
  })
  .strict();

/**
 * One MVP request profile binding a registry source to the pool, query, and
 * response contract it is queried with. Kept out of `SourceRegistryRecord` so
 * the reusable source record does not absorb MVP-specific request details.
 */
export type ComparePoolBinding = z.infer<typeof comparePoolBindingSchema>;

export type ComparePoolsProfile = z.infer<typeof comparePoolsProfileSchema>;

export type CompareLendingBinding = z.infer<typeof compareLendingBindingSchema>;

export type CompareLendingProfile = z.infer<typeof compareLendingProfileSchema>;

/** A binding joined to its active Graph record. Adapters consume only this. */
export interface ComparePoolGraphSource {
  readonly profile_id: string;
  readonly source_id: string;
  readonly priority: number;
  readonly pool_address: string;
  readonly token0: string;
  readonly token1: string;
  readonly window_methodology: string;
  readonly query_id: string;
  readonly schema_contract_id: string;
  readonly record: GraphSourceRegistryRecord;
}

/** The lending analogue of {@link ComparePoolGraphSource}. */
export interface CompareLendingGraphSource {
  readonly profile_id: string;
  readonly source_id: string;
  readonly priority: number;
  readonly market_token: string;
  readonly query_id: string;
  readonly schema_contract_id: string;
  readonly record: GraphSourceRegistryRecord;
}

/**
 * JSON locations to read, or already-parsed values supplied by a test.
 * Omitting a field loads the file that ships next to this module.
 */
export interface RegistryLoadOptions {
  readonly records?: unknown;
  readonly profile?: unknown;
  /**
   * Entities the selected query needs. The tool that owns the query owns the
   * real list; passing none skips the coverage check rather than guessing.
   */
  readonly requiredEntities?: readonly string[];
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

function parseProfile(source: unknown): ComparePoolsProfile {
  const parsed = comparePoolsProfileSchema.safeParse(source);
  if (!parsed.success) {
    throw new RegistryConfigurationError(toIssues(COMPARE_POOLS_LABEL, parsed.error));
  }

  return deepFreeze(parsed.data);
}

function parseLendingProfile(source: unknown): CompareLendingProfile {
  const parsed = compareLendingProfileSchema.safeParse(source);
  if (!parsed.success) {
    throw new RegistryConfigurationError(toIssues(COMPARE_LENDING_LABEL, parsed.error));
  }

  return deepFreeze(parsed.data);
}

let cachedRecords: readonly SourceRegistryRecord[] | undefined;
let cachedProfile: ComparePoolsProfile | undefined;
let cachedLendingProfile: CompareLendingProfile | undefined;

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

function loadProfile(source: unknown): ComparePoolsProfile {
  if (source === undefined) {
    cachedProfile ??= parseProfile(readJson(DEFAULT_PROFILE_URL, COMPARE_POOLS_LABEL));
    return cachedProfile;
  }

  if (source instanceof URL) {
    return parseProfile(readJson(source, COMPARE_POOLS_LABEL));
  }

  return parseProfile(source);
}

function loadLendingProfile(source: unknown): CompareLendingProfile {
  if (source === undefined) {
    cachedLendingProfile ??= parseLendingProfile(
      readJson(DEFAULT_LENDING_PROFILE_URL, COMPARE_LENDING_LABEL),
    );
    return cachedLendingProfile;
  }

  if (source instanceof URL) {
    return parseLendingProfile(readJson(source, COMPARE_LENDING_LABEL));
  }

  return parseLendingProfile(source);
}

/**
 * Drops the memoized default-location loads. Only the shipped files are
 * cached; values injected through {@link RegistryLoadOptions} are parsed on
 * every call.
 */
export function resetRegistryCache(): void {
  cachedRecords = undefined;
  cachedProfile = undefined;
  cachedLendingProfile = undefined;
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

type BindingPath = (index: number, field: string) => string;

function bindingPathFor(label: string): BindingPath {
  return (index, field) => `${label}.sources[${String(index)}].${field}`;
}

const bindingPath = bindingPathFor(COMPARE_POOLS_LABEL);
const lendingBindingPath = bindingPathFor(COMPARE_LENDING_LABEL);

function collectDuplicateIssues<TBinding extends Record<string, unknown>>(
  bindings: readonly TBinding[],
  field: keyof TBinding & string,
  path: BindingPath,
): string[] {
  const firstIndexByValue = new Map<string, number>();
  const issues: string[] = [];

  bindings.forEach((binding, index) => {
    const value = String(binding[field]);
    const firstIndex = firstIndexByValue.get(value);
    if (firstIndex === undefined) {
      firstIndexByValue.set(value, index);
      return;
    }
    issues.push(`${path(index, field)}: "${value}" duplicates sources[${String(firstIndex)}]`);
  });

  return issues;
}

/**
 * The same query text must serve every selected deployment, so the values that
 * define that contract have to be identical across the set.
 */
function collectSharedValueIssues(
  values: readonly string[],
  path: (index: number) => string,
  description: string,
): string[] {
  const [expected] = values;
  if (expected === undefined) {
    return [];
  }

  return values.flatMap((value, index) =>
    value === expected
      ? []
      : [`${path(index)}: ${description} "${value}" does not match sources[0] "${expected}"`],
  );
}

function isGraphRecord(record: SourceRegistryRecord): record is GraphSourceRegistryRecord {
  return record.locator.kind === "graph_subgraph";
}

/**
 * Resolves one binding to the active Graph record it names, appending a named
 * issue instead of throwing so a bad deploy reports every problem at once.
 */
function resolveGraphRecord(
  sourceId: string,
  path: string,
  input: {
    readonly records: readonly SourceRegistryRecord[];
    readonly category: SourceCategory;
    readonly requiredEntities: readonly string[];
    readonly issues: string[];
  },
): GraphSourceRegistryRecord | undefined {
  const record = input.records.find((candidate) => candidate.source_id === sourceId);

  if (record === undefined) {
    input.issues.push(`${path}: "${sourceId}" is not present in ${RECORDS_LABEL}`);
    return undefined;
  }
  if (!isGraphRecord(record)) {
    input.issues.push(`${path}: "${sourceId}" is not a Graph source`);
    return undefined;
  }
  if (record.category !== input.category) {
    input.issues.push(
      `${path}: "${sourceId}" is category "${record.category}", expected "${input.category}"`,
    );
    return undefined;
  }
  if (record.status !== "active") {
    input.issues.push(`${path}: "${sourceId}" is ${record.status}`);
    return undefined;
  }

  const missingEntities = input.requiredEntities.filter(
    (entity) => !record.supported_entities.includes(entity),
  );
  if (missingEntities.length > 0) {
    input.issues.push(`${path}: "${sourceId}" does not support ${missingEntities.join(", ")}`);
    return undefined;
  }

  return record;
}

/**
 * The one query text must serve every selected deployment, so query, response
 * contract, and schema tier all have to agree across the joined set.
 */
function collectSharedContractIssues(
  bindings: readonly { readonly query_id: string; readonly schema_contract_id: string }[],
  joinedSourceTypes: readonly string[],
  path: BindingPath,
): string[] {
  return [
    ...collectSharedValueIssues(
      bindings.map((binding) => binding.query_id),
      (index) => path(index, "query_id"),
      "query_id",
    ),
    ...collectSharedValueIssues(
      bindings.map((binding) => binding.schema_contract_id),
      (index) => path(index, "schema_contract_id"),
      "schema_contract_id",
    ),
    ...collectSharedValueIssues(
      joinedSourceTypes,
      (index) => path(index, "source_id"),
      "source_type",
    ),
  ];
}

/**
 * Joins the active `compare_pools` profile to its registry records and returns
 * the bindings in ascending priority order. Throws on any invalid local
 * configuration: a bad deploy must fail loudly rather than query fewer sources.
 */
export function getActiveComparePoolGraphSources(
  options: RegistryLoadOptions = {},
): readonly ComparePoolGraphSource[] {
  const records = loadRecords(options.records);
  const profile = loadProfile(options.profile);
  const requiredEntities = options.requiredEntities ?? [];

  const issues: string[] = [
    ...(profile.token0 === profile.token1
      ? [`${COMPARE_POOLS_LABEL}.token1: must differ from token0 "${profile.token0}"`]
      : []),
    ...collectDuplicateIssues(profile.sources, "source_id", bindingPath),
    ...collectDuplicateIssues(profile.sources, "pool_address", bindingPath),
    ...collectDuplicateIssues(profile.sources, "priority", bindingPath),
  ];

  const joined: ComparePoolGraphSource[] = [];

  profile.sources.forEach((binding, index) => {
    const record = resolveGraphRecord(binding.source_id, bindingPath(index, "source_id"), {
      records,
      category: "dex",
      requiredEntities,
      issues,
    });
    if (record === undefined) {
      return;
    }

    joined.push({
      profile_id: profile.profile_id,
      source_id: binding.source_id,
      priority: binding.priority,
      pool_address: binding.pool_address,
      token0: profile.token0,
      token1: profile.token1,
      window_methodology: profile.window_methodology,
      query_id: binding.query_id,
      schema_contract_id: binding.schema_contract_id,
      record,
    });
  });

  issues.push(
    ...collectSharedContractIssues(
      profile.sources,
      joined.map((source) => source.record.source_type),
      bindingPath,
    ),
  );

  if (issues.length > 0) {
    throw new RegistryConfigurationError(issues);
  }

  return deepFreeze(joined.sort((left, right) => left.priority - right.priority));
}

/**
 * Lending analogue of {@link getActiveComparePoolGraphSources}: joins the
 * `compare_lending_markets` profile to its registry records and returns the
 * bindings in ascending priority order.
 */
export function getActiveCompareLendingGraphSources(
  options: RegistryLoadOptions = {},
): readonly CompareLendingGraphSource[] {
  const records = loadRecords(options.records);
  const profile = loadLendingProfile(options.profile);
  const requiredEntities = options.requiredEntities ?? [];

  const issues: string[] = [
    ...collectDuplicateIssues(profile.sources, "source_id", lendingBindingPath),
    ...collectDuplicateIssues(profile.sources, "priority", lendingBindingPath),
  ];

  const joined: CompareLendingGraphSource[] = [];

  profile.sources.forEach((binding, index) => {
    const record = resolveGraphRecord(binding.source_id, lendingBindingPath(index, "source_id"), {
      records,
      category: "lending",
      requiredEntities,
      issues,
    });
    if (record === undefined) {
      return;
    }

    joined.push({
      profile_id: profile.profile_id,
      source_id: binding.source_id,
      priority: binding.priority,
      market_token: profile.market_token,
      query_id: binding.query_id,
      schema_contract_id: binding.schema_contract_id,
      record,
    });
  });

  issues.push(
    ...collectSharedContractIssues(
      profile.sources,
      joined.map((source) => source.record.source_type),
      lendingBindingPath,
    ),
  );

  if (issues.length > 0) {
    throw new RegistryConfigurationError(issues);
  }

  return deepFreeze(joined.sort((left, right) => left.priority - right.priority));
}
