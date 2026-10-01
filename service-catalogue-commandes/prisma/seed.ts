/**
 * Jeu de données de démonstration.
 *
 * Exécution :  npm run db:seed   (nécessite un PostgreSQL joignable)
 * Idempotent : `upsert` sur la référence, donc rejouable sans doublon.
 */
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

const PRODUCTS: ReadonlyArray<{
  reference: string;
  name: string;
  description: string;
  price: string;
  stock: number;
}> = [
  { reference: 'SS-PRD-00001', name: 'Casque audio sans fil', description: 'Réduction de bruit active, 30 h d’autonomie.', price: '129.90', stock: 42 },
  { reference: 'SS-PRD-00002', name: 'Clavier mécanique compact', description: 'Format 65 %, switches linéaires, rétroéclairage.', price: '89.00', stock: 17 },
  { reference: 'SS-PRD-00003', name: 'Souris ergonomique verticale', description: 'Capteur 4000 dpi, réduit la tension du poignet.', price: '54.50', stock: 63 },
  { reference: 'SS-PRD-00004', name: 'Écran 27 pouces QHD', description: 'Dalle IPS 144 Hz, pied réglable en hauteur.', price: '319.99', stock: 8 },
  { reference: 'SS-PRD-00005', name: 'Station d’accueil USB-C', description: '11 ports, charge 100 W, double sortie vidéo.', price: '149.00', stock: 24 },
  { reference: 'SS-PRD-00006', name: 'Webcam 1080p', description: 'Autofocus, micro stéréo à réduction de bruit.', price: '69.90', stock: 0 },
  { reference: 'SS-PRD-00007', name: 'Disque SSD externe 1 To', description: 'USB 3.2 Gen 2, 1050 Mo/s, boîtier antichoc.', price: '99.00', stock: 35 },
  { reference: 'SS-PRD-00008', name: 'Lampe de bureau LED', description: 'Température de couleur réglable, port USB intégré.', price: '39.90', stock: 51 },
  { reference: 'SS-PRD-00009', name: 'Support d’ordinateur portable', description: 'Aluminium, six niveaux d’inclinaison, pliable.', price: '34.50', stock: 78 },
  { reference: 'SS-PRD-00010', name: 'Micro-casque de conférence', description: 'Certifié pour la visioconférence, perche antibruit.', price: '79.00', stock: 12 },
  { reference: 'SS-PRD-00011', name: 'Tapis de souris XXL', description: '900 × 400 mm, surface tissée, base antidérapante.', price: '24.90', stock: 96 },
  { reference: 'SS-PRD-00012', name: 'Chargeur secteur 65 W GaN', description: 'Deux ports USB-C, compact, charge rapide.', price: '44.00', stock: 30 },
];

async function main(): Promise<void> {
  for (const product of PRODUCTS) {
    await prisma.product.upsert({
      where: { reference: product.reference },
      create: { ...product, price: new Prisma.Decimal(product.price) },
      update: { ...product, price: new Prisma.Decimal(product.price) },
    });
  }

  const total = await prisma.product.count();
  process.stdout.write(`Seed terminé : ${String(total)} produits en catalogue.\n`);
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`Échec du seed : ${String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
