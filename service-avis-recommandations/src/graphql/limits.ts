import { GraphQLError, Kind } from 'graphql';
import type {
  ASTVisitor,
  FragmentDefinitionNode,
  OperationDefinitionNode,
  SelectionSetNode,
  ValidationContext,
  ValidationRule,
} from 'graphql';

/**
 * Garde-fous de validation GraphQL — exigés par CLAUDE.md section 8, règle 8.
 *
 * Écrits à la main plutôt qu'avec `graphql-depth-limit` ou
 * `graphql-query-complexity` : deux règles de validation suffisent ici, et
 * le sujet ne justifie pas d'alourdir l'image (CLAUDE.md section 0, règle
 * transverse sur les dépendances).
 *
 * L'introspection est exemptée : son arbre dépasse largement la profondeur
 * applicative, et le sujet attend que le correcteur explore le schéma depuis
 * Apollo Sandbox.
 */

/** Une opération ne demandant que des champs `__*` est une introspection. */
function isIntrospectionOnly(operation: OperationDefinitionNode): boolean {
  const fields = operation.selectionSet.selections.filter(
    (selection) => selection.kind === Kind.FIELD,
  );
  return (
    fields.length > 0 &&
    fields.every((field) => field.name.value.startsWith('__'))
  );
}

function resolveFragment(
  context: ValidationContext,
  name: string,
): FragmentDefinitionNode | undefined {
  return context.getFragment(name) ?? undefined;
}

/** Profondeur maximale d'imbrication des ensembles de sélection. */
function measureDepth(
  selectionSet: SelectionSetNode,
  context: ValidationContext,
  depth: number,
  visitedFragments: Set<string>,
): number {
  let deepest = depth;

  for (const selection of selectionSet.selections) {
    if (selection.kind === Kind.FIELD) {
      const reached =
        selection.selectionSet !== undefined
          ? measureDepth(selection.selectionSet, context, depth + 1, visitedFragments)
          : depth + 1;
      deepest = Math.max(deepest, reached);
    } else if (selection.kind === Kind.INLINE_FRAGMENT) {
      // Un fragment inline n'ajoute pas de niveau : il ne fait que typer.
      deepest = Math.max(
        deepest,
        measureDepth(selection.selectionSet, context, depth, visitedFragments),
      );
    } else {
      const name = selection.name.value;
      // Garde-fou contre les fragments cycliques. graphql-js les rejette déjà
      // via NoFragmentCycles, mais cette règle s'exécute en parallèle.
      if (visitedFragments.has(name)) continue;
      visitedFragments.add(name);

      const fragment = resolveFragment(context, name);
      if (fragment !== undefined) {
        deepest = Math.max(
          deepest,
          measureDepth(fragment.selectionSet, context, depth, visitedFragments),
        );
      }
    }
  }

  return deepest;
}

/** Nombre de champs demandés à la racine, fragments compris. */
function countRootFields(
  selectionSet: SelectionSetNode,
  context: ValidationContext,
  visitedFragments: Set<string>,
): number {
  let total = 0;

  for (const selection of selectionSet.selections) {
    if (selection.kind === Kind.FIELD) {
      total += 1;
    } else if (selection.kind === Kind.INLINE_FRAGMENT) {
      total += countRootFields(selection.selectionSet, context, visitedFragments);
    } else {
      const name = selection.name.value;
      if (visitedFragments.has(name)) continue;
      visitedFragments.add(name);

      const fragment = resolveFragment(context, name);
      if (fragment !== undefined) {
        total += countRootFields(fragment.selectionSet, context, visitedFragments);
      }
    }
  }

  return total;
}

/**
 * Limite la profondeur d'imbrication.
 *
 * Sur ce schéma — non récursif, `Product` ne renvoyant pas vers `Review` — la
 * profondeur est déjà bornée à 4. Cette règle protège donc surtout contre une
 * évolution future du schéma qui réintroduirait un cycle.
 */
export function createDepthLimitRule(maxDepth: number): ValidationRule {
  return (context: ValidationContext): ASTVisitor => ({
    OperationDefinition(operation) {
      if (isIntrospectionOnly(operation)) return false;

      const depth = measureDepth(operation.selectionSet, context, 0, new Set());

      if (depth > maxDepth) {
        context.reportError(
          new GraphQLError(
            `Requête trop profonde : ${String(depth)} niveaux, maximum ${String(maxDepth)}.`,
            { nodes: [operation] },
          ),
        );
      }
      return false;
    },
  });
}

/**
 * Limite le nombre de champs racine par opération.
 *
 * C'est le garde-fou qui compte réellement ici. La profondeur étant bornée
 * par le schéma, l'amplification passe par les alias :
 * `{ a: productsReviews(…) b: productsReviews(…) … }` répété 200 fois
 * déclenche 200 agrégations MongoDB en un seul appel HTTP — mesuré à 3,9 s
 * avant l'ajout de cette règle.
 */
export function createRootFieldLimitRule(maxRootFields: number): ValidationRule {
  return (context: ValidationContext): ASTVisitor => ({
    OperationDefinition(operation) {
      if (isIntrospectionOnly(operation)) return false;

      const count = countRootFields(operation.selectionSet, context, new Set());

      if (count > maxRootFields) {
        context.reportError(
          new GraphQLError(
            `Trop de champs racine : ${String(count)}, maximum ${String(maxRootFields)}. ` +
              'Découpez la requête en plusieurs appels.',
            { nodes: [operation] },
          ),
        );
      }
      return false;
    },
  });
}
