import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { z } from 'zod';

import { Roles } from '../auth/decorators/roles.decorator.js';
import { Scopes } from '../auth/decorators/scopes.decorator.js';
import { AwbService } from '../awb/awb.service.js';
import { zodPipe } from '../products/pipes/zod-validation.pipe.js';

import { CreateOrderDto, createOrderSchema } from './dto/create-order.dto.js';
import { ListOrdersDto, listOrdersSchema } from './dto/list-orders.dto.js';
import { toOrderResponse, type OrderResponse } from './dto/order-response.dto.js';
import { UpdateOrderStatusDto, updateOrderStatusSchema } from './dto/update-status.dto.js';
import { EmagAwbIssueService, marketplaceToPlatform } from './emag-awb-issue.service.js';
import { EmagAwbPdfService } from './emag-awb-pdf.service.js';
import { EmagOrderActionsService } from './emag-order-actions.service.js';
import { EmagOrderSyncService } from './emag-order-sync.service.js';
import { OrderReturnsService } from './order-returns.service.js';
import { OrdersService } from './orders.service.js';
import { TemuAwbService } from './temu-awb.service.js';
import { TemuOrderSyncService } from './temu-order-sync.service.js';
import { TrendyolAwbService } from './trendyol-awb.service.js';
import { TrendyolOrderActionsService } from './trendyol-order-actions.service.js';
import { TrendyolOrderSyncService } from './trendyol-order-sync.service.js';

import type { Request, Response } from 'express';

