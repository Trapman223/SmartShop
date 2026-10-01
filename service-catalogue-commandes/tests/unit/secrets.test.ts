import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveFileSecrets } from '../../src/config/secrets.js';

let dossier: string;

beforeEach(() => {
  dossier = mkdtempSync(join(tmpdir(), 'smartshop-secrets-'));
});

afterEach(() => {
  rmSync(dossier, { recursive: true, force: true });
});

function secret(nom: string, contenu: string): string {
  const chemin = join(dossier, nom);
  writeFileSync(chemin, contenu);
  return chemin;
}

describe('resolveFileSecrets — secrets Docker Swarm', () => {
  it('lit la valeur depuis le fichier pointé par la variable _FILE', () => {
    const chemin = secret('url', 'postgresql://u:p@db:5432/x');

    const resolu = resolveFileSecrets({ MA_URL_FILE: chemin }, ['MA_URL']);

    expect(resolu['MA_URL']).toBe('postgresql://u:p@db:5432/x');
  });

  it('retire le saut de ligne final', () => {
    // `echo secret | docker secret create` ajoute un \n qui rendrait
    // l'URL de connexion invalide.
    const chemin = secret('url', 'mongodb://u:p@db:27017/x\n');

    const resolu = resolveFileSecrets({ MA_URL_FILE: chemin }, ['MA_URL']);

    expect(resolu['MA_URL']).toBe('mongodb://u:p@db:27017/x');
  });

  it('donne la priorité à la variable directe (développement local)', () => {
    const chemin = secret('url', 'depuis-le-fichier');

    const resolu = resolveFileSecrets(
      { MA_URL: 'depuis-l-environnement', MA_URL_FILE: chemin },
      ['MA_URL'],
    );

    expect(resolu['MA_URL']).toBe('depuis-l-environnement');
  });

  it('laisse l’environnement intact quand aucune variable _FILE n’est définie', () => {
    const resolu = resolveFileSecrets({ AUTRE: 'valeur' }, ['MA_URL']);

    expect(resolu['MA_URL']).toBeUndefined();
    expect(resolu['AUTRE']).toBe('valeur');
  });

  it('ignore une variable _FILE vide', () => {
    const resolu = resolveFileSecrets({ MA_URL_FILE: '' }, ['MA_URL']);

    expect(resolu['MA_URL']).toBeUndefined();
  });

  it('échoue explicitement si le fichier est introuvable', () => {
    // Mieux vaut refuser de démarrer qu'ouvrir une connexion sans mot de passe.
    expect(() =>
      resolveFileSecrets({ MA_URL_FILE: '/run/secrets/inexistant' }, ['MA_URL']),
    ).toThrow(/Secret illisible pour MA_URL/);
  });

  it('ne modifie pas l’objet source', () => {
    const chemin = secret('url', 'valeur');
    const source = { MA_URL_FILE: chemin };

    resolveFileSecrets(source, ['MA_URL']);

    expect(source).toEqual({ MA_URL_FILE: chemin });
  });
});
