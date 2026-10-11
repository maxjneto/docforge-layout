import { z } from "zod";
import { ColorSchema, HrefSchema } from "./values";

/**
 * One run of inline text. Size is a key of the `size` token scale (`s`, `m`, `l`…):
 * free pixel sizes inside a line would make measurement fragile.
 */
export const RunSchema = z
  .object({
    text: z.string(),
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    code: z.boolean().optional(),
    color: ColorSchema.optional(),
    highlight: z.union([z.boolean(), ColorSchema]).optional(),
    link: HrefSchema.optional(),
    size: z.string().optional(),
  })
  .strict();

export type Run = z.infer<typeof RunSchema>;

/**
 * Inline text: either a string with a small markdown subset
 * (`**bold**`, `*italic*`, `` `code` ``, `[text](url)`) or explicit runs
 * when color, highlight or size are needed.
 */
export const InlineSchema = z.union([z.string(), z.array(RunSchema)]);
export type Inline = z.infer<typeof InlineSchema>;

export const TEXT_ROLES = ["title-1", "title-2", "title-3", "subtitle", "body", "quote", "caption"] as const;
export type TextRole = (typeof TEXT_ROLES)[number];
export const TextRoleSchema = z.enum(TEXT_ROLES);
