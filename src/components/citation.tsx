import { Fragment } from "react";

import { citationSpans } from "@/lib/citation";

/** A publication's citation (#218), its **bold** and *italic* drawn as such. */
export function CitationText({ text }: { text: string }) {
  return citationSpans(text.trim()).map((span, index) => {
    const content = span.italic ? <em>{span.text}</em> : span.text;
    return span.bold ? <strong key={index}>{content}</strong> : <Fragment key={index}>{content}</Fragment>;
  });
}
