"use server";

import { z } from "zod";

import { action, ActionError } from "@/lib/action";
import { issueCode } from "@/lib/connector/oauth";

import { checkAuthorizeRequest } from "./request";

const request = z.object({
  client_id: z.string().max(4000),
  redirect_uri: z.string().max(2000),
  code_challenge: z.string().max(200),
  code_challenge_method: z.string().max(20),
  state: z.string().max(2000),
  resource: z.string().max(2000),
  allow: z.boolean(),
});

/**
 * Allow or Deny on the consent page (#221): where to send the browser back
 * to Claude, with a code or with "access_denied". The page navigates there
 * itself, since the page's form-action policy keeps forms on this site.
 */
export const answerConnector = action(request, async (input) => {
  const { allow, ...params } = input;
  const checked = await checkAuthorizeRequest({ ...params, response_type: "code" });
  if ("error" in checked) throw new ActionError(checked.error);
  const back = new URL(checked.redirectUri);
  if (allow) back.searchParams.set("code", await issueCode(checked));
  else back.searchParams.set("error", "access_denied");
  if (checked.state) back.searchParams.set("state", checked.state);
  return { url: back.toString() };
});
