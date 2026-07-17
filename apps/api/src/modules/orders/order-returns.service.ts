import { Inject, Injectable } from '@nestjs/common';
import { type Database, DB_TOKEN, schema } from '@opensales/db';
import { invokeAction } from '@opensales/plugin-sdk';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { Logger } from 'nestjs-pino';
import { v7 as uuidv7 } from 'uuid';

import { DomainError } from '../../errors/domain.error.js';
import { LoadedPluginsRegistry } from '../plugins/loader/loaded-plugins.registry.js';
import { PluginRegistryService } from '../plugins/registry/plugin-registry.service.js';

import { OrdersService } from './orders.service.js';
import { canTransition } from './status-state-machine.js';

const FGO_PACKAGE = '@opensales-plugin/fgo';

/**
 * Linii sintetice de comandă (order-sync le adaugă pt. voucher/transport) — NU sunt produse
 * returnabile și NU trebuie reemise pe factura corectată (altfel un retur total al unei comenzi
 * cu discount reemite o factură cu o singură linie de voucher negativ).
 */
const SYNTHETIC_SKUS = new Set(['VOUCHER', 'TRANSPORT']);

/** Tipul parametrului `tx` primit de callback-ul `db.transaction(async (tx) => ...)`. */
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export type OrderReturnSource = 'emag_rma' | 'trendyol_claim' | 'manual';

export interface ProcessPartialReturnItem {
  orderItemId: string;
  quantity: number;
}

export interface ProcessPartialReturnOptions {
  source: OrderReturnSource;
  sourceReference?: string | undefined;
  feeAmountMinor?: number | bigint | undefined;
  feeCurrency?: string | undefined;
  comment?: string | undefined;
}

interface FgoReturnLineItem {
  sku: string;
  name: string;
  quantity: number;
  unitPriceAmountMinor: bigint;
  unitPriceCurrency: string;
  attributes: Record<string, unknown>;
}

/** Însumează cantitățile pe orderItemId — protejează plafonul când același item apare de mai multe ori într-un request. */
function aggregateByItem(items: ProcessPartialReturnItem[]): ProcessPartialReturnItem[] {
  const byItem = new Map<string, number>();
  for (const { orderItemId, quantity } of items) {
    byItem.set(orderItemId, (byItem.get(orderItemId) ?? 0) + quantity);
  }
  return Array.from(byItem, ([orderItemId, quantity]) => ({ orderItemId, quantity }));
}

export interface SerializedOrderReturn extends Omit<schema.OrderReturn, 'feeAmountMinor'> {
  feeAmountMinor: string | null;
}

/** `feeAmountMinor` e `bigint` în DB — Express/JSON.stringify nu știe să-l serializeze la granița API. */
export function serializeOrderReturn(r: schema.OrderReturn): SerializedOrderReturn {
  return { ...r, feeAmountMinor: r.feeAmountMinor === null ? null : r.feeAmountMinor.toString() };
}

@Injectable()
export class OrderReturnsService {
  /**
   * Serializează apelurile FGO (storno + reissue) per comandă. Blocajul `FOR UPDATE` din DB se
   * eliberează la commit, dar FGO rulează după commit — două retururi DISTINCTE pe aceeași comandă
   * și-ar putea întrețese storno-urile (dublă stornare a facturii active). Coada per-comandă le
   * pune în serie. ponytail: valabil pe o singură instanță API (deploy-ul curent, Railway); pe
   * mai multe instanțe ar trebui un lock la nivel de DB (pg_advisory_lock).
   */
  private readonly fgoLocks = new Map<string, Promise<unknown>>();

  constructor(
    @Inject(DB_TOKEN) private readonly db: Database,
    private readonly loaded: LoadedPluginsRegistry,
    private readonly registry: PluginRegistryService,
    private readonly orders: OrdersService,
    private readonly logger: Logger,
  ) {}

  private async withOrderFgoLock<T>(orderId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.fgoLocks.get(orderId) ?? Promise.resolve();
    const run = prev.then(fn, fn); // rulează indiferent de rezultatul predecesorului
    const tracker = run.catch(() => undefined);
    this.fgoLocks.set(orderId, tracker);
    try {
      return await run;
    } finally {
      if (this.fgoLocks.get(orderId) === tracker) this.fgoLocks.delete(orderId);
    }
  }

