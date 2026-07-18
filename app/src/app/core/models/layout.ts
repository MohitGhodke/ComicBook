import { LayoutId, Page, Panel } from './comic.model';
import { newId } from '../util/id';

export interface LayoutDef {
  id: LayoutId;
  label: string;
  panelCount: number;
}

/** The available page layouts — the "page configurator" options. */
export const LAYOUTS: LayoutDef[] = [
  { id: 'splash', label: 'Splash', panelCount: 1 },
  { id: 'strip3', label: 'Strip', panelCount: 3 },
  { id: 'grid4', label: 'Grid', panelCount: 4 },
  { id: 'feature3', label: 'Feature', panelCount: 3 },
  { id: 'six', label: 'Six', panelCount: 6 },
];

export function layoutDef(id: LayoutId | undefined): LayoutDef {
  return LAYOUTS.find((l) => l.id === id) ?? LAYOUTS[0];
}

export function panelCountFor(id: LayoutId | undefined): number {
  return layoutDef(id).panelCount;
}

export function newPanel(init: Partial<Panel> = {}): Panel {
  return { id: newId('panel'), ...init };
}

/**
 * Normalize a page to the panel model. Legacy pages (with top-level
 * caption/dialogue/imageRef and no `panels`) become a one-panel splash so old
 * comics keep working and become editable in the new UI.
 */
export function migratePage(page: Page): Page {
  if (page.panels && page.layout) return page;
  return {
    id: page.id,
    layout: page.layout ?? 'splash',
    panels: page.panels ?? [
      newPanel({
        description: page.caption,
        dialogue: page.dialogue,
        imageRef: page.imageRef,
        imagePrompt: page.imagePrompt,
      }),
    ],
  };
}

/**
 * Resize a page's panel list to match a new layout: keep existing panels, add
 * empty ones if the layout needs more, trim extras off the end if fewer.
 */
export function applyLayout(page: Page, layout: LayoutId): void {
  const target = panelCountFor(layout);
  page.layout = layout;
  const panels = page.panels ?? [];
  while (panels.length < target) panels.push(newPanel());
  if (panels.length > target) panels.length = target;
  page.panels = panels;
}
