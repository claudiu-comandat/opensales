import { Global, Module } from '@nestjs/common';

import { PluginBootScanner } from './boot/plugin-boot.scanner.js';
import { PluginEventsBus } from './events/plugin-events.bus.js';
import { PermissionGatewayService } from './gateway/permission-gateway.service.js';
import { PluginFolderHelper } from './lifecycle/plugin-folder.helper.js';
import { PluginLifecycleService } from './lifecycle/plugin-lifecycle.service.js';
import { LoadedPluginsRegistry } from './loader/loaded-plugins.registry.js';
import { PluginContextFactory } from './loader/plugin-context.factory.js';
import { PluginLoaderService } from './loader/plugin-loader.service.js';
import { PluginsController } from './plugins.controller.js';
import { PluginPermissionsCache } from './registry/permissions-cache.js';
import { PluginRegistryService } from './registry/plugin-registry.service.js';
import { SdkApiFactory } from './sdk-runtime/sdk-api.factory.js';
import { SdkLoggerFactory } from './sdk-runtime/sdk-logger.factory.js';

@Global()
@Module({
  controllers: [PluginsController],
  providers: [
    PluginRegistryService,
    PluginPermissionsCache,
    PermissionGatewayService,
    LoadedPluginsRegistry,
    PluginContextFactory,
    PluginLoaderService,
    PluginLifecycleService,
    PluginFolderHelper,
    PluginEventsBus,
    SdkLoggerFactory,
    SdkApiFactory,
    PluginBootScanner,
  ],
  exports: [
    PluginRegistryService,
    PermissionGatewayService,
    LoadedPluginsRegistry,
    PluginLoaderService,
    PluginLifecycleService,
    PluginFolderHelper,
    PluginEventsBus,
    SdkLoggerFactory,
  ],
})
export class PluginsModule {}
