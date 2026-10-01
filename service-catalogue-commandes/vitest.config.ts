import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Variables minimales pour que src/config/env.ts se charge en test
    // sans qu'aucune base de données réelle ne soit requise.
    env: {
      NODE_ENV: 'test',
      PORT: '3000',
      LOG_LEVEL: 'silent',
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test?schema=public',
      AVIS_SERVICE_URL: 'http://localhost:4000/graphql',
    },
    coverage: {
      provider: 'v8',
      // Périmètre : le code que des tests unitaires peuvent couvrir sans
      // base de données.
      //
      // `src/repositories/**` en est volontairement exclu : ces modules ne
      // contiennent que des appels Prisma et les transactions sous verrou
      // `SELECT ... FOR UPDATE`. Les simuler ne prouverait rien — seul un
      // PostgreSQL réel le peut. Ils sont couverts par les tests
      // d'intégration de l'étape 13 (dont le test de concurrence sur le
      // stock), qui auront leur propre seuil.
      include: [
        'src/services/**',
        'src/utils/**',
        'src/validators/**',
        'src/middlewares/**',
      ],
      thresholds: { lines: 70, functions: 70, branches: 60, statements: 70 },
    },
  },
});
