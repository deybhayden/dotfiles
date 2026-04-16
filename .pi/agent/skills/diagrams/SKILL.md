---
name: diagrams
description: Create diagrams. Improve Draw.io / diagrams.net architecture diagrams for readability and presentation quality. Use when editing .drawio files, reviewing exported PNGs, fixing spacing, making text readable in dark mode, simplifying arrow routing, or polishing executive/architecture visuals.
---

# Diagrams Skill

Use this skill when working on Draw.io / diagrams.net files, especially architecture diagrams exported as PNGs for reviews, docs, or presentations.

## Core Goal

Make the diagram easy to read in both:

- exported PNGs / documentation
- the Draw.io editor, including dark mode

Prefer clarity over density. If a diagram feels cramped, **use more space** instead of shrinking text.

## Inputs to Review

Whenever possible, inspect all of:

1. the `.drawio` source
2. the exported `.png`
3. a screenshot from Draw.io if the user provides one

The `.drawio` file tells you structure. The PNG/screenshot tells you what humans can actually read.

## Workflow

1. Read the `.drawio` XML.
2. Review the exported PNG and any editor screenshot.
3. Identify readability problems first:
   - text too small
   - text crossed by arrows
   - labels trapped in crowded boundaries
   - too much zig-zag routing
   - dark mode text disappearing
4. Adjust layout before tweaking fine details:
   - enlarge canvas
   - enlarge swimlanes / regions / panels
   - increase whitespace between columns
   - widen or heighten boxes that contain dense text
5. Simplify labels and routing.
6. Ensure shapes render above arrows.
7. Tell the user to re-export the PNG and review again.

## Diagram Readability Rules

### 1) Spacing beats compression

- If words are hard to read, increase `pageWidth`, `pageHeight`, `dx`, and `dy`.
- Enlarge containers before reducing font size.
- Add horizontal space between major sections when cross-section arrows or labels are present.
- Add vertical space below important shapes like databases when backup / ops / notes must fit beneath them.

### 2) Use simpler wording in executive diagrams

- Executive diagrams should use shorter labels than implementation diagrams.
- Replace long hostnames or full repo lists with grouped labels when possible.
- Prefer concise summaries like:
  - `app · get · admin · api`
  - `Warm DR ECS on Fargate`
  - `Primary writer cluster`

### 3) Horizontal headers are easier to read

For account / region / panel containers:

- prefer horizontal swimlane headers
- avoid narrow vertical header bars when possible

### 4) Make text dark-mode-safe

For text-bearing shapes, set explicit text color:

- `fontColor=#111111`

When Draw.io dark mode causes shapes to look invisible or washed out, also consider explicit:

- `opacity=100`
- `fillOpacity=100`
- `strokeWidth=2`

## Arrow and Routing Rules

### 5) Shapes must render above arrows

To avoid arrows crossing through text:

- place edge `mxCell`s before vertex `mxCell`s in XML order
- this keeps connectors behind boxes/clouds/notes in Draw.io rendering

### 6) Minimize zig-zagging

- Keep arrows as straight and direct as possible.
- Prefer one clean orthogonal bend over multiple turns.
- Use explicit waypoint points (`mxPoint`) when auto-routing creates noisy paths.
- For repeated vertical flows, align boxes so arrows can go straight down.

### 7) Don’t force important labels onto crowded edges

If edge labels become unreadable:

- remove the edge label
- add a small standalone text box in nearby whitespace instead

This works especially well in tight boundaries between accounts or regions.

### 8) Protect edge label readability

When an edge label must remain on the line, use:

- `labelBackgroundColor=#ffffff`
- `fontColor=#111111`

## Box Sizing Rules

### 9) Dense boxes need more room than you think

Common offenders:

- backup boxes
- runbook / operational sequence boxes
- notes / legend boxes
- ECS boxes listing several services
- route / weight boxes with multiple lines

If text feels even slightly crowded in the PNG, enlarge the shape.

### 10) Notes belong in note boxes, not on spaghetti arrows

For explanatory content, prefer dashed note boxes over long edge labels.
This is especially useful for:

- traffic behavior
- DB state summaries
- operational sequences
- runbook / RPO / RTO summaries

## Common Review Fixes

Apply these patterns when relevant:

- **Cloud text crossed by arrows** → reorder edges behind shapes
- **Words clipped in backup box** → increase height/width
- **Unreadable labels between sections** → widen the gap and move text into standalone labels
- **Diagram too stretched vertically but still crowded** → rebalance with wider canvas and better column spacing
- **Too many components for the audience** → remove nonessential boxes when the user says they are not needed
- **Dark mode unreadable** → enforce `fontColor`, and if needed `opacity` / `fillOpacity`

## Legend Guidance

Be explicit and consistent.
Preferred wording:

- `Solid lines = primary live production path`
- `Dashed lines = standby, replication, or failover path`

If some dashed lines are operational/admin paths, make sure the legend still matches the real meaning or call out exceptions.

## ID Safety Rules

When rebuilding or duplicating sections in `.drawio` XML:

- never reuse `mxCell` IDs for different objects
- use distinct ID ranges for alternate states or duplicated panels
- if a section goes missing after edits, suspect ID collisions first

## Practical Editing Guidance

- Use `edit` for small targeted changes.
- Use `write` for full diagram rewrites or XML rebuilds.
- After major layout changes, re-read the `.drawio` to verify IDs, geometry, and styles are valid.
- If a user is iterating from screenshots, expect multiple review/export rounds.

## Quality Checklist

Before calling the diagram ready, verify:

- all important words are readable in the PNG
- nothing important is hidden behind arrows
- edge routing is mostly straight and intentional
- section spacing feels generous, not cramped
- labels are concise enough for the audience
- dark mode still shows text clearly in Draw.io
- legend wording matches the actual line semantics

For more detailed guidance, see [the Draw.io reference](references/drawio-guidelines.md).
