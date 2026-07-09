import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

import '@testing-library/jest-dom/vitest';

process.env.API_URL = 'http://localhost:3001';

afterEach(() => {
  cleanup();
});
