import { z } from "zod";

const safeNonNegativeIntegerSchema = z
  .number()
  .int()
  .nonnegative()
  .refine(Number.isSafeInteger, "Expected a safe integer");
const hashSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const signedIntegerSchema = z
  .string()
  .max(79)
  .regex(/^(?:0|-?[1-9]\d*)$/);

const readySchema = z
  .object({
    ready: z.boolean(),
    last_block: safeNonNegativeIntegerSchema.optional(),
    sealed_through: safeNonNegativeIntegerSchema.optional(),
    tip: safeNonNegativeIntegerSchema,
  })
  .passthrough()
  .superRefine((value, context) => {
    if (value.last_block === undefined && value.sealed_through === undefined) {
      context.addIssue({
        code: "custom",
        message: "Expected last_block or sealed_through",
      });
    }
  });

export interface LargeSwapReady {
  readonly ready: boolean;
  readonly indexedHead: number;
  readonly tip: number;
}

export function parseLargeSwapReady(value: unknown): LargeSwapReady | null {
  const parsed = readySchema.safeParse(value);
  if (!parsed.success) {
    return null;
  }
  const indexedHead = parsed.data.last_block ?? parsed.data.sealed_through;
  if (indexedHead === undefined || parsed.data.tip < indexedHead) {
    return null;
  }
  return {
    ready: parsed.data.ready,
    indexedHead,
    tip: parsed.data.tip,
  };
}

const rowSchema = z
  .object({
    pool_address: addressSchema,
    block_number: safeNonNegativeIntegerSchema,
    block_hash: hashSchema,
    block_timestamp: safeNonNegativeIntegerSchema,
    transaction_hash: hashSchema,
    log_index: safeNonNegativeIntegerSchema,
    amount0_raw: signedIntegerSchema,
    amount1_raw: signedIntegerSchema,
  })
  .strict();

const receiptSchema = z
  .object({
    count: safeNonNegativeIntegerSchema,
    provenance: z
      .object({
        as_of: safeNonNegativeIntegerSchema,
        registry_hash: hashSchema,
        sealed_through: safeNonNegativeIntegerSchema,
        source: z.string().min(1),
      })
      .passthrough(),
    rows: z.array(rowSchema),
    truncated: z.boolean(),
  })
  .passthrough();

export type NuthatchLargeSwapRow = z.infer<typeof rowSchema>;

export interface NuthatchLargeSwapReceipt {
  readonly asOf: number;
  readonly rows: readonly NuthatchLargeSwapRow[];
}

export function parseLargeSwapReceipt(
  value: unknown,
  expectedRegistryHash: string,
): NuthatchLargeSwapReceipt | null {
  const parsed = receiptSchema.safeParse(value);
  if (!parsed.success) {
    return null;
  }
  const receipt = parsed.data;
  if (
    receipt.truncated ||
    receipt.count !== receipt.rows.length ||
    receipt.provenance.registry_hash.toLowerCase() !== expectedRegistryHash.toLowerCase() ||
    receipt.rows.some((row) => row.block_number > receipt.provenance.as_of)
  ) {
    return null;
  }

  return {
    asOf: receipt.provenance.as_of,
    rows: receipt.rows.map((row) => ({
      ...row,
      pool_address: row.pool_address.toLowerCase(),
      block_hash: row.block_hash.toLowerCase(),
      transaction_hash: row.transaction_hash.toLowerCase(),
    })),
  };
}