  /**
   * Procesează un retur parțial/total pentru o comandă: verifică plafonul (nu se poate storna
   * mai mult decât s-a vândut), restaurează stocul, stornează factura activă și — dacă mai
   * rămâne ceva de facturat sau există o taxă de retur — reemite o factură corectată prin FGO.
   *
   * Concurență/idempotență:
   *  - Comanda e blocată `SELECT ... FOR UPDATE` la începutul tranzacției → returnurile pe
   *    ACEEAȘI comandă se serializează (plafonul + restaurarea stocului nu se pot întrece).
   *  - Cheia unică (orderId, source, sourceReference) + `ON CONFLICT DO NOTHING`: DOAR requestul
   *    care câștigă insertul (isNew) rulează FGO (storno + reissue). O retrimitere (retry, dublu-tap,
   *    request concurent) găsește conflict → NU reia FGO → nu dublează factura storno / taxa de retur.
   *  - `manual` (fără sourceReference) NU e deduplicat — fiecare apel e un retur nou.
   */
  async processPartialReturn(
    orderId: string,
    itemsRaw: ProcessPartialReturnItem[],
    options: ProcessPartialReturnOptions,
  ): Promise<schema.OrderReturn> {
    const items = aggregateByItem(itemsRaw);
    if (items.length === 0 && !options.feeAmountMinor) {
      throw DomainError.validation('Un retur trebuie să conțină produse sau o taxă de retur');
    }

    const { orderReturn, isNew } = await this.db.transaction(async (tx) => {
      // Blochează comanda → serializează returnurile concurente pe aceeași comandă.
      const [order] = await tx
        .select({ id: schema.orders.id, totalCurrency: schema.orders.totalCurrency })
        .from(schema.orders)
        .where(eq(schema.orders.id, orderId))
        .for('update')
        .limit(1);
      if (!order) throw DomainError.notFound(`Comanda ${orderId} nu a fost găsită`);

      // Taxa de retur ajunge pe factura reemisă în moneda comenzii (FGO e mono-monedă/factură) —
      // o monedă diferită ar fi facturată greșit. Blocăm nepotrivirea în loc s-o ignorăm tăcut.
      if (
        options.feeCurrency &&
        options.feeCurrency.toUpperCase() !== order.totalCurrency.toUpperCase()
      ) {
        throw DomainError.validation(
          `Moneda taxei de retur (${options.feeCurrency}) diferă de moneda comenzii (${order.totalCurrency})`,
        );
      }

      const [inserted] = await tx
        .insert(schema.orderReturns)
        .values({
          id: uuidv7(),
          orderId,
          source: options.source,
          sourceReference: options.sourceReference ?? null,
          feeAmountMinor:
            options.feeAmountMinor !== undefined ? BigInt(options.feeAmountMinor) : null,
          // FGO e mono-monedă/factură — o taxă fără monedă explicită moștenește moneda comenzii
          // (validată mai sus ca identică, dacă e dată explicit).
          feeCurrency:
            options.feeAmountMinor !== undefined
              ? (options.feeCurrency ?? order.totalCurrency)
              : null,
          comment: options.comment ?? null,
        })
        .onConflictDoNothing({
          target: [
            schema.orderReturns.orderId,
            schema.orderReturns.source,
            schema.orderReturns.sourceReference,
          ],
        })
        .returning();

      if (inserted) {
        await this.recordItemsAndRestoreStock(tx, orderId, inserted.id, items);
        return { orderReturn: inserted, isNew: true };
      }

      if (!options.sourceReference) {
        // Returnurile 'manual' (sourceReference null) nu intră niciodată în conflict —
        // NULL <> NULL în indexul unic. Dacă ajungem aici oricum, ceva e neașteptat.
        throw DomainError.conflict('Retur duplicat neașteptat fără sourceReference');
      }
      const [prior] = await tx
        .select()
        .from(schema.orderReturns)
        .where(
          and(
            eq(schema.orderReturns.orderId, orderId),
            eq(schema.orderReturns.source, options.source),
            eq(schema.orderReturns.sourceReference, options.sourceReference),
          ),
        )
        .limit(1);
      if (!prior) throw DomainError.conflict('Retur duplicat dar rândul original nu a fost găsit');
      return { orderReturn: prior, isNew: false };
    });

    if (!isNew) {
      // Conflict pe (orderId, source, sourceReference): fie deja procesat complet, fie un request
      // concurent tocmai îl procesează. În AMBELE cazuri NU reluăm FGO (altfel dublăm storno/reissue).
      if (!orderReturn.invoiceStorno) {
        // ponytail: un attempt anterior a crăpat între commit și FGO (rar). Storno-ul rămâne de
        // completat manual (nu reluăm automat — riscul de dublă-stornare > câștigul auto-recovery).
        this.logger.warn(
          { orderId, orderReturnId: orderReturn.id, source: options.source },
          'retur duplicat fără factură storno — posibil attempt anterior incomplet, necesită verificare manuală',
        );
      } else if (!orderReturn.invoiceReissue) {
        this.logger.warn(
          { orderId, orderReturnId: orderReturn.id, source: options.source },
          'retur duplicat cu storno dar fără factură reemisă — posibil reissue eșuat, necesită verificare manuală',
        );
      }
      return orderReturn;
    }

    return this.withOrderFgoLock(orderId, () =>
      this.runFgoInvoicing(orderId, orderReturn, options),
    );
  }

