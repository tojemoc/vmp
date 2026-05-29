# Admin homescreen layout — redesign plan

This document is a **plan only** (no implementation in the current PR). It captures the target experience described for the admin “homescreen layout” editor.

## Problem with the current admin UI

Today’s admin layout editor is a **form-driven list of blocks** (types, titles, categories, split options). It does not look or behave like the public homepage. Editors cannot see spacing, typography, or real video cards while arranging content, which makes iteration slow and error-prone.

## Design goal

**WYSIWYG admin surface = public homepage + editing chrome.**

| Public homepage | Admin homescreen layout |
|-----------------|-------------------------|
| Same block order, gaps, and responsive breakpoints | Identical render path (`buildHomepageRenderModel` + shared block components) |
| Read-only video cards | Click-to-select blocks; inline edit for title/body/category |
| No drag handles | Drag-and-drop reorder; optional resize handles for split blocks |
| — | Persistent “Save layout” / discard; preview mode toggle |

The only visible differences in admin mode should be: selection outlines, drag handles, block toolbars, and a top bar (save / preview / add block).

## Architecture (recommended)

### 1. Single render pipeline

- **One** set of Vue components for homepage blocks (e.g. `HomepageFeaturedRow`, `HomepageCategorySection`, `HomepageSplitBlock`).
- `pages/index.vue` and the admin layout tab both consume `HomepageRenderBlock[]` from `useHomepageLayout` / API placement data.
- Admin wraps the tree in `HomepageLayoutEditorShell` that injects selection + DnD without forking markup.

### 2. Modular blocks (loose coupling)

Each block is self-contained:

- **Props:** `block` config + resolved `videos` / `categorySection` (same as today’s render model).
- **Layout hints (new):** optional `layoutHints: { stackAfter?: string, stackBefore?: string, column?: 'main' | 'rail' }` stored in layout JSON — used only for responsive **fold order**, not business logic between blocks.
- Blocks do **not** call each other; the parent grid reads hints to assign CSS `order` on small screens.

```text
┌─────────────────────────────────────┐
│  HomepageLayoutEditorShell          │
│  ┌───────────────────────────────┐  │
│  │ BlockHost (v-for renderBlocks)│  │
│  │   ├─ FeaturedRow (+ editor)   │  │
│  │   ├─ CategoryPair (+ editor)  │  │
│  │   └─ SplitVertical (+ editor) │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

### 3. Editing interactions

| Action | Behaviour |
|--------|-----------|
| Select block | Outline + side panel (or popover) for title, body, category, variant |
| Drag reorder | Update `layoutBlocks` array; debounced save to `PUT /api/admin/homepage-layout` |
| Add block | Palette: featured row, category, top video, split H/V |
| Delete | Confirm; remove from array |
| Split blocks | Edit `childBlocks` in panel; drag children inside split only |
| Mobile preview | Toggle viewport width; show computed neighbor order from hints |

Use a maintained DnD library already compatible with Vue 3 (e.g. `@vueuse/integrations` + Sortable, or `vue-draggable-plus`) — avoid custom pointer math unless necessary.

### 4. Data model (evolution, not revolution)

Keep existing `HomepageLayoutBlock` / `childBlocks` schema in `useHomepageLayout.ts`. Add optional fields in a **new migration** only if needed:

- `layoutHints` (JSON) per block — neighbor ids for mobile order.
- `adminNotes` (string, editor-only, not shown on public site).

Do not change public API shape until frontend + admin both read the new fields.

### 5. API

- `GET /api/admin/homepage-layout` — unchanged; returns blocks + categories + placement preview payload.
- `PUT /api/admin/homepage-layout` — validate block ids, types, category references; return updated render preview (optional) to avoid double fetch.

### 6. Implementation phases

**Phase A — Render parity**

1. Extract homepage block components from `pages/index.vue` into `components/homepage/*`.
2. Add `HomepageLayoutPreview.vue` used by admin tab with mock or live placement API.
3. Remove duplicate preview markup from `admin/index.vue` layout tab.

**Phase B — Selection + panel**

1. Click-to-select; edit fields bound to `layoutBlocks` refs.
2. Save bar with dirty state.

**Phase C — Drag-and-drop**

1. Reorder root blocks and split children.
2. Undo stack (optional, in-memory).

**Phase D — Mobile fold hints**

1. Neighbor picker in panel (above/below/side).
2. Apply CSS `order` in a shared grid wrapper on `sm` breakpoint.

**Phase E — Polish**

1. Keyboard accessibility for reorder.
2. “Open homepage in new tab” preview.
3. CodeRabbit / editor QA on staging.

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Large `admin/index.vue` refactor | Phase A only touches extracted components; admin tab imports preview |
| Performance (many videos) | Admin preview uses placement API with limits; lazy-load thumbnails |
| Drift between admin and public | Single component import path; CI smoke: render N blocks in vitest/nuxt test |
| Accidental publish | Explicit Save; no autosave to prod without button |

## Out of scope (for this redesign)

- Per-block A/B tests or scheduling
- Non-video widgets (banners, HTML embeds) unless added as new block types later
- Changing category sort rules (still from category admin)

## Success criteria

- Editor sees the homepage **exactly** as members do, plus editing affordances.
- Reordering does not require understanding JSON or block type names.
- Mobile order is predictable via neighbor hints without blocks importing each other.
- No regression to `GET /api/homepage` or public LCP on `/`.

## Estimated touch points (for scheduling)

- `packages/web/pages/index.vue`
- `packages/web/pages/admin/index.vue` (layout tab only)
- `packages/web/composables/useHomepageLayout.ts`
- `packages/api` admin homepage-layout handlers (if hints added)
- New: `packages/web/components/homepage/*`, `HomepageLayoutEditorShell.vue`

---

*When implementation starts, use a dedicated branch/PR per phase (A → B → C) to keep review size manageable.*
