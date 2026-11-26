import { categoryKinds } from "@finance-ttijari/db/schema/enums";
import { z } from "zod";

const name = z.string().trim().min(1).max(60);
const color = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, "Use a #rrggbb color")
  .nullable();

export const createCategorySchema = z.object({
  name,
  kind: z.enum(categoryKinds),
  color: color.default(null),
  parentId: z.string().min(1).nullable().default(null),
});

export const updateCategorySchema = z.object({
  id: z.string().min(1),
  name: name.optional(),
  kind: z.enum(categoryKinds).optional(),
  color: color.optional(),
  parentId: z.string().min(1).nullable().optional(),
});

export const deleteCategorySchema = z.object({ id: z.string().min(1) });
