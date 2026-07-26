import { getSourceById, RegistryConfigurationError } from "../registry/index.js";
import type { NuthatchSourceRegistryRecord } from "../registry/types.js";
import { LSS_SCOPE } from "../scope/large-swaps.js";
import {
  createLargeSwapSourceFailure,
  fetchNuthatchLargeSwapCandidates,
  largeSwapSourceProvenance,
} from "../sources/nuthatch/large-swaps-adapter.js";
import { createNuthatchClient, type NuthatchClient } from "../sources/nuthatch/client.js";

import type { LargeSwapSourceGateway } from "./large-swaps-source.js";

type Environment = Readonly<Record<string, string | undefined>>;

export interface LiveLargeSwapSourceOptions {
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
  readonly environment?: Environment;
  readonly nuthatchBaseUrl?: string;
  readonly clock?: () => number;
}

function activeLargeSwapRecord(): NuthatchSourceRegistryRecord {
  const record = getSourceById(LSS_SCOPE.source.sourceId);
  if (record === undefined) {
    throw new RegistryConfigurationError([
      `records.json: required LSS source "${LSS_SCOPE.source.sourceId}" is missing`,
    ]);
  }
  if (record.source_type !== "nuthatch_view") {
    throw new RegistryConfigurationError([
      `records.json: required LSS source "${LSS_SCOPE.source.sourceId}" has type "${record.source_type}"`,
    ]);
  }
  if (record.status !== "active") {
    throw new RegistryConfigurationError([
      `records.json: required LSS source "${LSS_SCOPE.source.sourceId}" is ${record.status}`,
    ]);
  }
  return record;
}

export function createLiveLargeSwapSource(
  options: LiveLargeSwapSourceOptions = {},
): LargeSwapSourceGateway {
  const record = activeLargeSwapRecord();
  const environment = options.environment ?? process.env;
  const configuredBaseUrl = options.nuthatchBaseUrl ?? environment[record.locator.base_url_env];
  let client: NuthatchClient | null = null;
  let setupWarning: string | null = null;

  if (configuredBaseUrl === undefined || configuredBaseUrl.trim() === "") {
    setupWarning = `Large-swap source is unavailable because ${record.locator.base_url_env} is not configured.`;
  } else {
    try {
      client = createNuthatchClient({
        baseUrl: configuredBaseUrl,
        ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
        ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
      });
    } catch {
      setupWarning = `Large-swap source initialization rejected ${record.locator.base_url_env}; details were redacted.`;
    }
  }

  return {
    provenance: largeSwapSourceProvenance(record),
    async fetchCandidates(context) {
      if (client === null) {
        return createLargeSwapSourceFailure(
          record,
          "error",
          setupWarning ?? "Large-swap source initialization failed.",
        );
      }
      try {
        return await fetchNuthatchLargeSwapCandidates(
          {
            client,
            clock: options.clock ?? (() => Math.floor(Date.now() / 1_000)),
            record,
          },
          context,
        );
      } catch {
        return createLargeSwapSourceFailure(
          record,
          "error",
          "Large-swap live source failed unexpectedly; details were redacted.",
        );
      }
    },
  };
}
