import { ReviewModel } from '../models/Review.model.js';
import { BrowsingEventModel } from '../models/BrowsingEvent.model.js';
import { logger } from '../lib/logger.js';

/**
 * Création des index au démarrage.
 *
 * Mongoose ne crée les index que si `autoIndex` est actif, ce qui est
 * déconseillé en production (création implicite et coûteuse à chaque boot).
 * On les crée donc explicitement et une seule fois : `createIndexes` est
 * idempotent, donc sûr même avec 3 replicas qui démarrent en même temps.
 */
export async function ensureIndexes(): Promise<void> {
  await Promise.all([
    ReviewModel.createIndexes(),
    BrowsingEventModel.createIndexes(),
  ]);

  logger.info('index MongoDB vérifiés');
}