  /**
   * Ca `processPartialReturn`, dar identifică liniile după SKU în loc de `orderItemId` —
   * apelanții externi (n8n, Trendyol claims) lucrează în spațiul SKU/ASIN, nu cunosc UUID-urile
   * interne `order_items.id`.
   */
  async processPartialReturnBySku(
    orderId: string,
    items: { sku: string; quantity: number }[],
    options: ProcessPartialReturnOptions,
  ): Promise<schema.OrderReturn> {
    if (items.length === 0) return this.processPartialReturn(orderId, [], options);

    const skus = items.map((i) => i.sku);
    const rows = await this.db
      .select({
        id: schema.orderItems.id,
        sku: schema.orderItems.sku,
        quantity: schema.orderItems.quantity,
      })
      .from(schema.orderItems)
      .where(and(eq(schema.orderItems.orderId, orderId), inArray(schema.orderItems.sku, skus)))
      .orderBy(schema.orderItems.id); // ordine deterministă a distribuției

    // Cât s-a returnat deja pe fiecare linie candidată — ca distribuția să umple liniile cu
    // capacitate RĂMASĂ, nu doar cea vândută (altfel un al doilea retur pe un SKU split ar pica
    // fals pe plafon). ponytail: citit în afara tranzacției; verificarea reală de plafon (sub
    // FOR UPDATE) rămâne autoritară — o cursă rară duce doar la o respingere fail-safe.
    const itemIds = rows.map((r) => r.id);
    const returnedRows = itemIds.length
      ? await this.db
          .select({
            orderItemId: schema.orderReturnItems.orderItemId,
            quantity: schema.orderReturnItems.quantity,
          })
          .from(schema.orderReturnItems)
          .innerJoin(
            schema.orderReturns,
            eq(schema.orderReturns.id, schema.orderReturnItems.orderReturnId),
          )
          .where(
            and(
              eq(schema.orderReturns.orderId, orderId),
              inArray(schema.orderReturnItems.orderItemId, itemIds),
            ),
          )
      : [];
    const returnedByItem = new Map<string, number>();
    for (const r of returnedRows) {
      returnedByItem.set(r.orderItemId, (returnedByItem.get(r.orderItemId) ?? 0) + r.quantity);
    }

    // Un SKU poate apărea pe mai multe linii (linii Trendyol split cu același barcode) — grupăm și
    // distribuim cantitatea cerută pe capacitatea rămasă a fiecărei linii (mutabilă în cadrul apelului).
    const linesBySku = new Map<string, string[]>();
    const capacity = new Map<string, number>();
    for (const r of rows) {
      const list = linesBySku.get(r.sku) ?? [];
      list.push(r.id);
      linesBySku.set(r.sku, list);
      capacity.set(r.id, r.quantity - (returnedByItem.get(r.id) ?? 0));
    }

    const resolved: ProcessPartialReturnItem[] = [];
    for (const { sku, quantity } of items) {
      const candidates = linesBySku.get(sku) ?? [];
      const firstId = candidates[0];
      if (firstId === undefined) {
        throw DomainError.validation(`SKU ${sku} nu a fost găsit pe comanda ${orderId}`);
      }
      let remaining = quantity;
      for (const id of candidates) {
        if (remaining <= 0) break;
        const cap = capacity.get(id) ?? 0;
        if (cap <= 0) continue;
        const take = Math.min(remaining, cap);
        resolved.push({ orderItemId: id, quantity: take });
        capacity.set(id, cap - take);
        remaining -= take;
      }
      // Dacă s-a cerut mai mult decât capacitatea rămasă a acestui SKU, pune restul pe prima linie —
      // verificarea de plafon din tranzacție îl va respinge corect.
      if (remaining > 0) resolved.push({ orderItemId: firstId, quantity: remaining });
    }
    return this.processPartialReturn(orderId, resolved, options);
  }

