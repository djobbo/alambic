import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/** Minimal demo table; Alchemy generates migrations under `./migrations` from this module. */
export const Notes = pgTable("notes", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
