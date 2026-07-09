import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { type Database, DB_TOKEN, schema } from '@opensales/db';
import { invokeAction, type Plugin } from '@opensales/plugin-sdk';
import { eq } from 'drizzle-orm';
import { Logger } from 'nestjs-pino';

import { JobQueueService } from '../../jobs/job-queue.service.js';
import { AwbService } from '../awb/awb.service.js';
import { LoadedPluginsRegistry } from '../plugins/loader/loaded-plugins.registry.js';
import { PluginRegistryService } from '../plugins/registry/plugin-registry.service.js';
import { WorkspaceService } from '../workspace/workspace.service.js';

const EMAG_PACKAGE = '@opensales-plugin/emag';

/**
 * Platformele eMAG (cheia de rutare a clientului HTTP) + moneda implicită per
 * platformă. Definite LOCAL în API — NU importăm din sursa plugin-ului
 * (`plugins/emag/src/...`), pentru că acel path relativ nu se rezolvă în
 * build-ul de producție (a cauzat „Cannot find module .../config.js" la boot).
 */
type EmagPlatform = 'emag-ro' | 'emag-hu' | 'emag-bg' | 'fd-ro' | 'fd-bg';
const PLATFORM_CURRENCY: Record<EmagPlatform, string> = {
  'emag-ro': 'RON',
  'emag-hu': 'HUF',
  'emag-bg': 'BGN',
  'fd-ro': 'RON',
  'fd-bg': 'BGN',
};
const ADDRESS_REFRESH_JOB = 'emag.refresh-sender-addresses';
const ADDRESS_REFRESH_CRON = '0 3 * * *'; // 3am UTC daily
const ADDRESS_CACHE_TTL_MS = 23 * 60 * 60 * 1000; // 23h — refresh before the 24h mark

/**
 * Convertește `order.marketplace` la `EmagPlatformKey` pentru a selecta
 * clientul API corect (URL de bază diferit pe fiecare țară).
 * FBE folosește același API ca marketplace-ul regular din aceeași țară.
 * Returnează `null` pentru marketplace-uri necunoscute (non-eMAG).
 */
export function marketplaceToPlatform(marketplace: string | null | undefined): EmagPlatform | null {
  if (!marketplace) return null;
  if (marketplace === 'emag-ro' || marketplace === 'fbe-ro') return 'emag-ro';
  if (marketplace === 'emag-hu' || marketplace === 'fbe-hu') return 'emag-hu';
  if (marketplace === 'emag-bg' || marketplace === 'fbe-bg') return 'emag-bg';
  if (marketplace === 'fd-ro') return 'fd-ro';
  if (marketplace === 'fd-bg') return 'fd-bg';
  return null;
}

interface Address {
  address_id: string;
  locality_id?: number;
  address_type_id?: number;
  is_default?: boolean;
  [key: string]: unknown;
}

interface SenderAddressCache {
  locality_id: number;
  address_id: string;
  /** ISO timestamp of last successful fetch */
  fetchedAt: string;
}

interface AwbSaveResult {
  emag_id?: number;
  awb?: { emag_id: number; awb_barcode?: string; awb_number?: string; barcode?: string }[];
  cost?: number;
  currency?: string;
}

export interface IssueEmagAwbInput {
  /** Număr colete. Default: 1. */
  parcel_number?: number | undefined;
  /** Valoare asigurată (RON). Default: 0. */
  insured_value?: number | undefined;
  /** Greutate totală (kg). Default: 1 × parcel_number. */
  weight?: number | undefined;
  /** Dimensiuni colete. Default: auto-generate (10×20×30 cm, weight distribuit egal). */
  packages?: { weight: number; length: number; width: number; height: number }[] | undefined;
  /**
   * 0 = curierul vine să ridice coletul de la tine (implicit).
   * 1 = tu, ca expeditor, duci coletul la un easybox/locker.
   * Default: 0.
   */
  dropoff_locker?: 0 | 1 | undefined;
}

