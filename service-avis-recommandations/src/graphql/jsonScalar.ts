import { GraphQLScalarType, Kind } from 'graphql';
import type { ValueNode } from 'graphql';

/**
 * Scalaire JSON — valeur arbitraire, sans schéma imposé.
 *
 * Nécessaire pour exposer le champ `metadata` des événements de navigation.
 * C'est la démonstration concrète de l'argument NoSQL du compte-rendu : un
 * événement SEARCH y range un terme de recherche, un PURCHASE une quantité,
 * sans migration ni colonne supplémentaire. Sans ce scalaire, le champ
 * existe en base mais reste inatteignable depuis l'API.
 */
function parseLiteralValue(ast: ValueNode): unknown {
  switch (ast.kind) {
    case Kind.STRING:
    case Kind.BOOLEAN:
      return ast.value;
    case Kind.INT:
    case Kind.FLOAT:
      return Number(ast.value);
    case Kind.OBJECT:
      return Object.fromEntries(
        ast.fields.map((field) => [field.name.value, parseLiteralValue(field.value)]),
      );
    case Kind.LIST:
      return ast.values.map(parseLiteralValue);
    case Kind.NULL:
      return null;
    default:
      throw new TypeError(`JSON : littéral non supporté (${ast.kind})`);
  }
}

export const JSONScalar = new GraphQLScalarType<unknown, unknown>({
  name: 'JSON',
  description:
    'Valeur JSON arbitraire (objet, tableau, chaîne, nombre, booléen ou null).',

  serialize: (value: unknown) => value,
  parseValue: (value: unknown) => value,
  parseLiteral: parseLiteralValue,
});
