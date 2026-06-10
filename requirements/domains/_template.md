---
domain: <domain-slug>
bounded_context: <repo-or-service-name>
participants:
  - REQ-CAP-<A>
  - REQ-CAP-<B>
  - REQ-INT-<C>
---

# <Domain name>

<1-2 sentence overview of the bounded context.>

## Data model

<Shared tables, types, or schemas that multiple CAPs read/write.
Include the column-level schema if it's the source of truth for
this context. Note which invariant REQs apply (e.g., RLS triplet,
append-only).>

## <Protocol name>

Participants: REQ-CAP-<A> (role), REQ-CAP-<B> (role)

<Describe the interaction contract in ≤20 lines. Who produces
what, who consumes it, what the boundary semantics are. Include
design decision rationale here — not in the individual REQs.>

## <Another protocol>

Participants: REQ-CAP-<B> (role), REQ-INT-<C> (role)

<Same pattern. Each protocol section is a heading that REQ files
reference in their `protocols:` frontmatter field.>

## Component reuse rules

<For frontend domains: which component library, what's allowed
locally vs shared, how tokens.json is consumed.>

## Figma surfaces

<Optional. Table mapping surface slugs to Figma nodes and the CAPs
they serve.>

| Surface | Node | CAPs served |
|---------|------|-------------|
| `<surface>` | `<node-id>` | <REQ-ids> |
