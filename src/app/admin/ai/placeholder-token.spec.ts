import { placeholderToken } from './placeholder-token';

describe('placeholderToken', () => {
  it('wraps the name in double curly braces', () => {
    expect(placeholderToken('roles')).toBe('{{roles}}');
    expect(placeholderToken('name')).toBe('{{name}}');
  });
});
