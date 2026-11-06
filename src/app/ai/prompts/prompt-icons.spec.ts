import { lucideIconName, PROMPT_ICONS, promptIconName, promptIconText } from './prompt-icons';

describe('lucideIconName', () => {
  it('maps Iconify Lucide names to ng-icons names', () => {
    expect(lucideIconName('i-lucide-mail')).toBe('lucideMail');
    expect(lucideIconName('i-lucide-file-text')).toBe('lucideFileText');
    expect(lucideIconName('i-lucide-heading-1')).toBe('lucideHeading1');
  });

  it('ignores other icon sets, emoji and malformed names', () => {
    expect(lucideIconName('i-heroicons-envelope')).toBeUndefined();
    expect(lucideIconName('📧')).toBeUndefined();
    expect(lucideIconName('i-lucide-')).toBeUndefined();
    expect(lucideIconName('i-lucide-Mail')).toBeUndefined();
    expect(lucideIconName('')).toBeUndefined();
    expect(lucideIconName(undefined)).toBeUndefined();
  });
});

describe('promptIconName', () => {
  it('returns registered icons only', () => {
    expect(promptIconName('i-lucide-mail')).toBe('lucideMail');
    expect(promptIconName('i-lucide-wand-sparkles')).toBe('lucideWandSparkles');
    expect(promptIconName('i-lucide-anchor')).toBeUndefined();
  });

  it('does not treat inherited object keys as icons', () => {
    expect(promptIconName('i-lucide-constructor')).toBeUndefined();
  });

  it('registers the icon the form uses as example', () => {
    expect(PROMPT_ICONS['lucideMail']).toContain('<svg');
  });
});

describe('promptIconText', () => {
  it('shows emoji and other text as is', () => {
    expect(promptIconText('📧')).toBe('📧');
    expect(promptIconText('★')).toBe('★');
  });

  it('shows no text for icon names or an empty value', () => {
    expect(promptIconText('i-lucide-mail')).toBeUndefined();
    expect(promptIconText('i-heroicons-envelope')).toBeUndefined();
    expect(promptIconText('')).toBeUndefined();
    expect(promptIconText(undefined)).toBeUndefined();
  });
});
