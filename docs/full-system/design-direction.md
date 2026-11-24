# Design direction (M4)

Three directions were explored with the same information architecture and content, so that only the visual language differs. The concepts are generated mockups (`design/concept-*.jpg`): their photos and event names are illustrative, not content.

| Criterion | A — Field Journal | B — Rainforest Modern | C — Refined neo-brutalist |
|---|---|---|---|
| Hierarchy and scannability | Good | **Best**: one primary colour, conventional search, cards and status badges | Weakest: every element is outlined, so nothing stands out |
| Scales to dense screens (compare tables, journey planner, staff console) | Medium | **Best** | Poor: borders and offset shadows add noise |
| Contrast and accessibility | Good; sage tiles are low contrast | **Best**: white surfaces, near-black text, green primary | Good contrast but high visual load |
| Character and warmth | **Best** | Risk of looking generic | Distinctive |
| Cultural appropriateness | Fine | Fine | Risk: pua kumbu motifs carry cultural and spiritual meaning and should not be used as decoration |
| Auto/Light/Dark theming | Medium | Easy | Medium |

**Selected: B "Rainforest Modern" as the base, with A's editorial accents.**

- **Base:** white and warm-neutral surfaces, near-black text, one strong rainforest-green primary (`#0F5C45`), hornbill-gold highlights, 12 px radii, soft shadows, photography-led cards.
- **From A:** Lora serif for display headings, which keeps the brand warm and readable on content pages such as visitor information.
- **Retired:** the AS03 neo-brutalist theme (C). The AS03 branch keeps it.

## Rules that follow from the choice

- One primary action per view, in green. Secondary actions are outlined. Destructive actions are red and always confirmed.
- Status is never shown by colour alone. Every badge has text and an icon (Scheduled, Postponed, Cancelled, Unavailable, Illustrative data).
- Every record shows its provenance: verified (with source and review date), operator-supplied, or illustrative.
- Any action that leaves STIS for an external provider is labelled with an outbound icon and the provider's domain.
- Body text is at least 16 px; focus rings are visible and 3 px. Every text pair meets WCAG AA in all three themes, and reduced motion is respected.
