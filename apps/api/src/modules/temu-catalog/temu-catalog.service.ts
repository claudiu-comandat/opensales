import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { invokeAction, type Plugin } from '@opensales/plugin-sdk';

import { TEMU_PACKAGE } from '../marketplaces/marketplace-catalog.js';
import { LoadedPluginsRegistry } from '../plugins/loader/loaded-plugins.registry.js';
import { PluginRegistryService } from '../plugins/registry/plugin-registry.service.js';

/**
 * Expune listele de referință Temu („alege dintr-o listă") către automatizările n8n:
 * branduri/trademark, contacte GPSR, atribute per categorie și șabloane extra.
 *
 * Citește prin acțiunile read-only ale plugin-ului Temu (instanța încărcată în proces),
 * exact ca workerul de push. n8n paginează aceste endpoint-uri, stochează rezultatul în
 * tabelele lui `catalogs.*` și face matching-ul (vezi docs/temu-listing-complete/).
 */
@Injectable()
export class TemuCatalogService {
  constructor(
    private readonly registry: PluginRegistryService,
    private readonly loaded: LoadedPluginsRegistry,
  ) {}

  /** Rezolvă instanța plugin-ului Temu încărcată în proces sau aruncă o eroare clară. */
  private async instance(): Promise<Plugin> {
    const plugin = await this.registry.findByPackageName(TEMU_PACKAGE);
    if (!plugin) throw new NotFoundException('Plugin Temu neînregistrat');
    if (plugin.status !== 'active') {
      throw new ServiceUnavailableException(`Plugin Temu inactiv (status=${plugin.status})`);
    }
    const loaded = this.loaded.getById(plugin.id);
    if (!loaded) throw new ServiceUnavailableException('Instanța plugin-ului Temu nu e încărcată');
    return loaded.instance;
  }

  async brandTrademarks(page: number, size: number): Promise<Record<string, unknown>> {
    return (await invokeAction(await this.instance(), 'getBrandTrademarks', {
      page,
      size,
    })) as Record<string, unknown>;
  }

  async complianceContacts(
    complianceInfoType: 2 | 3,
    page: number,
    size: number,
    searchText?: string,
  ): Promise<Record<string, unknown>> {
    return (await invokeAction(await this.instance(), 'getComplianceContacts', {
      complianceInfoType,
      page,
      size,
      ...(searchText !== undefined ? { searchText } : {}),
    })) as Record<string, unknown>;
  }

  async categoryAttributes(catId: number): Promise<Record<string, unknown>> {
    return (await invokeAction(await this.instance(), 'getProductAttributes', {
      catId,
    })) as Record<string, unknown>;
  }

  async extraTemplate(catId: number, goodsId?: number): Promise<Record<string, unknown>> {
    return (await invokeAction(await this.instance(), 'getComplianceExtraTemplate', {
      catId,
      ...(goodsId !== undefined ? { goodsId } : {}),
    })) as Record<string, unknown>;
  }
}