  async listReturns(orderId: string): Promise<schema.OrderReturn[]> {
    return this.db
      .select()
      .from(schema.orderReturns)
      .where(eq(schema.orderReturns.orderId, orderId))
      .orderBy(schema.orderReturns.createdAt);
  }

  /** `items` sunt deja agregate pe orderItemId (vezi aggregateByItem). */
  private async recordItemsAndRestoreStock(
    tx: Tx,
    orderId: string,
    orderReturnId: string,
    items: ProcessPartialReturnItem[],
  ): Promise<void> {
    if (items.length === 0) return;

    const orderItemIds = items.map((i) => i.orderItemId);
    const orderItemRows = await tx
      .select({
        id: schema.orderItems.id,
        quantity: schema.orderItems.quantity,
        productId: schema.orderItems.productId,
      })
      .from(schema.orderItems)
      .where(
        and(eq(schema.orderItems.orderId, orderId), inArray(schema.orderItems.id, orderItemIds)),
      );
    const byId = new Map(orderItemRows.map((r) => [r.id, r]));

    for (const { orderItemId } of items) {
      if (!byId.has(orderItemId)) {
        throw DomainError.validation(`Linia ${orderItemId} nu aparține comenzii ${orderId}`);
      }
    }

    // Retururi anterioare pe aceleași linii (orice sursă) — sub blocajul FOR UPDATE al comenzii,
    // deci un retur concurent pe aceeași comandă nu poate strecura cantități între SELECT și INSERT.
    const alreadyReturnedRows = await tx
      .select({
        orderItemId: schema.orderReturnItems.orderItemId,
        quantity: schema.orderReturnItems.quantity,
      })
      .from(schema.orderReturnItems)
      .innerJoin(
        schema.orderReturns,
        eq(schema.orderReturns.id, schema.orderReturnItems.orderReturnId),
      )
      .where(
        and(
          eq(schema.orderReturns.orderId, orderId),
          inArray(schema.orderReturnItems.orderItemId, orderItemIds),
        ),
      );
    const alreadyReturned = new Map<string, number>();
    for (const row of alreadyReturnedRows) {
      alreadyReturned.set(
        row.orderItemId,
        (alreadyReturned.get(row.orderItemId) ?? 0) + row.quantity,
      );
    }

    for (const { orderItemId, quantity } of items) {
      const orderItem = byId.get(orderItemId);
      if (!orderItem) continue;
      const priorReturned = alreadyReturned.get(orderItemId) ?? 0;
      if (priorReturned + quantity > orderItem.quantity) {
        throw DomainError.conflict(
          `Cantitatea returnată depășește cantitatea vândută pentru linia ${orderItemId}`,
          {
            orderItemId,
            sold: orderItem.quantity,
            alreadyReturned: priorReturned,
            requested: quantity,
          },
        );
      }
    }

    await tx.insert(schema.orderReturnItems).values(
      items.map((i) => ({
        id: uuidv7(),
        orderReturnId,
        orderItemId: i.orderItemId,
        quantity: i.quantity,
      })),
    );

    // Ordonează update-urile de stoc după productId (ordine de lock consistentă) — două retururi
    // concurente pe comenzi diferite care ating aceleași produse nu se pot bloca reciproc (deadlock).
    const stockUpdates = items
      .map((i) => ({ productId: byId.get(i.orderItemId)?.productId, quantity: i.quantity }))
      .filter((u): u is { productId: string; quantity: number } => Boolean(u.productId))
      .sort((a, b) => (a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0));
    for (const { productId, quantity } of stockUpdates) {
      await tx
        .update(schema.products)
        .set({
          stockQuantity: sql`${schema.products.stockQuantity} + ${quantity}`,
          updatedAt: new Date(),
        })
        .where(eq(schema.products.id, productId));
    }
  }

