import { DomainError } from '../../../errors/domain.error.js';

export class PluginPermissionDeniedError extends DomainError {
  constructor(pluginId: string, permission: string) {
    super('PLUGIN_PERMISSION_DENIED', `Plugin ${pluginId} lacks permission: ${permission}`, 403, {
      pluginId,
      permission,
    });
    this.name = 'PluginPermissionDeniedError';
  }
}
