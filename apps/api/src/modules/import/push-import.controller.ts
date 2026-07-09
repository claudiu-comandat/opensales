import { Body, Controller, Get, HttpCode, NotFoundException, Param, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCookieAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { Roles } from '../auth/decorators/roles.decorator.js';
import { Scopes } from '../auth/decorators/scopes.decorator.js';
import { zodPipe } from '../products/pipes/zod-validation.pipe.js';

import {
  prelistImportSchema,
  prelistToPushImport,
  pushImportSchema,
} from './dto/push-import.dto.js';
import { ImportBatchService } from './import-batch.service.js';
import { PushImportService } from './push-import.service.js';

import type {
  ImportBatchResponse,
  PrelistImportDto,
  PushImportDto,
  PushPreviewResponse,
} from './dto/push-import.dto.js';

@ApiTags('Import')
@ApiBearerAuth('apiKey')
@ApiCookieAuth('session')
@Controller('import/products')
export class PushImportController {
  constructor(
    private readonly service: PushImportService,
    private readonly batches: ImportBatchService,
  ) {}

  @Post()
  @HttpCode(200)
  @Roles('admin', 'operator')
  @Scopes('products:write')
  @ApiOperation({
    summary: 'Import produse + publicare pe marketplace-uri',
    description:
      'Importă până la 5000 de produse într-un singur request. ' +
      'Fiecare produs poate include o listă de offer-uri care specifică pe ce marketplace-uri să fie publicat. ' +
      'Răspunde aproape instant cu un `batchId` și planul previzionat per SKU ' +
      '(created / conflict / rejected, validările făcute în bloc). Crearea efectivă a ' +
      'produselor + listing-urilor și push-ul pe marketplace rulează ASINCRON; ' +
      'urmărește progresul cu GET /import/products/{batchId}.\n\n' +
      '**Prețuri:** toate câmpurile de preț (`price`, `fullPrice`) se trimit ca **minor units** (întregi fără zecimale). ' +
      'Ex: `9999` = 99.99 RON. ' +
      'Conversia în moneda marketplace-ului (RON → HUF, RON → EUR etc.) se face automat.\n\n' +
      '**Conflict SKU:** dacă SKU-ul există deja, stocul este actualizat și ' +
      'offer-urile pe marketplace-uri noi sunt adăugate. Offer-urile existente nu sunt modificate.',
  })
  @ApiBody({
    description: 'Lista de produse de importat cu offer-urile lor per marketplace.',
    schema: {
      type: 'object',
      required: ['products'],
      properties: {
        products: {
          type: 'array',
          minItems: 1,
          maxItems: 5000,
          items: {
            type: 'object',
            required: ['sku', 'title', 'price', 'stock'],
            properties: {
              sku: {
                type: 'string',
                maxLength: 64,
                example: 'TRICOU-ALB-M',
                description: 'Identificator unic intern',
              },
              title: {
                type: 'string',
                maxLength: 255,
                example: 'Tricou alb M',
                description: 'Fallback pentru offer-uri fără titlu propriu',
              },
              description: {
                type: 'string',
                maxLength: 10000,
                nullable: true,
                example: 'Tricou 100% bumbac.',
              },
              price: {
                type: 'integer',
                minimum: 0,
                example: 9999,
                description: 'Preț de vânzare în minor units. Ex: 9999 = 99.99 RON',
              },
              fullPrice: {
                type: 'integer',
                minimum: 0,
                example: 14999,
                description: 'Preț barat în minor units. Folosit ca listPrice pe Trendyol',
              },
              currency: {
                type: 'string',
                minLength: 3,
                maxLength: 3,
                default: 'RON',
                example: 'RON',
                description:
                  'Moneda lui price (ISO 4217). Prețurile sunt convertite automat în moneda fiecărui marketplace',
              },
              ean: {
                type: 'string',
                maxLength: 64,
                example: '5901234123457',
                description:
                  'Cod EAN. Trimis automat la eMAG și ca barcode pe Trendyol. Respinge importul dacă aparține altui produs',
              },
              brand: {
                type: 'string',
                maxLength: 255,
                example: 'Nike',
                description: 'Fallback brand pentru offer-uri',
              },
              stock: {
                type: 'integer',
                minimum: 0,
                example: 50,
                description: 'Cantitate stoc — se aplică pe toate marketplace-urile',
              },
              images: {
                type: 'array',
                description: 'Fallback imagini pentru offer-uri fără imagini proprii',
                items: {
                  type: 'object',
                  required: ['url'],
                  properties: {
                    url: {
                      type: 'string',
                      format: 'uri',
                      example: 'https://cdn.example.com/produs.jpg',
                    },
                    alt: { type: 'string', example: 'Tricou alb față' },
                  },
                },
              },
              offers: {
                type: 'array',
                description:
                  'Offer-uri per marketplace. Dacă lipsește sau e gol, produsul e importat fără a fi publicat nicăieri',
                items: {
                  type: 'object',
                  required: ['marketplace'],
                  properties: {
                    marketplace: {
                      type: 'string',
                      example: 'emag-ro',
                      description: 'Codul marketplace-ului. Trebuie instalat și activ în OpenSales',
                      enum: [
                        'emag-ro',
                        'emag-bg',
                        'emag-hu',
                        'fd-ro',
                        'fd-bg',
                        'trendyol-ro',
                        'trendyol-de',
                        'trendyol-bg',
                        'trendyol-gr',
                        'trendyol-sk',
                        'trendyol-cz',
                        'trendyol-sa',
                        'trendyol-ae',
                        'trendyol-kw',
                        'temu-eu',
                        'temu-us',
                        'temu-global',
                      ],
                    },
                    title: {
                      type: 'string',
                      maxLength: 255,
                      description: 'Fallback: product.title',
                    },
                    description: {
                      type: 'string',
                      maxLength: 10000,
                      nullable: true,
                      description: 'Fallback: product.description',
                    },
                    price: {
                      type: 'integer',
                      minimum: 0,
                      example: 8999,
                      description:
                        'Preț specific în minor units, în moneda product.currency. Convertit automat în moneda marketplace-ului. Fallback: product.price',
                    },
                    category: {
                      oneOf: [{ type: 'string' }, { type: 'integer' }],
                      example: 181,
                      description:
                        'ID categorie în sistemul marketplace-ului (numeric). Fără el marketplace-ul poate refuza produsul',
                    },
                    brand: {
                      oneOf: [{ type: 'string' }, { type: 'integer' }],
                      example: 'Nike',
                      description: 'String pe eMAG/Temu. ID numeric (brandId) pe Trendyol',
                    },
                    characteristics: {
                      description:
                        'Atributele produsului în formatul specific marketplace-ului. ' +
                        'eMAG: [{id, value}]. Trendyol: [{attributeId, attributeValueId?, customAttributeValue?}]. Temu: [{attrId, attrValueId}]',
                      example: [{ id: 87, value: 'Alb' }],
                    },
                    images: {
                      type: 'array',
                      description: 'Fallback: product.images',
                      items: {
                        type: 'object',
                        required: ['url'],
                        properties: { url: { type: 'string', format: 'uri' } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    examples: {
      minimal: {
        summary: 'Import produs simplu fără publicare pe marketplace',
        value: {
          products: [
            { sku: 'TRICOU-ALB-M', title: 'Tricou alb M', price: 9999, stock: 50, currency: 'RON' },
          ],
        },
      },
      withOffers: {
        summary: 'Import + publicare pe eMAG și Trendyol',
        value: {
          products: [
            {
              sku: 'TRICOU-ALB-M',
              title: 'Tricou alb M',
              description: 'Tricou 100% bumbac.',
              price: 9999,
              fullPrice: 14999,
              currency: 'RON',
              ean: '5901234123457',
              brand: 'Nike',
              stock: 50,
              images: [{ url: 'https://cdn.example.com/tricou.jpg' }],
              offers: [
                {
                  marketplace: 'emag-ro',
                  category: 181,
                  brand: 'Nike',
                  characteristics: [{ id: 87, value: 'Alb' }],
                },
                {
                  marketplace: 'trendyol-ro',
                  category: 1007,
                  brand: 12345,
                  characteristics: [{ attributeId: 338, attributeValueId: 6927 }],
                },
              ],
            },
          ],
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description:
      'Rezultat per SKU. `queued` = push asincron pornit — nu înseamnă că produsul a ajuns pe marketplace. ' +
      'Verifică statusul final prin GET /listings.',
    schema: {
      type: 'object',
      properties: {
        results: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              sku: { type: 'string', example: 'TRICOU-ALB-M' },
              status: {
                type: 'string',
                enum: ['created', 'conflict', 'rejected'],
                description:
                  'created = produs nou. conflict = SKU existent, stoc actualizat. rejected = EAN duplicat sau eroare',
              },
              reason: {
                type: 'string',
                description: 'Motivul pentru conflict sau rejected',
                example: 'SKU deja existent',
              },
              offers: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    marketplace: { type: 'string', example: 'emag-ro' },
                    status: {
                      type: 'string',
                      enum: ['queued', 'ignored', 'error'],
                      description:
                        'queued = push pornit. ignored = marketplace indisponibil. error = eroare listing',
                    },
                    reason: {
                      type: 'string',
                      description: 'Motivul dacă status = ignored sau error',
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Payload invalid — câmpuri obligatorii lipsă sau tip incorect',
  })
  @ApiResponse({ status: 401, description: 'Autentificare lipsă sau API key invalid' })
  @ApiResponse({ status: 403, description: 'Rol insuficient sau scope products:write lipsă' })
  async import(@Body(zodPipe(pushImportSchema)) body: PushImportDto): Promise<ImportBatchResponse> {
    // Sincron: validări în bloc + plan per SKU + batchId. Procesarea efectivă
    // (create produse, listing-uri, push pe marketplace) rulează asincron.
    return this.batches.planAndQueue(body);
  }

  @Post('prelist')
  @HttpCode(200)
  @Roles('admin', 'operator')
  @Scopes('products:write')
  @ApiOperation({
    summary: 'Prelistare eMAG — postare minimă, fără categorie/caracteristici',
    description:
      'Trimite produse cu date minime (titlu, brand, descriere, preț, imagini, EAN) DOAR pe ' +
      'eMAG România, cu stoc 0 și FĂRĂ categorie/caracteristici — eMAG le atribuie automat în ' +
      'procesul de validare. După aprobare, reconcilierea extrage categoria + caracteristicile ' +
      'atribuite în `listings.sync_state` (`category`, `characteristics`, `part_number_key`, ' +
      '`prelist_validated_at`) și notifică opțional webhook-ul extern configurat în ' +
      'Setări → API & Webhook (workspace.prelistValidatedWebhookUrl).\n\n' +
      '**Doar produse noi:** un SKU deja existent e respins (prelistarea nu atinge produse existente).\n\n' +
      '**Prețuri:** minor units, ca la POST /import/products. Restul datelor (stockCode, fullPrice, ' +
      'dimensiuni implicite, vat_id, part_number) se derivă automat, identic cu importul standard.\n\n' +
      'Răspunde sincron cu `batchId` — urmărește progresul cu GET /import/products/{batchId}.',
  })
  @ApiBody({
    description: 'Lista de produse cu datele minime de prelistare.',
    schema: {
      type: 'object',
      required: ['products'],
      properties: {
        products: {
          type: 'array',
          minItems: 1,
          maxItems: 5000,
          items: {
            type: 'object',
            required: ['sku', 'title', 'brand', 'price', 'images', 'ean'],
            properties: {
              sku: { type: 'string', maxLength: 64, example: 'TRICOU-ALB-M' },
              title: { type: 'string', maxLength: 255, example: 'Tricou alb M' },
              brand: { type: 'string', maxLength: 255, example: 'Nike' },
              description: {
                type: 'string',
                maxLength: 30000,
                nullable: true,
                example: 'Tricou 100% bumbac.',
              },
              price: {
                type: 'integer',
                minimum: 0,
                example: 9999,
                description: 'Preț de vânzare în minor units. Ex: 9999 = 99.99 RON',
              },
              images: {
                type: 'array',
                minItems: 1,
                items: {
                  type: 'object',
                  required: ['url'],
                  properties: {
                    url: { type: 'string', format: 'uri' },
                    alt: { type: 'string' },
                  },
                },
              },
              ean: { type: 'string', maxLength: 64, example: '5901234123457' },
              currency: { type: 'string', minLength: 3, maxLength: 3, default: 'RON' },
              vatRate: { type: 'integer', minimum: 0, maximum: 100, default: 0 },
              handlingTime: { type: 'integer', minimum: 0 },
            },
          },
        },
      },
    },
    examples: {
      minimal: {
        summary: 'Prelistare produs nou pe eMAG RO',
        value: {
          products: [
            {
              sku: 'TRICOU-ALB-M',
              title: 'Tricou alb M',
              brand: 'Nike',
              description: 'Tricou 100% bumbac.',
              price: 9999,
              images: [{ url: 'https://cdn.example.com/tricou.jpg' }],
              ean: '5901234123457',
            },
          ],
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description:
      'Ca la POST /import/products: plan per SKU + batchId. Listing-ul eMAG e creat cu ' +
      'syncState.prelist=true și push-ul pornește asincron, fără categorie.',
  })
  @ApiResponse({ status: 400, description: 'Payload invalid' })
  @ApiResponse({ status: 401, description: 'Autentificare lipsă sau API key invalid' })
  @ApiResponse({ status: 403, description: 'Rol insuficient sau scope products:write lipsă' })
  async prelist(
    @Body(zodPipe(prelistImportSchema)) body: PrelistImportDto,
  ): Promise<ImportBatchResponse> {
    return this.batches.planAndQueue(prelistToPushImport(body));
  }

  @Get('active')
  @Roles('admin', 'operator')
  @Scopes('products:write')
  @ApiOperation({
    summary: 'Lotul de import aflat în procesare (dacă există)',
    description:
      'Întoarce cel mai recent lot cu status `processing`, sau 204/null dacă niciun ' +
      'import nu rulează. Folosit de pagina Produse pentru indicatorul „Se importă produse prin API".',
  })
  @ApiResponse({ status: 200, description: 'Lotul activ sau null.' })
  async active(): Promise<ImportBatchResponse | null> {
    return this.batches.getActiveBatch();
  }

  @Get(':batchId')
  @Roles('admin', 'operator')
  @Scopes('products:write')
  @ApiOperation({
    summary: 'Statusul unui lot de import',
    description:
      'Întoarce progresul lotului: status (processing/completed/failed), câte produse ' +
      'au fost procesate și rezultatul per SKU.',
  })
  @ApiResponse({ status: 200, description: 'Statusul + rezultatele lotului.' })
  @ApiResponse({ status: 404, description: 'Lot inexistent.' })
  async batch(@Param('batchId') batchId: string): Promise<ImportBatchResponse> {
    const res = await this.batches.getBatch(batchId);
    if (!res) throw new NotFoundException(`Lot inexistent: ${batchId}`);
    return res;
  }

  @Post('preview')
  @HttpCode(200)
  @Roles('admin', 'operator')
  @Scopes('products:write')
  @ApiOperation({
    summary: 'Dry-run: payload-urile complete trimise pe fiecare marketplace',
    description:
      'Primește același body ca POST /import/products, dar NU scrie în DB și NU apelează ' +
      'API-urile marketplace-urilor. Pentru fiecare ofertă întoarce payload-ul COMPLET care ' +
      's-ar fi trimis (mapat din datele tale), lista de câmpuri obligatorii lipsă ' +
      '(`missingRequired`) și avertismente (`warnings`). Folosit pentru a valida maparea ' +
      'înainte de push-ul live.\n\n' +
      '**Date specifice per marketplace:** trimite-le în `offers[].emag`, `offers[].trendyol`, ' +
      '`offers[].temu` (ex. eMAG `vatId`; Temu `costTemplateId`, `shipmentLimitDay`, ' +
      '`weightUnit`, `volumeUnit`, `specDetails`). Atributele fizice (greutate, dimensiuni, ' +
      'garanție, handling time) se trimit la nivel de produs.',
  })
  @ApiResponse({
    status: 200,
    description:
      'Payload-uri per SKU și marketplace. `payload` = ce s-ar fi trimis. ' +
      '`missingRequired` gol = request-ul ar fi complet.',
  })
  @ApiResponse({ status: 400, description: 'Payload invalid' })
  @ApiResponse({ status: 401, description: 'Autentificare lipsă sau API key invalid' })
  @ApiResponse({ status: 403, description: 'Rol insuficient sau scope products:write lipsă' })
  async preview(
    @Body(zodPipe(pushImportSchema)) body: PushImportDto,
  ): Promise<PushPreviewResponse> {
    return this.service.previewPayloads(body);
  }
}
