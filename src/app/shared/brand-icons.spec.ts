import { BRAND_ICONS } from './brand-icons';

describe('BRAND_ICONS', () => {
  it('carry no <title>, so the page keeps exactly one title', () => {
    for (const [name, svg] of Object.entries(BRAND_ICONS)) {
      expect(svg, name).toContain('<svg');
      expect(svg, name).not.toContain('<title>');
    }
  });
});
