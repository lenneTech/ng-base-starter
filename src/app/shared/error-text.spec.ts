import { errorText } from './error-text';

const translate = (message: string): string => `übersetzt: ${message}`;

describe('errorText', () => {
  it('translates a nest-server message with an error code', () => {
    expect(errorText('#LTNS_0002: Invalid password', translate, 'Fallback')).toBe('übersetzt: #LTNS_0002: Invalid password');
  });

  it("translates a project's own error code too, not only #LTNS_", () => {
    expect(errorText('#PROJ_0001: Kontingent erschöpft', translate, 'Fallback')).toBe('übersetzt: #PROJ_0001: Kontingent erschöpft');
  });

  it("shows the page's German text for Better Auth's answers without a code", () => {
    expect(errorText('Invalid code', translate, 'Code ungültig')).toBe('Code ungültig');
  });

  it('does not take a code that is not at the start of the message', () => {
    expect(errorText('Fehler #LTNS_0002: Invalid password', translate, 'Fallback')).toBe('Fallback');
  });

  it('shows the fallback for no message at all', () => {
    expect(errorText(undefined, translate, 'Fallback')).toBe('Fallback');
    expect(errorText({ message: '#LTNS_0002: x' }, translate, 'Fallback')).toBe('Fallback');
  });
});
