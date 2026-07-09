import type { EmagClient } from '../client.js';
import type { AwbPackageReadFilters, AwbPackageSavePayload, AwbPackageTemplate } from './types.js';

/**
 * Citește lista pachetelor predefinite (awb/package/read, § 6.9, 4.5.1).
 */
export const readAwbPackages = (
  client: EmagClient,
  filters: AwbPackageReadFilters = {},
): Promise<AwbPackageTemplate[]> =>
  client.read<AwbPackageTemplate[]>('awb/package', { ...filters });

/**
 * Salvează / modifică pachetele predefinite (awb/package/save, § 6.9, 4.5.1).
 *
 * Important: pentru a schimba dimensiunile / pachetul implicit trebuie să
 * trimiți TOATE pachetele cu toate cheile. eMAG nu face merge per-label.
 */
export const saveAwbPackages = (
  client: EmagClient,
  payload: AwbPackageSavePayload,
): Promise<unknown> => client.save<unknown>('awb/package', payload);
