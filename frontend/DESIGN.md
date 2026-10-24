# Front-end design decisions

Direction from the ui-ux-pro-max design database ("government procurement compliance dashboard", variance 3, motion 2,
density 8): **Minimalism / Swiss style**, *Trust & Authority*, avoiding "AI purple/pink gradients".

| Decision | Choice | Why |
|---|---|---|
| Colours | Navy `#1E3A8A` for actions and the current page; amber `#B45309` only for warnings; red only for risk; slate neutrals | Authority and calm; colour carries meaning, never decoration |
| Type | Fira Sans (text), Fira Code (references, hashes, IDs) | The database's "Dashboard Data" pairing. Its first suggestion, EB Garamond, is a serif that scans poorly in dense tables |
| Surfaces | White panels, 1px borders, 6px radius, no shadows | Reads as an institutional tool rather than a marketing template |
| Navigation | Light sidebar grouped by task; page title + date + role, no greetings | Predictable, like GOV.UK-style admin tools |
| Figures | One bordered summary strip; tabular numerals | Compare at a glance without decorative icon tiles |
| Status | Dot + word | Readable without colour (WCAG 1.4.1) |
| Motion | Colour and background transitions only, 150 ms; none under reduced motion | Functional, never decorative |
| Accessibility | Text contrast 4.5:1+, visible focus ring, labels on every field, 44px touch targets on phones | NFR 3.6.2 (WCAG 2.1 AA) |

## Reference designs

The procurement history timeline (`/oversight/history`) follows the 21st.dev "Activity Timeline" pattern: events grouped by
day along a vertical rail. It was rebuilt with this project's own components and colours rather than copied, because the
original is TypeScript on shadcn/ui, which this front end does not use.
