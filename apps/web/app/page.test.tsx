import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  redirect: vi.fn((target: string) => {
    throw new Error(`NEXT_REDIRECT:${target}`);
  }),
}));

describe('HomePage', () => {
  it('redirects to /orders', async () => {
    const HomePage = (await import('./page.js')).default;
    expect(() => HomePage()).toThrow('NEXT_REDIRECT:/orders');
  });
});
