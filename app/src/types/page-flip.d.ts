// Minimal typings for the untyped `page-flip` (StPageFlip) UMD package —
// only the surface this app uses.
declare module 'page-flip' {
  export interface PageFlipSettings {
    width: number;
    height: number;
    showCover?: boolean;
    drawShadow?: boolean;
    flippingTime?: number;
    usePortrait?: boolean;
    autoSize?: boolean;
    maxShadowOpacity?: number;
    mobileScrollSupport?: boolean;
    [key: string]: unknown;
  }

  export class PageFlip {
    constructor(element: HTMLElement, settings: PageFlipSettings);
    loadFromHTML(items: NodeListOf<Element> | HTMLElement[]): void;
    getPageCount(): number;
    getCurrentPageIndex(): number;
    flipNext(corner?: 'top' | 'bottom'): void;
    flipPrev(corner?: 'top' | 'bottom'): void;
    turnToPage(page: number): void;
    on(event: string, callback: (e: { data: unknown }) => void): void;
    destroy(): void;
  }
}
