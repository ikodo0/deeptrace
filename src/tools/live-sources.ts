import {
  getActiveComparePoolGraphSources,
  getSourceById,
  RegistryConfigurationError,
} from "../registry/index.js";
import type { NuthatchSourceRegistryRecord } from "../registry/types.js";
import type { PoolSourceResult } from "../schemas/source-adapter.js";
import { M0_COMPARE_POOLS_SCOPE } from "../scope/compare-pools.js";
import { fetchComparePoolGraphSource } from "../sources/graph/index.js";
import {
  createNuthatchFailureResult,
  fetchNuthatchFreshness,
} from "../sources/nuthatch/adapter.js";
import { createNuthatchClient, type NuthatchClient } from "../sources/nuthatch/client.js";

import type { ComparePoolsSourceGateway } from "./compare-pools-sources.js";

type Environment = Readonly<Record<string, string | undefined>>;

export interface LiveComparePoolsSourcesOptions {
  readonly apiKey?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
  readonly environment?: Environment;
  readonly nuthatchBaseUrl?: string;
  /** Epoch-second clock used to timestamp the Nuthatch observation. */
  readonly nuthatchClock?: () => number;
}

function activeNuthatchRecord(): NuthatchSourceRegistryRecord {
  const sourceId = M0_COMPARE_POOLS_SCOPE.nuthatchSourceId;
  const record = getSourceById(sourceId);
  if (record === undefined) {
    throw new RegistryConfigurationError([
      `records.json: required Nuthatch source "${sourceId}" is missing`,
    ]);
  }
  if (record.source_type !== "nuthatch_view") {
    throw new RegistryConfigurationError([
      `records.json: required Nuthatch source "${sourceId}" has type "${record.source_type}"`,
    ]);
  }
  if (record.status !== "active") {
    throw new RegistryConfigurationError([
      `records.json: required Nuthatch source "${sourceId}" is ${record.status}`,
    ]);
  }
  return record;
}

/**
 * Live Graph and Nuthatch gateway for the locked compare_pools allowlist.
 */
export function createLiveComparePoolsSources(
  options: LiveComparePoolsSourcesOptions = {},
): ComparePoolsSourceGateway {
  const nuthatchRecord = activeNuthatchRecord();
  const environment = options.environment ?? process.env;
  const configuredBaseUrl =
    options.nuthatchBaseUrl ?? environment[nuthatchRecord.locator.base_url_env];
  let nuthatchClient: NuthatchClient | null = null;
  let nuthatchSetupWarning: string | null = null;

  if (configuredBaseUrl === undefined || configuredBaseUrl.trim() === "") {
    nuthatchSetupWarning = `Nuthatch source is unavailable because ${nuthatchRecord.locator.base_url_env} is not configured.`;
  } else {
    try {
      nuthatchClient = createNuthatchClient({
        baseUrl: configuredBaseUrl,
        ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
        ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
      });
    } catch {
      nuthatchSetupWarning = `Nuthatch source initialization rejected ${nuthatchRecord.locator.base_url_env}; details were redacted.`;
    }
  }

  return {
    fetchGraphResults(): Promise<readonly PoolSourceResult[]> {
      const bindings = getActiveComparePoolGraphSources();
      return Promise.all(
        bindings.map((binding) =>
          fetchComparePoolGraphSource(binding, {
            ...(options.apiKey !== undefined ? { apiKey: options.apiKey } : {}),
            ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
            ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
          }),
        ),
      );
    },
    async fetchNuthatchResult() {
      if (nuthatchClient === null) {
        return createNuthatchFailureResult(
          nuthatchRecord,
          "error",
          nuthatchSetupWarning ?? "Nuthatch source initialization failed.",
        );
      }

      try {
        return await fetchNuthatchFreshness({
          client: nuthatchClient,
          clock: options.nuthatchClock ?? (() => Math.floor(Date.now() / 1_000)),
          record: nuthatchRecord,
        });
      } catch {
        return createNuthatchFailureResult(
          nuthatchRecord,
          "error",
          "Nuthatch live source failed unexpectedly; details were redacted.",
        );
      }
    },
  };
}
