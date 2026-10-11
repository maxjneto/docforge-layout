import type { LayoutDocument } from "../schema/document";
import { isSafeHref } from "../render/h";
import { diag, type Diagnostic } from "../validate/diagnostics";
import type { Structure } from "./structure";
import type { Link } from "./types";

/**
 * Links written as inline markdown are only known after parsing, so their scheme is
 * checked here (schema-validated links never reach this as unsafe). Internal `#id`
 * links must point at a placed component or a section.
 */
export function checkLinks(links: Link[], doc: LayoutDocument, structure: Structure, out: Diagnostic[]): void {
  const targets = new Set([...structure.components.keys(), ...doc.sections.map((s) => s.id)]);
  for (const link of links) {
    if (!isSafeHref(link.href)) {
      out.push(
        diag("error", "unsafe-link", `"${link.component}" has a link to "${link.href}"; only https://, http://, mailto: and #id are allowed. It renders as plain text.`, {
          component: link.component,
          suggestions: ["Use an https:// URL, a mailto: address or #component-id / #section-id."],
        }),
      );
      continue;
    }
    if (!link.href.startsWith("#")) continue;
    const target = link.href.slice(1);
    if (!targets.has(target)) {
      out.push(
        diag("warning", "unknown-link-target", `"${link.component}" links to "${link.href}", which is not a component or section id.`, {
          component: link.component,
          suggestions: [`Use #component-id or #section-id, e.g. ${[...targets].slice(0, 4).map((t) => `#${t}`).join(", ")}.`],
        }),
      );
    } else if (structure.components.has(target) && !structure.placedAt.has(target)) {
      out.push(diag("warning", "unknown-link-target", `"${link.component}" links to "${link.href}", which is not placed in any band.`, { component: link.component }));
    }
  }
}
