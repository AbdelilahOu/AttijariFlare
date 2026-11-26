import { transactionTypes } from "@attijari-flare/db/schema/enums";
import { z } from "zod";

// Each part is one INSERT in the batch; keep the batch small for D1 and the 10 ms CPU budget.
export const MAX_ALLOCATION_PARTS = 50;

const partSchema = z.object({
  amount: z.number().int().positive(),
  categoryId: z.string().min(1),
  note: z
    .string()
    .trim()
    .max(200)
    .optional()
    .nullable()
    .transform((note) => (note ? note : null)),
});

export const listAllocationsSchema = z.object({ transactionId: z.string().min(1) });

export const setAllocationsSchema = z.object({
  transactionId: z.string().min(1),
  parts: z.array(partSchema).max(MAX_ALLOCATION_PARTS),
});

export const deleteAllocationSchema = z.object({ id: z.string().min(1) });

export const listDebitsSchema = z
  .object({
    type: z.enum(transactionTypes).optional(),
    limit: z.number().int().min(1).max(200).default(100),
  })
  .default({ limit: 100 });
