import { DomainError } from '../../errors/domain.error.js';

export class InsufficientStockError extends DomainError {
  constructor(productId: string, requested: number, available: number) {
    super(
      'STOCK_RESERVATION_FAILED',
      `Insufficient stock for product ${productId}: requested ${requested}, available ${available}`,
      422,
      { productId, requested, available },
    );
    this.name = 'InsufficientStockError';
  }
}
