/**
 * Schéma GraphQL du service Avis & Recommandations.
 *
 * Les identifiants `userId` et `productId` sont des chaînes opaques : ce
 * service ne connaît ni la table des clients, ni celle des produits. Le
 * découplage entre microservices est volontaire — aucune jointure inter-base.
 */
export const typeDefs = /* GraphQL */ `
  scalar DateTime
  scalar JSON

  "Avis déposé par un client sur un produit."
  type Review {
    id: ID!
    userId: String!
    productId: String!
    "Note entière comprise entre 1 et 5."
    rating: Int!
    comment: String!
    tags: [String!]!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  "Page d'avis. Pagination par décalage, volontairement simple."
  type ReviewPage {
    items: [Review!]!
    total: Int!
    limit: Int!
    offset: Int!
    hasMore: Boolean!
  }

  "Répartition des notes d'un produit."
  type RatingDistribution {
    one: Int!
    two: Int!
    three: Int!
    four: Int!
    five: Int!
  }

  type TagCount {
    tag: String!
    count: Int!
  }

  "Note agrégée d'un produit. average vaut 0 si le produit n'a aucun avis."
  type ProductRating {
    productId: String!
    average: Float!
    count: Int!
    distribution: RatingDistribution!
    topTags: [TagCount!]!
  }

  enum BrowsingEventType {
    VIEW
    SEARCH
    ADD_TO_CART
    PURCHASE
  }

  "Événement de navigation — alimente les recommandations."
  type BrowsingEvent {
    id: ID!
    userId: String!
    productId: String!
    category: String!
    eventType: BrowsingEventType!
    """
    Données libres attachées à l'événement, sans schéma imposé : terme de
    recherche pour un SEARCH, quantité pour un PURCHASE… C'est la souplesse
    du NoSQL, exploitable sans migration.
    """
    metadata: JSON
    createdAt: DateTime!
  }

  "Signal ayant le plus contribué au score d'une recommandation."
  enum RecommendationReason {
    "Produit bien noté par l'ensemble des clients."
    HIGHLY_RATED
    "Produit d'une catégorie que le client consulte souvent."
    CATEGORY_AFFINITY
    "Produit consulté par des clients aux parcours semblables."
    SIMILAR_PRODUCT
    "Produit populaire, faute de signal personnel."
    TRENDING
  }

  """
  Recommandation personnalisée.

  Le score est déterministe : les mêmes données produisent toujours le même
  classement. \`explanation\` donne la raison en clair, en français.
  """
  type Recommendation {
    productId: String!
    "Score entre 0 et 1, arrondi au millième."
    score: Float!
    reason: RecommendationReason!
    explanation: String!
    averageRating: Float
    reviewCount: Int!
    category: String
  }

  type HealthStatus {
    status: String!
    service: String!
    environment: String!
    database: String!
    timestamp: String!
  }

  enum ReviewSort {
    NEWEST
    OLDEST
    HIGHEST_RATING
    LOWEST_RATING
  }

  type Query {
    "Avis d'un produit."
    productsReviews(
      productId: String!
      limit: Int = 20
      offset: Int = 0
      sort: ReviewSort = NEWEST
      minRating: Int
      tags: [String!]
    ): ReviewPage!

    "Historique des avis d'un client."
    userReviews(
      userId: String!
      limit: Int = 20
      offset: Int = 0
      sort: ReviewSort = NEWEST
      minRating: Int
      tags: [String!]
    ): ReviewPage!

    "Recommandations personnalisées, déterministes et explicables."
    recommendations(userId: String!, limit: Int = 10): [Recommendation!]!

    "Un avis par son identifiant."
    review(id: ID!): Review

    "Note agrégée d'un produit."
    productRating(productId: String!): ProductRating!

    "Notes agrégées de plusieurs produits, en un seul appel."
    productRatings(productIds: [String!]!): [ProductRating!]!

    "Historique de navigation d'un client."
    browsingHistory(userId: String!, limit: Int = 50): [BrowsingEvent!]!

    "Sonde de santé du service."
    health: HealthStatus!
  }

  input CreateReviewInput {
    userId: String!
    productId: String!
    rating: Int!
    comment: String!
    tags: [String!] = []
  }

  "Mise à jour partielle : au moins un champ doit être fourni."
  input UpdateReviewInput {
    rating: Int
    comment: String
    tags: [String!]
  }

  input TrackBrowsingEventInput {
    userId: String!
    productId: String!
    category: String!
    eventType: BrowsingEventType = VIEW
    "Données libres, sans schéma imposé."
    metadata: JSON
  }

  type DeleteReviewPayload {
    id: ID!
    deleted: Boolean!
  }

  type Mutation {
    createReview(input: CreateReviewInput!): Review!
    updateReview(id: ID!, input: UpdateReviewInput!): Review!
    deleteReview(id: ID!): DeleteReviewPayload!
    "Enregistre une consultation — alimente les recommandations."
    trackBrowsingEvent(input: TrackBrowsingEventInput!): BrowsingEvent!
  }
`;
