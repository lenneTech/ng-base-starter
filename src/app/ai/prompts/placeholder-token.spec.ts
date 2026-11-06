import { placeholderToken } from './placeholder-token';

describe('placeholderToken', () => {
  it('wraps the name in double curly braces', () => {
    expect(placeholderToken('userId')).toBe('{{userId}}');
    expect(placeholderToken('roles')).toBe('{{roles}}');
  });
});
