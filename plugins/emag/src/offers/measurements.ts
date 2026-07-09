import type { EmagClient } from '../client.js';
import type { EmagMeasurementsPayload } from './types.js';

/**
 * Salvează măsurătorile de volum (lungime/lățime/înălțime/greutate) pe un
 * produs existent via `measurements/save`. Doc 2.7.
 *
 * Unități obligatorii:
 *   - dimensiuni: milimetri (mm)
 *   - greutate: grame (g)
 *
 * Important pentru calculul tarifelor de curierat — eMAG folosește dim. ca
 * fallback când AWB-ul nu specifică pachetul.
 */
export const saveMeasurements = async (
  client: EmagClient,
  payload: EmagMeasurementsPayload,
): Promise<unknown> => {
  return client.save('measurements', [payload]);
};

/** Bulk variant. */
export const saveMeasurementsBulk = async (
  client: EmagClient,
  payloads: EmagMeasurementsPayload[],
): Promise<unknown> => {
  return client.save('measurements', payloads);
};
