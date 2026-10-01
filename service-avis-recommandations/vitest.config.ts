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
      PORT: '4000',
      LOG_LEVEL: 'silent',
      MONGODB_URI: 'mongodb://localhost:27017/smartshop_avis_test',
      CATALOGUE_SERVICE_URL: 'http://localhost:3000',
    },
    coverage: {
      provider: 'v8',
      // `src/repositories/**` est volontairement exclu : ces modules ne
      // contiennent que des requêtes et des pipelines d'agrégation Mongo.
      // Les simuler ne prouverait rien — seul un MongoDB réel le peut. Ils
      // sont couverts par les tests d'intégration de l'étape 13.
      include: [
        'src/services/**',
        'src/utils/**',
        'src/validators/**',
        'src/resolvers/**',
        'src/graphql/**',
      ],
      thresholds: { lines: 70, functions: 70, branches: 60, statements: 70 },
    },
  },
});
