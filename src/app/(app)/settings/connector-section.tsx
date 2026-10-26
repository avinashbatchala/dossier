"use client";

import { useState } from "react";

import { useTrackSave } from "@/components/save-tracker";
import { toast, toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Toggle } from "@/components/ui/toggle";
import { copyText } from "@/lib/copy-text";

import { disconnectClaude, setConnector } from "./actions";
import { SettingsSectionIntro } from "./settings-screen";

const LINK = "font-medium text-ink underline underline-offset-2";

/**
 * Settings → Claude connector (#221): Dossier as a connector in Claude, off
 * until it's turned on here. Then it shows the address to add in Claude,
 * and Disconnect Claude signs every Claude out.
 */
export function ConnectorSection({ initial, address }: { initial: { on: boolean }; address: string }) {
  const track = useTrackSave();
  const [on, setOn] = useState(initial.on);
  const local = /^http:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(address);
  const publicHttps = address.startsWith("https://");

  const turn = async (next: boolean) => {
    setOn(next);
    const result = toastResult(await track(setConnector({ on: next })));
    if (!result.ok) setOn(!next);
  };

  const copy = async () => toast((await copyText(address)) ? "Address copied." : "Couldn't copy it. Select the address and copy it instead.");

  return (
    <>
      <SettingsSectionIntro title="Claude connector">
        Use Dossier from Claude: in chats on claude.ai, in the Desktop and mobile apps, and in Claude&apos;s command-line app. Claude can search for jobs, read your
        profile and applications, and save the applications and fit scores it writes, on your own Claude plan. It never sends or deletes anything.
      </SettingsSectionIntro>

      <Card padding="none" className="px-7 py-4">
        <Toggle
          label="Let Claude connect"
          description={
            on
              ? "On. Claude connects at the address below, once you've signed in to Dossier and allowed it."
              : "Off. The connector's addresses aren't open on this server."
          }
          checked={on}
          onCheckedChange={(checked) => void turn(checked)}
        />
      </Card>

      {on && (
        <>
          <Card className="flex flex-col gap-4">
            <div className="flex flex-col gap-[7px]">
              <span className="text-label text-muted">Address to add in Claude</span>
              <div className="flex flex-wrap items-center gap-3">
                <code className="min-w-0 flex-1 rounded-control border border-line-input bg-input px-3 py-2 font-mono text-[13px] [overflow-wrap:anywhere]">
                  {address}
                </code>
                <Button variant="secondary" size="sm" onClick={() => void copy()}>
                  Copy
                </Button>
              </div>
            </div>
            <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm text-pretty">
              <li>
                In Claude, open <strong>Settings → Connectors</strong> and choose <strong>Add custom connector</strong>.
              </li>
              <li>
                Name it <strong>Dossier</strong>, paste the address and press <strong>Add</strong>, then <strong>Connect</strong>.
              </li>
              <li>
                Claude opens Dossier: sign in if it asks, check what Claude may do, and press <strong>Allow</strong>.
              </li>
            </ol>
            <p className="text-meta text-muted">
              In Claude&apos;s command-line app: <code className="font-mono text-label">claude mcp add --transport http dossier {address}</code>, then{" "}
              <code className="font-mono text-label">/mcp</code> to sign in.
            </p>
            {!publicHttps && (
              <p role="note" className="rounded-card bg-warning-surface px-4 py-3 text-meta text-warning">
                {local ? "This is a local address. " : "This address isn't HTTPS. "}
                Claude on the web, Desktop and mobile reaches Dossier from Anthropic&apos;s servers, so they need a public HTTPS address (set{" "}
                <code className="font-mono text-label">DOSSIER_PUBLIC_URL</code> if Dossier is reached at another one). Claude&apos;s command-line app on the
                computer Dossier runs on can use this one.
              </p>
            )}
          </Card>

          <Card className="flex flex-col gap-3 text-sm text-pretty">
            <p>
              What Claude reads through the connector goes to Anthropic with your Claude account, as anything in a chat does: your profile
              without its contact details, the postings and applications it works on, and your searches. Private notes and the letter&apos;s
              sender and signature stay out.{" "}
              <a href="https://github.com/AienTech/dossier/wiki/Connecting-Claude" target="_blank" rel="noopener noreferrer" className={LINK}>
                Connecting Claude
              </a>{" "}
              has the details.
            </p>
            <p className="text-muted">
              Without an AI model of Dossier&apos;s own, New application and Score in Find jobs hand the work to a new Claude chat, which saves it
              here through the connector.
            </p>
            <div>
              <Button
                variant="secondary"
                onClick={() => void track(disconnectClaude({})).then(toastResult)}
              >
                Disconnect Claude
              </Button>
              <p className="mt-2 text-meta text-muted">Signs every Claude out. Changing your password or DOSSIER_SECRET does too.</p>
            </div>
          </Card>
        </>
      )}
    </>
  );
}
