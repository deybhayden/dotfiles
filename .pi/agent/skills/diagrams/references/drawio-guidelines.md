# Draw.io / diagrams.net Reference

## Recommended Style Snippets

### Text-safe box

```text
rounded=1;whiteSpace=wrap;html=1;fontColor=#111111;opacity=100;fillOpacity=100;strokeWidth=2;
```

### Readable edge label

```text
edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;endArrow=block;endFill=1;strokeWidth=2;labelBackgroundColor=#ffffff;fontColor=#111111;fontSize=14;
```

### Dashed edge

```text
...;dashed=1;
```

## Layout Heuristics

### Executive diagrams
- fewer boxes
- shorter labels
- stronger visual grouping
- more whitespace than implementation diagrams

### Detailed network diagrams
- separate major accounts / regions with generous gaps
- keep cross-account labels out of crowded boundaries
- use note boxes for behavior summaries
- widen panels before shrinking text

### Failover / state comparison diagrams
- use mirrored left/right panels
- keep matching shapes aligned vertically across states
- use parallel wording between steady state and failover state
- make state changes obvious through label changes and solid/dashed routing

## When to Use More Space

Increase canvas or panel size when:
- labels are longer than 3 lines
- more than one cross-panel edge passes through the same gap
- a note box needs a smaller font to fit
- bottom-of-panel boxes feel squeezed under a database or service box
- exported PNG looks okay at 100% in Draw.io but not in documentation or chat previews

## XML Ordering Reminder

If arrows appear on top of shapes:
- list edge cells before vertex cells in `<root>`
- Draw.io generally renders later cells above earlier cells

## Common Failure Modes

### 1. Missing shapes after edits
Likely causes:
- duplicate `mxCell id`
- invalid parent references
- malformed XML from partial rewrites

### 2. Text looks invisible in Draw.io dark mode
Likely causes:
- no explicit `fontColor`
- low opacity or editor rendering quirks

Fix with explicit:
- `fontColor=#111111`
- `opacity=100`
- `fillOpacity=100`

### 3. Edge labels unreadable
Likely causes:
- labels crossing section dividers
- too many arrows in one corridor
- label sitting on dashed line over dark background

Fix by:
- moving label to a standalone text box
- widening the corridor
- setting `labelBackgroundColor=#ffffff`

## Suggested Review Prompts

When reviewing a diagram, ask yourself:
- Can I read this without zooming?
- Do arrows explain the story or distract from it?
- Is this the right amount of detail for the intended audience?
- Are any boxes included only because they exist technically, but not because they help understanding?
- If I exported this to a slide or doc, would it still be legible?
