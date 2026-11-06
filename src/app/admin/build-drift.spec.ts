import { buildsMatch, shortCommit } from './build-drift';

describe('buildsMatch', () => {
  it('compares commits, and never warns for an unknown one', () => {
    expect(buildsMatch('abc1234', 'abc1234')).toBe(true);
    expect(buildsMatch('abc1234', 'def5678')).toBe(false);
    expect(buildsMatch('unknown', 'def5678')).toBe(true);
    expect(buildsMatch('abc1234', undefined)).toBe(true);
  });
});

describe('shortCommit', () => {
  it('shortens to seven characters and names the unknown commit', () => {
    expect(shortCommit('0123456789abcdef')).toBe('0123456');
    expect(shortCommit('unknown')).toBe('unbekannt');
    expect(shortCommit('')).toBe('unbekannt');
  });
});
