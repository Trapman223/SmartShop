import * as browsingRepository from '../repositories/browsingEvent.repository.js';
import type { BrowsingEventDocument } from '../models/BrowsingEvent.model.js';
import { parseInput } from '../utils/validate.js';
import { trackBrowsingEventSchema } from '../validators/review.validator.js';

export async function trackEvent(input: unknown): Promise<BrowsingEventDocument> {
  const data = parseInput(trackBrowsingEventSchema, input);

  return browsingRepository.create({
    userId: data.userId,
    productId: data.productId,
    category: data.category,
    eventType: data.eventType,
    ...(data.metadata !== undefined ? { metadata: data.metadata } : {}),
  });
}

export async function getBrowsingHistory(
  userId: string,
  limit: number,
): Promise<BrowsingEventDocument[]> {
  return browsingRepository.findByUser(userId, Math.min(Math.max(limit, 1), 200));
}
