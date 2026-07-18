/**
 * The catalogue of comic art styles the user can choose from. The chosen style
 * is captured per-comic (`ComicBook.styleId`) and every image prompt adapts to
 * it — a Western-ink book and a manga book produce very different prompts.
 *
 * Each style carries its OWN negative list, because what one style wants another
 * forbids (Western ink WANTS bold black outlines; Ghibli avoids them).
 */
export interface ArtStyle {
  id: string;
  /** Short name for the picker. */
  label: string;
  /** One-line description for the settings UI. */
  description: string;
  /** The look-and-feel sentence injected into every prompt. */
  artStyle: string;
  /** Colour / rendering guidance. */
  palette: string;
  /** What to keep OUT of the image (style-specific). */
  negative: string;
}

const SHARED_NEGATIVE = 'text watermark, signature, logo, page numbers, hard rectangular border frames, letterboxing / empty bars';

export const ART_STYLES: ArtStyle[] = [
  {
    id: 'western-ink',
    label: 'Western comic ink',
    description: 'Bold black ink outlines, flat cel colours, dramatic shadows, halftone dots — classic Marvel/DC feel.',
    artStyle:
      'classic Western comic-book art (in the spirit of Marvel / DC superhero comics): bold confident black ink ' +
      'outlines, clean inked linework, flat cel-shaded colour fills, hard-edged dramatic cast shadows, halftone / ' +
      'Ben-Day dot shading, dynamic high-contrast graphic composition.',
    palette: 'a punchy, saturated, primary-leaning colour palette with strong lights and darks',
    negative: `photorealism, 3D render, soft watercolor, painterly blur, muddy gradients, ${SHARED_NEGATIVE}`,
  },
  {
    id: 'ligne-claire',
    label: 'Ligne claire (European BD)',
    description: 'Clean even outlines, flat bright colour, minimal shading — Tintin / bande dessinée. Very readable.',
    artStyle:
      'European ligne claire comic art (in the spirit of Hergé\'s Tintin and classic bande dessinée): clean ' +
      'even-weight black outlines, flat bright uniform colour with little or no gradient, minimal rendered shadow, ' +
      'clear uncluttered composition, calm and highly readable.',
    palette: 'flat, bright, evenly-lit local colours with clear hues and no heavy shading',
    negative: `photorealism, 3D render, painterly texture, watercolor bleed, heavy rendering, gradients, harsh shadows, grain, ${SHARED_NEGATIVE}`,
  },
  {
    id: 'manga',
    label: 'Manga (B&W + screentone)',
    description: 'Expressive linework, screentone shading, speed lines, strong blacks — mostly black & white.',
    artStyle:
      'black-and-white manga art (in the spirit of Japanese shōnen / seinen manga): expressive variable-weight ink ' +
      'linework, screentone dot shading, strong solid blacks and clean whites, dynamic camera angles, speed lines and ' +
      'motion effects, emotive expressions.',
    palette: 'monochrome black and white with grey screentone shading (no colour)',
    negative: `colour, photorealism, 3D render, painterly rendering, watercolor, ${SHARED_NEGATIVE}`,
  },
  {
    id: 'graphic-novel',
    label: 'Modern graphic novel',
    description: 'Inked but textured, muted moody colour, cinematic lighting — indie / Image Comics (Saga) feel.',
    artStyle:
      'modern graphic-novel art (in the spirit of indie / Image Comics such as Saga): inked linework with visible ' +
      'brush texture, flat-ish but atmospheric colour, moody cinematic lighting, subtle grain, expressive and ' +
      'character-driven.',
    palette: 'a limited, muted, moody colour palette with cinematic lighting',
    negative: `photorealism, 3D render, glossy CGI, oversaturated neon, ${SHARED_NEGATIVE}`,
  },
  {
    id: 'ghibli',
    label: 'Ghibli painterly',
    description: 'Soft watercolor-painted animation art, warm light, whimsical mood. Not a hard comic look.',
    artStyle:
      'Studio Ghibli–inspired hand-painted animation art (in the spirit of Hayao Miyazaki / Studio Ghibli): soft ' +
      'watercolor-painted backgrounds, gentle clean linework, warm natural light, lush painterly detail, expressive ' +
      'cel-shaded characters, nostalgic and whimsical mood, cinematic storybook composition.',
    palette: 'a warm, muted, earthy colour palette with soft golden highlights and gentle atmospheric depth',
    negative: `photorealism, 3D render, harsh or inked black outlines, neon colours, ${SHARED_NEGATIVE}`,
  },
];

/** The style new comics start with (a clear "comic book" look). */
export const DEFAULT_STYLE_ID = 'western-ink';

/** Resolve a style id to its definition, falling back to the default. */
export function artStyleById(id: string | undefined): ArtStyle {
  return ART_STYLES.find((s) => s.id === id) ?? ART_STYLES.find((s) => s.id === DEFAULT_STYLE_ID)!;
}
