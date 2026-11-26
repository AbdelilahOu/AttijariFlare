import { z } from "zod";

export const reextractStatementSchema = z.object({ statementId: z.string().min(1) });
