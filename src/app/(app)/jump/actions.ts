"use server";

import { z } from "zod";

import { action } from "@/lib/action";

import { searchJump } from "./jump-search";

/** Jump to's results as the user types (E27-6). */
export const jumpSearch = action(z.object({ q: z.string().max(200) }), async ({ q }) => searchJump(q));
