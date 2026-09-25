import { z } from "zod";
export const id = z.string().regex(/^[a-f0-9]{24}$/i, "Select a valid record");
export const text = z.string().trim().min(1).max(500);
export const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => !Number.isNaN(Date.parse(s)), "Invalid date");
