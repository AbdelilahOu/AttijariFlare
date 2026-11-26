import { z } from "zod";

import { MONTH_PATTERN } from "../reports";

const month = z.string().regex(MONTH_PATTERN, "Expected YYYY-MM");

export const monthRangeSchema = z
  .object({ from: month, to: month })
  .refine((range) => range.from <= range.to, { message: "`from` must not be after `to`" });

export const optionalMonthRangeSchema = z
  .object({ from: month.optional(), to: month.optional() })
  .default({});
