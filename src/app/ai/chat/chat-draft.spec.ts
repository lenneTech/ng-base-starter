import { appendPromptToDraft } from './chat-draft';

describe('appendPromptToDraft', () => {
  it('fills an empty draft with the prompt', () => {
    expect(appendPromptToDraft('', 'Fasse zusammen')).toBe('Fasse zusammen');
  });

  it('appends on a new line, keeping what the user typed', () => {
    expect(appendPromptToDraft('Hallo', 'Fasse zusammen')).toBe('Hallo\nFasse zusammen');
  });

  it('adds no separator after trailing whitespace', () => {
    expect(appendPromptToDraft('Hallo ', 'Fasse zusammen')).toBe('Hallo Fasse zusammen');
    expect(appendPromptToDraft('Hallo\n', 'Fasse zusammen')).toBe('Hallo\nFasse zusammen');
  });

  it('keeps placeholders untouched (the backend resolves them at run time)', () => {
    expect(appendPromptToDraft('', 'Hallo {{userName}}')).toBe('Hallo {{userName}}');
  });
});
