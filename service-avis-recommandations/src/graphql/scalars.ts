import { GraphQLScalarType, Kind } from 'graphql';

/** Scalaire DateTime : ISO 8601 en sortie, parsing strict en entrée. */
export const DateTimeScalar = new GraphQLScalarType<Date | null, string>({
  name: 'DateTime',
  description: 'Date et heure au format ISO 8601',

  serialize(value: unknown): string {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'string') return new Date(value).toISOString();
    throw new TypeError('DateTime : valeur non sérialisable');
  },

  parseValue(value: unknown): Date {
    if (typeof value !== 'string') {
      throw new TypeError('DateTime : une chaîne ISO 8601 est attendue');
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new TypeError('DateTime : date invalide');
    }
    return parsed;
  },

  parseLiteral(ast): Date {
    if (ast.kind !== Kind.STRING) {
      throw new TypeError('DateTime : une chaîne ISO 8601 est attendue');
    }
    const parsed = new Date(ast.value);
    if (Number.isNaN(parsed.getTime())) {
      throw new TypeError('DateTime : date invalide');
    }
    return parsed;
  },
});
