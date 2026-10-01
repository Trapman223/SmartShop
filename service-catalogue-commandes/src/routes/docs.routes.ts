import { Router } from 'express';
import { openApiDocument } from '../config/openapi.js';

export const docsRoutes = Router();

/** Spécification OpenAPI 3.1 brute. */
docsRoutes.get('/openapi.json', (_req, res) => {
  res.status(200).json(openApiDocument);
});

/**
 * Swagger UI, chargé depuis un CDN.
 * Volontairement sans dépendance `swagger-ui-express` : la spécification est
 * déjà servie en JSON et cette page ne pèse rien dans l'image Docker
 * (cf. CLAUDE.md section 0, règle transverse sur les dépendances).
 */
docsRoutes.get('/docs', (_req, res) => {
  res.status(200).type('html').send(`<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Smart-Shop — API Catalogue &amp; Commandes</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js" crossorigin></script>
    <script>
      window.onload = () => {
        window.SwaggerUIBundle({ url: '/openapi.json', dom_id: '#swagger-ui' });
      };
    </script>
  </body>
</html>`);
});
