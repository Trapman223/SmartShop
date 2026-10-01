import { beforeEach, vi } from 'vitest';

/**
 * Aucun test unitaire ne doit atteindre le réseau.
 *
 * `avis-api` écoute sur le port 4000 dès que la stack Swarm tourne : sans ce
 * garde-fou, les tests du flux 2 interrogeraient le service réel et leur
 * résultat dépendrait de l'état du cluster (cf. CLAUDE.md section 11,
 * règle 10 — tests déterministes).
 *
 * Par défaut, tout appel sortant échoue : les tests observent donc le mode
 * dégradé. Ceux qui veulent une réponse précise re-stubbent `fetch` dans leur
 * propre `beforeEach`, qui s'exécute après celui-ci.
 */
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.reject(new Error('appel réseau interdit dans un test unitaire')),
    ),
  );
});
