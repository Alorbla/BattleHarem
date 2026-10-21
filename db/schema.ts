import { integer, sqliteTable, text, index } from "drizzle-orm/sqlite-core";

export const rooms = sqliteTable("rooms", {
  code: text("code").primaryKey(),
  version: integer("version").notNull().default(0),
  state: text("state").notNull(),
  updatedAt: integer("updated_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
}, table => [index("rooms_expiry_idx").on(table.expiresAt)]);
