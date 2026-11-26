import { z } from "zod";

export const statementIdSchema = z.object({ id: z.string().min(1) });

export const uploadStatementSchema = z.object({ file: z.instanceof(File) });
