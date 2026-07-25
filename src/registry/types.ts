import type { SourceType } from "../schemas/source-adapter.js";

export type SourceCategory = "dex";

export type RegistrySourceStatus = "active" | "inactive";

export interface SourceRegistryRecord {
  source_id: string;
  source_type: SourceType;
  category: SourceCategory;
  protocol: string;
  chain_id: 8453;
  deployment_or_view_id: string;
  schema_version: string | null;
  methodology_version: string | null;
  supported_entities: readonly string[];
  status: RegistrySourceStatus;
}
