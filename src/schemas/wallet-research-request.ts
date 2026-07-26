import { z } from "zod";

import {
  WALLET_RESEARCH_SCOPE,
  WALLET_RESEARCH_SECTIONS,
  WALLET_RESEARCH_WINDOWS,
} from "../scope/wallet-research.js";
import { BASE_CHAIN_ID } from "./source-adapter.js";

const walletAddressSchema = z
  .string()
  .regex(/^0x[0-9a-f]{40}$/, "Expected a lowercase public Ethereum address");

const cursorSchema = z
  .string()
  .min(1)
  .max(WALLET_RESEARCH_SCOPE.cursor.maximumLength)
  .refine((value) => value.trim() === value, "Cursor must not contain surrounding whitespace");

export const researchWalletRequestSchema = z
  .object({
    chain_id: z.literal(BASE_CHAIN_ID),
    address: walletAddressSchema,
    sections: z
      .array(z.enum(WALLET_RESEARCH_SECTIONS))
      .min(1)
      .max(WALLET_RESEARCH_SECTIONS.length)
      .refine((sections) => new Set(sections).size === sections.length, "Sections must be unique")
      .default([...WALLET_RESEARCH_SECTIONS]),
    window: z.enum(WALLET_RESEARCH_WINDOWS).default("24h"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(WALLET_RESEARCH_SCOPE.limit.maximum)
      .default(WALLET_RESEARCH_SCOPE.limit.default),
    cursor: cursorSchema.nullable().default(null),
  })
  .strict();

export type ResearchWalletRequest = z.infer<typeof researchWalletRequestSchema>;
export type ResearchWalletRequestInput = z.input<typeof researchWalletRequestSchema>;
