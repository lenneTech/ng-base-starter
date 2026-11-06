import {
  lucideBell,
  lucideBookOpen,
  lucideBot,
  lucideBriefcase,
  lucideBug,
  lucideCalendar,
  lucideChartBar,
  lucideCheck,
  lucideClipboardList,
  lucideClock,
  lucideCode,
  lucideCopy,
  lucideFileText,
  lucideGlobe,
  lucideHeart,
  lucideInfo,
  lucideLanguages,
  lucideLightbulb,
  lucideList,
  lucideListChecks,
  lucideMail,
  lucideMessageSquare,
  lucideNotebookPen,
  lucidePencil,
  lucidePenLine,
  lucideQuote,
  lucideSearch,
  lucideSend,
  lucideSettings,
  lucideSparkles,
  lucideStar,
  lucideTag,
  lucideTerminal,
  lucideUser,
  lucideUsers,
  lucideWandSparkles,
  lucideZap,
} from '@ng-icons/lucide';

/**
 * The Lucide icons a prompt ("Vorlage") can show. The Nuxt template renders any Iconify name (`i-lucide-…`) on demand;
 * ng-icons needs every icon in the bundle, and the whole Lucide set would add almost 1 MB. So prompts get this curated
 * set; an `i-…` name outside it shows no icon (the prompt itself works as before). Extend the list as needed.
 */
export const PROMPT_ICONS: Record<string, string> = {
  lucideBell,
  lucideBookOpen,
  lucideBot,
  lucideBriefcase,
  lucideBug,
  lucideCalendar,
  lucideChartBar,
  lucideCheck,
  lucideClipboardList,
  lucideClock,
  lucideCode,
  lucideCopy,
  lucideFileText,
  lucideGlobe,
  lucideHeart,
  lucideInfo,
  lucideLanguages,
  lucideLightbulb,
  lucideList,
  lucideListChecks,
  lucideMail,
  lucideMessageSquare,
  lucideNotebookPen,
  lucidePenLine,
  lucidePencil,
  lucideQuote,
  lucideSearch,
  lucideSend,
  lucideSettings,
  lucideSparkles,
  lucideStar,
  lucideTag,
  lucideTerminal,
  lucideUser,
  lucideUsers,
  lucideWandSparkles,
  lucideZap,
};

const ICONIFY_LUCIDE = /^i-lucide-([a-z0-9]+(?:-[a-z0-9]+)*)$/;

/** The ng-icons name of an Iconify Lucide name (`i-lucide-file-text` → `lucideFileText`), or `undefined` for anything else. */
export function lucideIconName(icon: string | undefined): string | undefined {
  const match = icon ? ICONIFY_LUCIDE.exec(icon) : null;
  if (!match?.[1]) {
    return undefined;
  }
  return `lucide${match[1]
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')}`;
}

/** The registered icon of a prompt (`i-lucide-…` within {@link PROMPT_ICONS}), or `undefined`. */
export function promptIconName(icon: string | undefined): string | undefined {
  const name = lucideIconName(icon);
  return name && Object.hasOwn(PROMPT_ICONS, name) ? name : undefined;
}

/** The emoji (or other text) a prompt shows instead of an icon: any value that is not an `i-…` icon name. */
export function promptIconText(icon: string | undefined): string | undefined {
  return icon && !icon.startsWith('i-') ? icon : undefined;
}