  private async computeRemainingItems(orderId: string): Promise<FgoReturnLineItem[]> {
    const items = await this.db
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, orderId));

    const returnedRows = await this.db
      .select({
        orderItemId: schema.orderReturnItems.orderItemId,
        quantity: schema.orderReturnItems.quantity,
      })
      .from(schema.orderReturnItems)
      .innerJoin(
        schema.orderReturns,
        eq(schema.orderReturns.id, schema.orderReturnItems.orderReturnId),
      )
      .where(eq(schema.orderReturns.orderId, orderId));
    const returnedByItem = new Map<string, number>();
    for (const row of returnedRows) {
      returnedByItem.set(
        row.orderItemId,
        (returnedByItem.get(row.orderItemId) ?? 0) + row.quantity,
      );
    }

    // Linia sintetică VOUCHER/TRANSPORT rămâne exclusă din reemitere — discountul real e deja
    // alocat per produs (voucherAmountMinor, populat la import din eMAG product_voucher_split /
    // Trendyol lineSellerDiscount+lineTyDiscount) și scăzut mai jos din prețul liniei păstrate.
    // Transportul nu are alocare per-produs la nicio piață — rămâne exclus (decizie separată).
    return items
      .filter((it) => !SYNTHETIC_SKUS.has(it.sku))
      .map((it) => {
        // Discount per unitate (total liniei / cantitatea originală) — aplicat produselor
        // PĂSTRATE, ca factura reemisă să reflecte discountul propriu, nu prețul brut.
        const voucherPerUnitMinor =
          it.voucherAmountMinor !== null && it.quantity > 0
            ? BigInt(Math.round(Number(it.voucherAmountMinor) / it.quantity))
            : 0n;
        return {
          sku: it.sku,
          name: it.name,
          quantity: it.quantity - (returnedByItem.get(it.id) ?? 0),
          unitPriceAmountMinor: it.unitPriceAmountMinor - voucherPerUnitMinor,
          unitPriceCurrency: it.unitPriceCurrency,
          attributes: it.attributes,
        };
      })
      .filter((it) => it.quantity > 0);
  }

  private async runFgoInvoicing(
    orderId: string,
    orderReturn: schema.OrderReturn,
    options: ProcessPartialReturnOptions,
  ): Promise<schema.OrderReturn> {
    const fgoRecord = await this.registry.findByPackageName(FGO_PACKAGE);
    const fgoPlugin = fgoRecord ? this.loaded.getById(fgoRecord.id) : null;
    if (!fgoPlugin) throw DomainError.notFound('Plugin-ul FGO nu este instalat sau activ');

    const stornoRes = (await invokeAction(fgoPlugin.instance, 'stornoInvoice', {
      orderId,
    })) as { series: string; number: string };
    const invoiceStorno: schema.OrderInvoice = {
      series: stornoRes.series,
      number: stornoRes.number,
      status: 'issued',
      issued_at: new Date().toISOString(),
    };
    // Persistă storno IMEDIAT — dacă reemiterea pică după storno, rândul reflectă progresul real
    // (storno făcut, reissue lipsă) în loc să pară că nu s-a întâmplat nimic.
    await this.db
      .update(schema.orderReturns)
      .set({ invoiceStorno })
      .where(eq(schema.orderReturns.id, orderReturn.id));

    const remaining = await this.computeRemainingItems(orderId);

    // Retur total (nimic rămas de facturat) → comanda trece în "returned". Nu blocăm restul
    // procesării dacă tranziția nu e validă din starea curentă (ex. deja returned/cancelled).
    if (remaining.length === 0) {
      const [order] = await this.db
        .select({ status: schema.orders.status })
        .from(schema.orders)
        .where(eq(schema.orders.id, orderId))
        .limit(1);
      if (order && canTransition(order.status, 'returned')) {
        await this.orders.updateStatus(orderId, 'returned');
      }
    }

    let invoiceReissue: schema.OrderInvoice | null = null;
    if (remaining.length > 0 || options.feeAmountMinor) {
      const reissueRes = (await invokeAction(fgoPlugin.instance, 'emitReturnInvoice', {
        orderId,
        items: remaining,
        ...(options.feeAmountMinor !== undefined ? { feeAmountMinor: options.feeAmountMinor } : {}),
        ...(options.feeCurrency ? { feeCurrency: options.feeCurrency } : {}),
      })) as { series: string; number: string; issuedAt: string };
      invoiceReissue = {
        series: reissueRes.series,
        number: reissueRes.number,
        status: 'issued',
        issued_at: reissueRes.issuedAt,
      };
    }

    this.logger.log(
      { orderId, orderReturnId: orderReturn.id, invoiceStorno, invoiceReissue },
      'partial return processed',
    );

    const [updated] = await this.db
      .update(schema.orderReturns)
      .set({ invoiceStorno, invoiceReissue })
      .where(eq(schema.orderReturns.id, orderReturn.id))
      .returning();
    return updated ?? orderReturn;
  }
}