@ApiTags('Orders')
@ApiBearerAuth('apiKey')
@ApiCookieAuth('session')
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly service: OrdersService,
    private readonly awbService: AwbService,
    private readonly emagSync: EmagOrderSyncService,
    private readonly emagActions: EmagOrderActionsService,
    private readonly emagAwbIssue: EmagAwbIssueService,
    private readonly emagAwbPdf: EmagAwbPdfService,
    private readonly trendyolSync: TrendyolOrderSyncService,
    private readonly trendyolActions: TrendyolOrderActionsService,
    private readonly temuSync: TemuOrderSyncService,
    private readonly temuAwb: TemuAwbService,
    private readonly trendyolAwb: TrendyolAwbService,
    private readonly orderReturns: OrderReturnsService,
  ) {}

  @Get()
  @Scopes('orders:read')
  @ApiOperation({
    summary: 'Listează comenzile',
    description: `Returnează comenzile platformei, paginate câte 100, sortate descendent după data plasării (cele mai noi primul).

**Autentificare:** trimite cheia API în header-ul \`Authorization: Bearer ops_<key>\`.

**Paginare:** răspunsul include \`total\`, \`page\` și \`pageSize\` (fix 100). Treci \`?page=2\` pentru pagina următoare.

**Filtre multi-value:** \`status\`, \`marketplaceInclude\`, \`marketplaceExclude\`, \`deliveryMode\`, \`paymentMethod\` acceptă mai multe valori:
- Separate prin virgulă: \`?status=new,processing\`
- Parametru repetat: \`?status=new&status=processing\`

**Filtre boolean:** \`hasInvoice\`, \`hasAwb\`, \`hasShipping\`, \`hasVoucher\`, \`hasCancellationRequest\`
- \`true\` → comenzile **care au** acel câmp
- \`false\` → comenzile **care nu au** acel câmp
- (omis) → fără filtru`,
  })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Pagina (default: 1)' })
  @ApiQuery({
    name: 'status',
    required: false,
    isArray: true,
    explode: false,
    enum: [
      'new',
      'processing',
      'packed',
      'shipped',
      'delivered',
      'undelivered',
      'returned',
      'cancelled',
      'refunded',
    ],
    description:
      'Unul sau mai multe statusuri. Ex: new,processing sau status=new&status=processing',
  })
  @ApiQuery({
    name: 'marketplaceInclude',
    required: false,
    isArray: true,
    explode: false,
    type: String,
    description:
      'Returnează DOAR comenzile din marketplace-urile specificate. Valori: emag-ro, emag-hu, emag-bg, fbe-ro, fbe-hu, fbe-bg, fd-ro, fd-bg, trendyol-ro, trendyol-gr, temu… Ex: marketplaceInclude=emag-ro,fbe-ro',
  })
  @ApiQuery({
    name: 'marketplaceExclude',
    required: false,
    isArray: true,
    explode: false,
    type: String,
    description:
      'Returnează comenzile DIN AFARA marketplace-urilor specificate. Comenzile fără marketplace (null) trec filtrul. Ex: marketplaceExclude=temu',
  })
  @ApiQuery({
    name: 'deliveryMode',
    required: false,
    isArray: true,
    explode: false,
    enum: ['pickup', 'courier'],
    description: 'pickup = Locker/Easybox · courier = Livrare la domiciliu',
  })
  @ApiQuery({
    name: 'paymentMethod',
    required: false,
    isArray: true,
    explode: false,
    type: Number,
    description: '1 = Ramburs · 2 = Transfer Bancar · 3 = Card Online',
  })
  @ApiQuery({
    name: 'placedAfter',
    required: false,
    type: String,
    description: 'Data minimă (ISO 8601). Ex: 2026-01-01 sau 2026-01-01T00:00:00Z',
  })
  @ApiQuery({
    name: 'placedBefore',
    required: false,
    type: String,
    description: 'Data maximă (ISO 8601). Ex: 2026-05-31 sau 2026-05-31T23:59:59Z',
  })
  @ApiQuery({
    name: 'hasInvoice',
    required: false,
    type: Boolean,
    description: 'true = cu factură · false = fără factură',
  })
  @ApiQuery({
    name: 'hasAwb',
    required: false,
    type: Boolean,
    description: 'true = cu AWB · false = fără AWB',
  })
  @ApiQuery({
    name: 'hasShipping',
    required: false,
    type: Boolean,
    description: 'true = cu linie transport · false = fără linie transport',
  })
  @ApiQuery({
    name: 'hasVoucher',
    required: false,
    type: Boolean,
    description: 'true = cu voucher · false = fără voucher',
  })
  @ApiQuery({
    name: 'hasCancellationRequest',
    required: false,
    type: Boolean,
    description: 'true = cu cerere de anulare (eMAG) · false = fără cerere de anulare',
  })
  @ApiQuery({
    name: 'hasUnmatchedItems',
    required: false,
    type: Boolean,
    description:
      'true = comenzile cu minim un produs neidentificat · false = comenzile complet identificate',
  })
  @ApiResponse({
    status: 200,
    description: 'Listă paginată de comenzi',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: { type: 'object' },
          description: 'Comenzile din pagina curentă',
        },
        totalPages: {
          type: 'integer',
          description: 'Numărul total de pagini. Iterează de la page=1 până la page=totalPages.',
        },
        page: { type: 'integer', description: 'Pagina curentă' },
        pageSize: { type: 'integer', example: 100, description: 'Fix 100' },
      },
    },
  })
  async list(@Query(zodPipe(listOrdersSchema)) q: ListOrdersDto, @Req() req: Request) {
    const includeRawPayload = req.apiKey === undefined;
    const { data, total, firstItems, allItemsByOrder, hasUnmatchedByOrder } =
      await this.service.list(q);
    return {
      data: data.map((o) =>
        toOrderResponse(o, undefined, undefined, firstItems.get(o.id), allItemsByOrder.get(o.id), {
          includeRawPayload,
          hasUnmatchedItems: hasUnmatchedByOrder.get(o.id) ?? false,
        }),
      ),
      totalPages: Math.max(1, Math.ceil(total / 100)),
      page: q.page,
      pageSize: 100,
    };
  }

  @Get(':id')
  @Scopes('orders:read')
  async get(@Param('id') id: string, @Req() req: Request): Promise<OrderResponse> {
    const includeRawPayload = req.apiKey === undefined;
    const { order, items, productLookup } = await this.service.get(id);
    return toOrderResponse(order, items, { productLookup }, undefined, undefined, {
      includeRawPayload,
    });
  }

  @Post()
  @Roles('admin', 'operator')
  @Scopes('orders:write')
  async create(@Body(zodPipe(createOrderSchema)) body: CreateOrderDto): Promise<OrderResponse> {
    const { order, items } = await this.service.create(body);
    return toOrderResponse(order, items);
  }

  @Patch(':id/status')
  @Roles('admin', 'operator')
  @Scopes('orders:status:write')
  async updateStatus(
    @Param('id') id: string,
    @Body(zodPipe(updateOrderStatusSchema)) body: UpdateOrderStatusDto,
  ): Promise<OrderResponse> {
    const order = await this.service.updateStatus(id, body.status);
    return toOrderResponse(order);
  }

  @Post('sync/emag')
  @HttpCode(200)
  @Roles('admin', 'operator')
  async syncEmag(
    @Query('days') daysRaw?: string,
  ): Promise<{ ok: boolean; pluginId: string; createdAfter?: string }> {
    const sinceDays = daysRaw !== undefined ? Number(daysRaw) : undefined;
    const options =
      sinceDays !== undefined && Number.isFinite(sinceDays) && sinceDays > 0
        ? { sinceDays }
        : undefined;
    const result = await this.emagSync.triggerImmediateSync(options);
    if (!result) throw new NotFoundException('Plugin-ul eMAG nu este instalat');
    return result.createdAfter !== undefined
      ? { ok: true, pluginId: result.pluginId, createdAfter: result.createdAfter }
      : { ok: true, pluginId: result.pluginId };
  }

  @Post('sync/trendyol')
  @HttpCode(200)
  @Roles('admin', 'operator')
  async syncTrendyol(@Query('days') daysRaw?: string): Promise<{ ok: boolean; pluginId: string }> {
    const sinceDays = daysRaw !== undefined ? Number(daysRaw) : undefined;
    // Trendyol stream retrospective limit = 90 days; cap silently to avoid API errors.
    const clampedDays =
      sinceDays !== undefined && Number.isFinite(sinceDays) && sinceDays > 0
        ? Math.min(sinceDays, 90)
        : undefined;
    const options = clampedDays !== undefined ? { sinceHours: clampedDays * 24 } : undefined;
    const result = await this.trendyolSync.triggerImmediateSync(options);
    if (!result) throw new NotFoundException('Plugin-ul Trendyol nu este instalat');
    return { ok: true, pluginId: result.pluginId };
  }

  @Post('sync/temu')
  @HttpCode(200)
  @Roles('admin', 'operator')
  async syncTemu(@Query('days') daysRaw?: string): Promise<{ ok: boolean; pluginId: string }> {
    const sinceDays = daysRaw !== undefined ? Number(daysRaw) : undefined;
    const options =
      sinceDays !== undefined && Number.isFinite(sinceDays) && sinceDays > 0
        ? { sinceHours: sinceDays * 24 }
        : undefined;
    const result = await this.temuSync.triggerImmediateSync(options);
    if (!result) throw new NotFoundException('Plugin-ul Temu nu este instalat');
    return { ok: true, pluginId: result.pluginId };
  }

  @Post(':id/awb-outgoing/confirm-temu')
  @HttpCode(200)
  @Roles('admin', 'operator')
  @Scopes('awb:emit')
  async confirmTemuAwb(@Param('id') id: string, @Body() body: unknown) {
    const schema = z.object({
      trackingCompany: z.string().min(1),
      trackingNumber: z.string().min(1),
      orderSnList: z.array(z.string().min(1)).optional().default([]),
    });
    const input = schema.parse(body);
    return this.temuAwb.confirm(id, input);
  }

  @Get(':id/awb-label')
  @Roles('admin', 'operator')
  @Scopes('orders:read')
  async getTrendyolAwbLabel(
    @Param('id') id: string,
  ): Promise<{ pdfBase64: string; contentType: string | undefined }> {
    return this.trendyolAwb.getLabel(id);
  }

  @Get(':id/awb-label-emag')
  @Roles('admin', 'operator')
  @Scopes('orders:read')
  async getEmagAwbLabel(
    @Param('id') id: string,
  ): Promise<{ pdfBase64: string; contentType: string | undefined }> {
    return this.emagAwbPdf.getLabel(id);
  }

  @Post(':id/emag-storno')
  @HttpCode(200)
  @Roles('admin', 'operator')
  @Scopes('orders:write')
  async createStorno(
    @Param('id') id: string,
  ): Promise<{ ok: boolean; series: string; number: string }> {
    const result = await this.emagActions.createStorno(id);
    return { ok: true, ...result };
  }

  @Post(':id/emag-storno-partial')
  @HttpCode(200)
  @Roles('admin', 'operator')
  @Scopes('orders:write')
  async stornoPartial(@Param('id') id: string, @Body() body: unknown): Promise<{ ok: boolean }> {
    const bodySchema = z.object({
      products: z.array(z.object({ id: z.number().int(), quantity: z.number().int().min(0) })),
    });
    const { products } = bodySchema.parse(body);
    await this.emagActions.stornoPartial(id, products);
    return { ok: true };
  }

  @Get(':id/returns')
  @Roles('admin', 'operator')
  @Scopes('orders:read')
  async listReturns(@Param('id') id: string) {
    return this.orderReturns.listReturns(id);
  }

  @Post(':id/return')
  @HttpCode(200)
  @Roles('admin', 'operator')
  @Scopes('orders:write')
  async processReturn(@Param('id') id: string, @Body() body: unknown) {
    const bodySchema = z
      .object({
        items: z.array(z.object({ sku: z.string().min(1), quantity: z.number().int().min(1) })),
        source: z.enum(['emag_rma', 'trendyol_claim', 'manual']),
        sourceReference: z.string().min(1).optional(),
        // O taxă de 0 nu e o taxă — o respingem ca să evităm ambiguitatea 0 vs undefined în serviciu.
        feeAmountMinor: z.number().int().positive().optional(),
        feeCurrency: z.string().length(3).optional(),
        comment: z.string().optional(),
      })
      // Sursele de marketplace au nevoie de sourceReference pentru deduplicare (vezi DB CHECK).
      .refine((b) => b.source === 'manual' || !!b.sourceReference, {
        message:
          'sourceReference obligatoriu pentru surse de marketplace (emag_rma/trendyol_claim)',
        path: ['sourceReference'],
      })
      // Regula casei: sumă + monedă mereu împreună.
      .refine((b) => (b.feeAmountMinor === undefined) === (b.feeCurrency === undefined), {
        message: 'feeAmountMinor și feeCurrency trebuie trimise împreună',
        path: ['feeCurrency'],
      });
    const input = bodySchema.parse(body);
    const orderReturn = await this.orderReturns.processPartialReturnBySku(id, input.items, {
      source: input.source,
      sourceReference: input.sourceReference,
      feeAmountMinor: input.feeAmountMinor,
      feeCurrency: input.feeCurrency,
      comment: input.comment,
    });
    return { ok: true, orderReturn };
  }

  @Post(':id/emag-cancel')
  @HttpCode(200)
  @Roles('admin', 'operator')
  @Scopes('orders:write')
  async cancelOrder(@Param('id') id: string, @Body() body: unknown): Promise<{ ok: boolean }> {
    const cancelSchema = z.object({ reasonId: z.number().int().positive() });
    const { reasonId } = cancelSchema.parse(body);
    await this.emagActions.cancelOrder(id, reasonId);
    return { ok: true };
  }

  @Post(':id/trendyol-cancel')
  @HttpCode(200)
  @Roles('admin', 'operator')
  @Scopes('orders:write')
  async cancelTrendyolOrder(
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<{ ok: boolean }> {
    const cancelSchema = z.object({ reasonId: z.number().int().positive() });
    const { reasonId } = cancelSchema.parse(body);
    await this.trendyolActions.cancelOrder(id, reasonId);
    return { ok: true };
  }

  @Post(':id/items/:itemId/match')
  @HttpCode(200)
  @Roles('admin', 'operator')
  @Scopes('orders:write')
  @ApiOperation({
    summary: 'Manual Matching — asociază un produs neidentificat cu un produs din catalog',
    description:
      'Setează productId pe order_item și creează/actualizează listing-ul pentru viitoare sincronizări automate.',
  })
  async matchItem(
    @Param('id') orderId: string,
    @Param('itemId') itemId: string,
    @Body() body: unknown,
  ) {
    const schema = z.object({ productId: z.string().uuid() });
    const { productId } = schema.parse(body);
    const { item, product } = await this.service.matchItem(orderId, itemId, productId);
    return { ok: true, itemId: item.id, productId: product.id, sku: product.sku };
  }

  @Patch(':id/items/:itemId/substitute')
  @HttpCode(200)
  @Roles('admin', 'operator')
  @Scopes('orders:write')
  @ApiOperation({
    summary: 'Substituie un articol dintr-o comandă cu un alt produs din catalog',
    description:
      'Înlocuiește local (doar în OpenSales, fără propagare pe marketplace) articolul cu produsul selectat. Valorile originale sunt păstrate pentru audit.',
  })
  async substituteItem(
    @Param('id') orderId: string,
    @Param('itemId') itemId: string,
    @Body() body: unknown,
  ) {
    const substituteSchema = z.object({ productId: z.string().uuid() });
    const { productId } = substituteSchema.parse(body);
    const { item, product } = await this.service.substituteItem(orderId, itemId, productId);
    return { ok: true, itemId: item.id, productId: product.id, sku: product.sku };
  }

  @Post(':id/awb-outgoing/preview-emag')
  @HttpCode(200)
  @Roles('admin', 'operator')
  @Scopes('awb:emit')
  async previewEmagAwb(
    @Param('id') id: string,
    @Body()
    body: unknown,
  ) {
    const previewSchema = z.object({
      parcel_number: z.number().int().min(1).optional(),
      insured_value: z.number().min(0).optional(),
      weight: z.number().min(0).optional(),
      packages: z
        .array(
          z.object({
            weight: z.number().min(0),
            length: z.number().min(0),
            width: z.number().min(0),
            height: z.number().min(0),
          }),
        )
        .optional(),
      /** 0=curierul ridică (implicit), 1=expeditor duce la easybox. */
      dropoff_locker: z.union([z.literal(0), z.literal(1)]).optional(),
    });
    const input = previewSchema.parse(body);
    return this.emagAwbIssue.previewPayload(id, input);
  }

  @Post(':id/awb-outgoing/issue-emag')
  @HttpCode(200)
  @Roles('admin', 'operator')
  @Scopes('awb:emit')
  async issueEmagAwb(
    @Param('id') id: string,
    @Body()
    body: unknown,
  ) {
    const issueEmagSchema = z.object({
      /** Număr colete. Default: 1. */
      parcel_number: z.number().int().min(1).optional(),
      /** Valoare asigurată (RON). Default: 0. */
      insured_value: z.number().min(0).optional(),
      /** Greutate totală (kg). Default: 1 × parcel_number. */
      weight: z.number().min(0).optional(),
      /** Dimensiuni colete. Default: auto-generate din parcel_number (10×20×30 cm). */
      packages: z
        .array(
          z.object({
            weight: z.number().min(0),
            length: z.number().min(0),
            width: z.number().min(0),
            height: z.number().min(0),
          }),
        )
        .optional(),
      /** 0=curierul ridică (implicit), 1=expeditor duce la easybox. */
      dropoff_locker: z.union([z.literal(0), z.literal(1)]).optional(),
    });
    const input = issueEmagSchema.parse(body);
    return this.emagAwbIssue.issueOutgoing(id, input);
  }

  /**
   * Returnează PDF-ul AWB-ului ca fișier binar brut (application/pdf).
   * Funcționează pentru comenzile eMAG (via readAwbPdf cu emag_id) și
   * Trendyol (via getCommonLabel cu trendyol_tracking_number).
   */
  @Get(':id/awb-pdf')
  @Roles('admin', 'operator')
  @Scopes('orders:read')
  async getAwbPdf(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const awb = await this.awbService.read(id);
    const outgoing = awb.outgoing;

    if (!outgoing) {
      throw new NotFoundException(`Comanda ${id} nu are un AWB emis.`);
    }

    if (outgoing.trendyol_tracking_number) {
      const label = await this.trendyolAwb.getLabel(id);
      const buffer = Buffer.from(label.pdfBase64, 'base64');
      res.set('Content-Type', label.contentType ?? 'application/pdf');
      res.send(buffer);
      return;
    }

    if (outgoing.emag_id) {
      const { bytes, contentType } = await this.emagAwbPdf.getPdf(id);
      res.set('Content-Type', contentType);
      res.send(Buffer.from(bytes));
      return;
    }

    throw new NotFoundException(
      `Comanda ${id} nu are un AWB cu PDF disponibil (lipsă emag_id sau trendyol_tracking_number).`,
    );
  }

  /**
   * Returnează PDF-ul AWB binar. Dacă comanda nu are AWB emis și este o
   * comandă eMAG, emite automat AWB-ul cu parametrii impliciți (Creare rapidă)
   * și returnează PDF-ul imediat. Pentru alte marketplace-uri (Trendyol etc.)
   * returnează eroare dacă AWB-ul nu există.
   */
  @Post(':id/awb-outgoing/get-or-issue')
  @Roles('admin', 'operator')
  @Scopes('awb:emit')
  async getOrIssueAwb(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const awb = await this.awbService.read(id);

    if (!awb.outgoing) {
      const { order } = await this.service.get(id);
      const mp = order.marketplace ?? '';
      const isFbe = mp.startsWith('fbe-');
      const isEmag = !isFbe && marketplaceToPlatform(mp) !== null;
      if (isFbe) {
        throw new BadRequestException(
          'Comenzile FBE sunt onorate de eMAG — AWB-ul este gestionat de ei, nu poate fi emis din platformă.',
        );
      }
      if (!isEmag) {
        throw new BadRequestException(
          'AWB-ul nu poate fi emis automat pentru acest marketplace. ' +
            'Emiterea automată este disponibilă doar pentru comenzile eMAG/FashionDays.',
        );
      }
      await this.emagAwbIssue.issueOutgoing(id, {});
    }

    // Servim PDF-ul binar direct — identic cu GET /orders/:id/awb-pdf
    const { outgoing } = await this.awbService.read(id);
    if (!outgoing) throw new NotFoundException(`Comanda ${id} nu are un AWB emis.`);

    if (outgoing.trendyol_tracking_number) {
      const label = await this.trendyolAwb.getLabel(id);
      const buffer = Buffer.from(label.pdfBase64, 'base64');
      res.set('Content-Type', label.contentType ?? 'application/pdf');
      res.send(buffer);
      return;
    }

    const { bytes, contentType } = await this.emagAwbPdf.getPdf(id);
    res.set('Content-Type', contentType);
    res.send(Buffer.from(bytes));
  }

  @Delete('all')
  @HttpCode(200)
  @Roles('admin')
  async deleteAll(): Promise<{ ok: boolean; deleted: number }> {
    const deleted = await this.service.deleteAll();
    return { ok: true, deleted };
  }

  @Delete(':id')
  @HttpCode(204)
  @Roles('admin', 'operator')
  @Scopes('orders:write')
  async deleteManual(@Param('id') id: string): Promise<void> {
    await this.service.deleteManual(id);
  }
}
