import { Injectable } from '@nestjs/common';
import { invokeAction } from '@opensales/plugin-sdk';

import { DomainError } from '../../errors/domain.error.js';
import { LoadedPluginsRegistry } from '../plugins/loader/loaded-plugins.registry.js';

import { InvoiceService } from './invoice.service.js';

import type { LoadedPlugin } from '../plugins/types.js';

/**
 * Orchestrates invoicing actions that span the platform (InvoiceService) and
 * an invoicing plugin (e.g. FGO).  Finds the first loaded plugin with the
 * 'invoicing' capability and delegates to its registered actions.
 *
 * Used by InvoiceController for the quick-action HTTP endpoints:
 *   POST /orders/:orderId/invoice/emit
 *   POST /orders/:orderId/invoice/storno
 *   DELETE /orders/:orderId/invoice  (cascade: cancel at provider + clear DB)
 */
@Injectable()
export class InvoiceActionsService {
  constructor(
    private readonly loaded: LoadedPluginsRegistry,
    private readonly invoice: InvoiceService,
  ) {}

  // ── helpers ──────────────────────────────────────────────────────────────

  private getInvoicingPlugin(): LoadedPlugin {
    const plugin = this.loaded
      .list()
      .find((p) => p.instance.manifest.capabilities.includes('invoicing'));
    if (!plugin) {
      throw DomainError.notFound('No invoicing plugin is currently loaded');
    }
    return plugin;
  }

  // ── public API ────────────────────────────────────────────────────────────

  /**
   * Emits an invoice for an order via the invoicing plugin.
   * The plugin writes the result to the DB via the gateway (orders.updateInvoice).
   */
  async emitInvoice(orderId: string): Promise<unknown> {
    const plugin = this.getInvoicingPlugin();
    return invokeAction(plugin.instance, 'emitInvoice', { orderId });
  }

  /**
   * Creates a storno (credit note) for an order's invoice via the invoicing
   * plugin.  The plugin writes the result via gateway (orders.updateInvoiceStorno).
   */
  async stornoInvoice(orderId: string): Promise<unknown> {
    const plugin = this.getInvoicingPlugin();
    return invokeAction(plugin.instance, 'stornoInvoice', { orderId });
  }

  /**
   * Cancels the invoice at the provider (fgoCancelDirect — no DB write) then
   * clears it from the platform DB (InvoiceService.clear, which restores stock
   * and emits the relevant domain event).
   *
   * Business rules enforced by InvoiceService.clear:
   *   - order must exist
   *   - invoice must exist
   *   - no storno may be present
   */
  async deleteInvoice(orderId: string): Promise<void> {
    const plugin = this.getInvoicingPlugin();
    await invokeAction(plugin.instance, 'fgoCancelDirect', { orderId });
    await this.invoice.clear(orderId, 'invoice');
  }

  // ── Debug / test actions (no DB write) ────────────────────────────────────

  /** Returns the FgoEmitInput payload that would be sent — no FGO call, no DB write. */
  async previewEmitInput(orderId: string): Promise<unknown> {
    const plugin = this.getInvoicingPlugin();
    return invokeAction(plugin.instance, 'previewEmitInput', { orderId });
  }

  /** Calls FGO emit and returns the raw response — no DB write. */
  async testEmitInvoice(orderId: string): Promise<unknown> {
    const plugin = this.getInvoicingPlugin();
    return invokeAction(plugin.instance, 'testEmitInvoice', { orderId });
  }

  /** Returns the payload that would be sent to FGO storno — no FGO call, no DB write. */
  async previewStornoInput(orderId: string): Promise<unknown> {
    const plugin = this.getInvoicingPlugin();
    return invokeAction(plugin.instance, 'previewStornoInput', { orderId });
  }

  /** Calls FGO storno and returns the raw response — no DB write. */
  async testStornoInvoice(orderId: string): Promise<unknown> {
    const plugin = this.getInvoicingPlugin();
    return invokeAction(plugin.instance, 'testStornoInvoice', { orderId });
  }
}