export interface AwbPayload {
  order_id: number;
  sender: {
    name: string;
    contact: string;
    phone1: string;
    locality_id: number;
    street: string;
    address_id: string;
  };
  receiver: {
    name: string;
    contact: string;
    phone1: string;
    locality_id: unknown;
    street: string;
  };
  cod: number;
  parcel_number: number;
  weight: number;
  packages: { weight: number; length: number; width: number; height: number }[];
  insured_value?: number;
  observation: string;
  unboxing: 1;
  is_oversize: 0;
  dropoff_locker: 0 | 1;
  /** ID-ul locker-ului destinatarului — trimis doar când delivery_mode=pickup. */
  locker_id?: string;
  /**
   * Moneda AWB-ului — obligatoriu pentru eMAG BG; recomandat pentru toate platformele.
   * Derivat din platforma comenzii (emag-ro → RON, emag-bg → BGN, emag-hu → HUF).
   */
  currency: string;
  /**
   * Platforma eMAG folosită pentru rutarea clientului HTTP.
   * Citit de handler-ul `issueAwb` din plugin; nu este trimis la eMAG.
   */
  platform?: EmagPlatform;
}

@Injectable()
export class EmagAwbIssueService implements OnApplicationBootstrap {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Database,
    private readonly loaded: LoadedPluginsRegistry,
    private readonly awbService: AwbService,
    private readonly logger: Logger,
    private readonly pluginRegistry: PluginRegistryService,
    private readonly queue: JobQueueService,
    private readonly workspaceService: WorkspaceService,
  ) {}

  /**
   * Înregistrează un job pg-boss care rulează zilnic la 3:00 UTC pentru a
   * pre-popula cache-ul adresei expeditorului pentru toate plugin-urile eMAG active.
   */
  async onApplicationBootstrap(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;

    // register() apelează createQueue intern — queue-ul trebuie să existe
    // înainte de schedule(), altfel pg-boss aruncă FK violation.
    await this.queue.register<Record<string, never>>(ADDRESS_REFRESH_JOB, async () => {
      const rows = await this.db.query.plugins.findMany({
        where: eq(schema.plugins.packageName, EMAG_PACKAGE),
      });
      for (const row of rows) {
        const loadedPlugin = this.loaded.getById(row.id);
        if (!loadedPlugin) continue;
        try {
          await this.fetchAndCacheSenderAddress(row.id, loadedPlugin.instance, row.config);
        } catch (err) {
          this.logger.warn(
            { pluginId: row.id, err },
            'Failed to refresh eMAG sender address cache',
          );
        }
      }
    });
    await this.queue.raw().schedule(ADDRESS_REFRESH_JOB, ADDRESS_REFRESH_CRON, {}, { tz: 'UTC' });
  }

  /**
   * Returnează payload-ul complet care ar fi trimis la eMAG awb/save,
   * fără a apela efectiv API-ul. Util pentru previzualizare în UI.
   */
  async previewPayload(orderId: string, input: IssueEmagAwbInput): Promise<AwbPayload> {
    const { payload } = await this.buildAwbPayload(orderId, input);
    return payload;
  }

  async issueOutgoing(orderId: string, input: IssueEmagAwbInput): Promise<schema.OrderAwb> {
    const { payload, order } = await this.buildAwbPayload(orderId, input);

    const loadedPlugin = this.loaded.getById(order.pluginId);
    if (!loadedPlugin) {
      throw new NotFoundException('Plugin-ul eMAG pentru această comandă nu este activ');
    }

    const result = (await invokeAction(
      loadedPlugin.instance,
      'issueAwb',
      payload,
    )) as AwbSaveResult;

    const awbEntry = result.awb?.[0];
    const emagId = result.emag_id ?? awbEntry?.emag_id;
    const awbBarcode = awbEntry?.awb_barcode ?? awbEntry?.barcode ?? awbEntry?.awb_number ?? '';

    this.logger.log({ orderId, emagId, awbBarcode }, 'AWB emis via eMAG API');

    return this.awbService.set(orderId, 'outgoing', {
      number: awbBarcode,
      carrierPluginId: order.pluginId,
      status: 'issued',
      issuedAt: new Date(),
      emagId,
    });
  }

  /**
   * Construiește payload-ul complet pentru awb/save fără a apela eMAG.
   * Folosit de previewPayload() și issueOutgoing().
   */
  private async buildAwbPayload(
    orderId: string,
    input: IssueEmagAwbInput,
  ): Promise<{ payload: AwbPayload; order: schema.Order & { pluginId: string } }> {
    const order = await this.db.query.orders.findFirst({
      where: eq(schema.orders.id, orderId),
    });
    if (!order) throw new NotFoundException(`Comanda ${orderId} nu a fost găsită`);
    if (!order.pluginId) throw new NotFoundException('Comenzile manuale nu suportă AWB eMAG');

    const loadedPlugin = this.loaded.getById(order.pluginId);
    if (!loadedPlugin) {
      throw new NotFoundException('Plugin-ul eMAG pentru această comandă nu este activ');
    }

    // Obține adresa expeditorului din cache (sau fetch dacă lipsește/expirat)
    // și datele de profil ale workspace-ului (Nume Companie, Contact, Telefon AWB, Stradă).
    const [senderAddress, ws] = await Promise.all([
      this.getOrRefreshSenderAddress(order.pluginId, loadedPlugin.instance),
      this.workspaceService.get(),
    ]);

    const shipping = order.shippingAddress;
    if (!shipping.locality_id) {
      throw new NotFoundException(
        'Comanda nu are locality_id salvat. Resincronizează comanda înainte de a emite AWB.',
      );
    }

    const emagOrderId = parseInt(order.externalId, 10);
    if (isNaN(emagOrderId)) throw new NotFoundException('ID extern invalid');

    // COD: ramburs doar dacă payment_mode_id = 1.
    // totalAmountMinor este deja NET (produse + transport - vouchere).
    const rawPayload = order.rawPayload as Record<string, unknown> | null;
    const paymentModeId =
      typeof rawPayload?.payment_mode_id === 'number' ? rawPayload.payment_mode_id : 3;
    const isCod = paymentModeId === 1;
    const cod = isCod ? Math.max(0, Number(order.totalAmountMinor) / 100) : 0;

    // locker_id: ID-ul locker-ului destinatarului — mandatory când delivery_mode=pickup.
    const isPickup = (rawPayload?.delivery_mode as string | undefined) === 'pickup';
    const rawDetails =
      rawPayload?.details && typeof rawPayload.details === 'object'
        ? (rawPayload.details as Record<string, unknown>)
        : null;
    const lockerId =
      isPickup && typeof rawDetails?.locker_id === 'string' ? rawDetails.locker_id : null;

    // dropoff_locker: 0 = curierul ridică de la expeditor (implicit).
    //                 1 = expeditorul duce coletul la un easybox (doar la cerere explicită).
    const dropoffLocker = input.dropoff_locker ?? 0;

    // Număr colete și greutate cu valori implicite.
    const parcelNumber = input.parcel_number ?? 1;
    const totalWeight = input.weight ?? parcelNumber; // 1 kg/colet implicit
    const weightPerParcel = totalWeight / parcelNumber;

    // Pachete: auto-generate dacă nu sunt trimise explicit.
    const packages: { weight: number; length: number; width: number; height: number }[] =
      input.packages ??
      Array.from({ length: parcelNumber }, () => ({
        weight: weightPerParcel,
        length: 10,
        width: 20,
        height: 30,
      }));

    // Rezolvă platforma eMAG din marketplace-ul comenzii pentru rutarea corectă
    // a clientului HTTP și pentru câmpul `currency` cerut de eMAG v4.5.
    const platform = marketplaceToPlatform(order.marketplace) ?? 'emag-ro';
    const currency = PLATFORM_CURRENCY[platform];

    const payload: AwbPayload = {
      order_id: emagOrderId,
      sender: {
        name: (() => {
          if (!ws.companyName?.length)
            throw new BadRequestException(
              'Câmpul "Nume Companie" din Profil este obligatoriu pentru emiterea AWB.',
            );
          return ws.companyName;
        })(),
        contact: (() => {
          const v = ws.contactPerson?.length ? ws.contactPerson : ws.companyName;
          if (!v?.length)
            throw new BadRequestException(
              'Câmpul "Persoana de Contact" (sau "Nume Companie") din Profil este obligatoriu pentru emiterea AWB.',
            );
          return v;
        })(),
        phone1: (() => {
          const v = ws.awbPhone?.length ? ws.awbPhone : ws.phone;
          if (!v?.length)
            throw new BadRequestException(
              'Câmpul "Telefon AWB" (sau "Număr de telefon") din Profil este obligatoriu pentru emiterea AWB.',
            );
          return v.slice(0, 11);
        })(),
        locality_id: senderAddress.locality_id,
        street: (() => {
          if (!ws.street?.length)
            throw new BadRequestException(
              'Câmpul "Stradă" din Profil este obligatoriu pentru emiterea AWB.',
            );
          return ws.street;
        })(),
        address_id: senderAddress.address_id,
      },
      receiver: {
        name: shipping.name ?? order.customerName ?? 'Client',
        contact: shipping.name ?? order.customerName ?? 'Client',
        phone1: (shipping.phone ?? order.customerPhone ?? '00000000').slice(0, 11),
        locality_id: shipping.locality_id,
        street: shipping.street ?? '-',
      },
      cod,
      parcel_number: parcelNumber,
      weight: totalWeight,
      packages,
      ...(input.insured_value !== undefined ? { insured_value: input.insured_value } : {}),
      observation: '',
      unboxing: 1,
      is_oversize: 0,
      dropoff_locker: dropoffLocker,
      ...(lockerId !== null ? { locker_id: lockerId } : {}),
      currency,
      platform,
    };

    return { payload, order: order as schema.Order & { pluginId: string } };
  }

  /**
   * Returnează adresa expeditorului din cache dacă e validă (<23h),
   * altfel face fetch din eMAG și actualizează cache-ul.
   */
  private async getOrRefreshSenderAddress(
    pluginId: string,
    pluginInstance: Plugin,
  ): Promise<SenderAddressCache> {
    const pluginRow = await this.pluginRegistry.findById(pluginId);
    if (!pluginRow) throw new NotFoundException('Plugin not found');

    const config = pluginRow.config as Record<string, unknown>;
    const cache = config.senderAddressCache as SenderAddressCache | undefined;
    const isStale =
      !cache || Date.now() - new Date(cache.fetchedAt).getTime() > ADDRESS_CACHE_TTL_MS;

    if (!isStale) return cache;

    return this.fetchAndCacheSenderAddress(pluginId, pluginInstance, config);
  }

  /**
   * Apelează addresses/read pe eMAG, extrage adresa de pickup default
   * (address_type_id=2, is_default=true) și o salvează în plugin.config.
   */
  private async fetchAndCacheSenderAddress(
    pluginId: string,
    pluginInstance: Plugin,
    currentConfig: Record<string, unknown>,
  ): Promise<SenderAddressCache> {
    const addresses = (await invokeAction(pluginInstance, 'readAddresses', {})) as Address[];

    const defaultPickup = addresses.find((a) => a.address_type_id === 2 && a.is_default === true);
    if (!defaultPickup) {
      throw new NotFoundException(
        'Nu există adresă de pickup default în contul eMAG ' +
          '(address_type_id=2, is_default=true). Adaugă una din panoul Marketplace.',
      );
    }

    const localityId =
      typeof defaultPickup.locality_id === 'number'
        ? defaultPickup.locality_id
        : Number(defaultPickup.locality_id);
    if (Number.isNaN(localityId)) {
      throw new NotFoundException('locality_id invalid în adresa de pickup eMAG');
    }

    const cache: SenderAddressCache = {
      locality_id: localityId,
      address_id: String(defaultPickup.address_id),
      fetchedAt: new Date().toISOString(),
    };

    await this.pluginRegistry.updateConfig(pluginId, {
      ...currentConfig,
      senderAddressCache: cache,
    });
    this.logger.log(
      { pluginId, locality_id: localityId, address_id: cache.address_id },
      'Adresă expeditor cache-uită din eMAG',
    );
    return cache;
  }
}
