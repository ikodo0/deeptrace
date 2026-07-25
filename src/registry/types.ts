import type { SourceType } from "../schemas/source-adapter.js";

export type SourceCategory = "dex";

export type RegistrySourceStatus = "active" | "inactive";

interface SourceRegistryRecordBase {
  source_id: string;
  category: SourceCategory;
  protocol: string;
  chain_id: 8453;
  deployment_or_view_id: string;
  schema_version: string | null;
  methodology_version: string | null;
  supported_entities: readonly string[];
  status: RegistrySourceStatus;
}

export interface GraphSourceRegistryRecord extends SourceRegistryRecordBase {
  source_type: Extract<SourceType, "standardized_subgraph" | "native_subgraph">;
  locator: {
    kind: "graph_subgraph";
    gateway_host: "gateway.thegraph.com";
    subgraph_id: string;
  };
}

export interface NuthatchSourceRegistryRecord extends SourceRegistryRecordBase {
  source_type: Extract<SourceType, "nuthatch_view">;
  locator: {
    kind: "nuthatch_view";
    base_url_env: "NUTHATCH_BASE_URL";
    view_id: string;
  };
}

export type SourceRegistryRecord = GraphSourceRegistryRecord | NuthatchSourceRegistryRecord;
