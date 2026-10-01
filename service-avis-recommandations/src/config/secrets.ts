import { readFileSync } from 'node:fs';

/**
 * Résolution des secrets montés en fichiers par Docker Swarm.
 *
 * Swarm n'injecte jamais un secret dans une variable d'environnement : il le
 * monte en fichier sous /run/secrets/<nom>. La convention établie (suivie par
 * les images officielles postgres, mongo, mysql…) est d'accepter une variable
 * suffixée `_FILE` qui pointe vers ce fichier.
 *
 * Exemple :
 *   DATABASE_URL_FILE=/run/secrets/catalogue_database_url
 * devient
 *   DATABASE_URL=<contenu du fichier>
 *
 * La variable directe reste prioritaire : elle sert en développement local,
 * où aucun secret Swarm n'existe.
 */
export function resolveFileSecrets(
  source: NodeJS.ProcessEnv,
  keys: readonly string[],
): NodeJS.ProcessEnv {
  const resolved: NodeJS.ProcessEnv = { ...source };

  for (const key of keys) {
    const direct = source[key];
    if (direct !== undefined && direct !== '') {
      continue;
    }

    const path = source[`${key}_FILE`];
    if (path === undefined || path === '') {
      continue;
    }

    try {
      // trim() : un secret créé par `echo` se termine par un saut de ligne,
      // qui rendrait l'URL de connexion invalide.
      resolved[key] = readFileSync(path, 'utf8').trim();
    } catch (error) {
      throw new Error(
        `Secret illisible pour ${key} : ${path} (${
          error instanceof Error ? error.message : String(error)
        })`,
      );
    }
  }

  return resolved;
}
