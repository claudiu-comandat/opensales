import { vi } from 'vitest';

export const cookies = vi.fn().mockResolvedValue({
  getAll: vi.fn().mockReturnValue([]),
  get: vi.fn().mockReturnValue(undefined),
  has: vi.fn().mockReturnValue(false),
});

export const headers = vi.fn().mockResolvedValue(new Headers());
