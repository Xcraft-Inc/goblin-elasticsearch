# 📘 Documentation du module goblin-elasticsearch

## Aperçu

Le module `goblin-elasticsearch` est un service d'indexation et de recherche basé sur Elasticsearch pour l'écosystème Xcraft. Il fournit une interface complète pour indexer, rechercher et gérer des documents dans Elasticsearch, avec des fonctionnalités avancées comme la recherche phonétique, l'autocomplétion et la recherche floue. Le module inclut également un système de "hinters" pour créer des interfaces de recherche interactives dans les applications Xcraft.

## Sommaire

- [Structure du module](#structure-du-module)
- [Fonctionnement global](#fonctionnement-global)
- [Exemples d'utilisation](#exemples-dutilisation)
- [Interactions avec d'autres modules](#interactions-avec-dautres-modules)
- [Configuration avancée](#configuration-avancée)
- [Détails des sources](#détails-des-sources)

## Structure du module

Le module est organisé autour de trois composants principaux :

- **Service Elasticsearch** (`lib/service.js`) : Acteur Goblin principal qui gère la connexion et les opérations Elasticsearch
- **Builders** (`lib/builders.js`) : Factory pour créer des "hinters" (composants de recherche interactive)
- **Indexer Report** (`lib/indexerReport.js`) : Utilitaires pour générer des rapports d'indexation
- **Point d'entrée** (`elastic.js`) : Expose les commandes du service sur le bus Xcraft

## Fonctionnement global

Le module fonctionne selon une architecture en couches :

1. **Couche de connexion** : Établit et maintient la connexion avec le cluster Elasticsearch
2. **Couche d'indexation** : Gère la création d'index, le mapping des types et l'indexation des documents
3. **Couche de recherche** : Fournit des capacités de recherche avancées (fulltext, phonétique, autocomplétion)
4. **Couche d'interface** : Génère des composants "hinter" pour l'intégration dans les interfaces utilisateur

Le service utilise des analyseurs personnalisés pour optimiser la recherche :

- **Autocomplete** : Recherche par préfixe avec n-grammes (1-20 caractères)
- **Phonetic** : Recherche phonétique avec l'algorithme Beider-Morse
- **Info** : Recherche standard avec normalisation ASCII et filtres de mots vides configurables

Le système de verrouillage limite les opérations bulk à 50 appels simultanés pour éviter de surcharger Elasticsearch.

## Exemples d'utilisation

### Création et utilisation du service Elasticsearch

```javascript
// Création du service
const elasticAPI = await this.quest.create('elastic', {
  id: 'elastic@mandate',
  url: 'http://localhost:9200',
  index: 'my-application-index',
});

// Recherche de documents avec mode fulltext
const results = await elasticAPI.search({
  type: 'person',
  value: 'john doe',
  searchMode: 'fulltext',
  size: 20,
});

// Recherche avec mode mixte (fulltext + termes exacts)
const mixedResults = await elasticAPI.search({
  type: 'person',
  value: ['john', 'doe'],
  searchMode: 'mixed',
  termQueryFields: ['status', 'category'],
  dateQueryFields: ['birthDate'],
});
```

### Indexation de documents

```javascript
// Indexation d'un document unique
await elasticAPI.index({
  type: 'person',
  documentId: 'person-123',
  document: {
    'info': 'John Doe',
    'searchAutocomplete': 'John Doe',
    'searchPhonetic': 'John Doe',
    'meta/status': 'active',
    'glyph': 'solid/user',
  },
});

// Indexation en lot avec rapport détaillé
const bulkBody = [
  {index: {_type: 'person', _id: 'person-123'}},
  {
    info: 'John Doe',
    searchAutocomplete: 'John Doe',
    searchPhonetic: 'John Doe',
  },
  {index: {_type: 'person', _id: 'person-124'}},
  {
    info: 'Jane Smith',
    searchAutocomplete: 'Jane Smith',
    searchPhonetic: 'Jane Smith',
  },
];

const report = await elasticAPI.bulk({
  body: bulkBody,
  withInfo: true,
  byType: true,
});
```

### Création d'un hinter pour l'interface utilisateur

```javascript
const {buildHinter} = require('goblin-elasticsearch/lib/builders.js');

// Configuration du hinter
const PersonHinter = buildHinter({
  name: 'person-search',
  type: 'person',
  detailType: 'person',
  valueField: 'id',
  title: 'Recherche de personnes',
  newButtonTitle: 'Nouvelle personne',
  subTypes: ['employee', 'customer'],
  subJoins: ['parentId'],
});

// Utilisation dans un acteur
const hinterAPI = await this.quest.create('person-hinter', {
  id: `person-hinter@${this.quest.uuidV4()}$`,
  desktopId,
  hinterName: 'main-search',
  withDetails: true,
  detailWidget: 'person-workitem',
  statusFilter: [{name: 'status', value: ['archived']}],
});
```

### Gestion des facettes et agrégations

```javascript
// Génération de facettes pour les filtres
const facets = await elasticAPI.generateFacets({
  type: 'person',
  facets: [
    {name: 'status', field: 'meta/status', type: 'keyword'},
    {name: 'birthDate', field: 'birthDate', type: 'date'},
  ],
});

// Recherche avec filtres basés sur les facettes
const filteredResults = await elasticAPI.search({
  type: 'person',
  value: 'john',
  filters: [
    {name: 'meta/status', value: ['active', 'pending']},
    {name: 'birthDate', value: {from: '1980-01-01', to: '1990-12-31'}},
  ],
});
```

## Interactions avec d'autres modules

Le module interagit étroitement avec :

- **[goblin-workshop]** : Utilise les composants hinter pour l'interface de recherche et la gestion des workitems
- **[xcraft-core-etc]** : Pour la gestion de la configuration (stopwords, multi-langue)
- **[xcraft-core-goblin]** : Framework de base pour les acteurs Goblin
- **[xcraft-core-converters]** : Pour la conversion des dates dans les recherches mixtes
- **[xcraft-core-utils]** : Utilise le système de verrous pour limiter la concurrence des opérations bulk

## Configuration avancée

| Option      | Description                           | Type  | Valeur par défaut      |
| ----------- | ------------------------------------- | ----- | ---------------------- |
| `stopwords` | Liste des langues pour les mots vides | Array | `['french', 'german']` |

### Variables d'environnement

Le module ne définit pas de variables d'environnement spécifiques mais utilise la configuration du workshop pour le support multi-langue via `workshopConfig.enableMultiLanguageIndex`.

## Détails des sources

### `elastic.js`

Point d'entrée principal du module qui expose les commandes Elasticsearch sur le bus Xcraft. Ce fichier simple redirige vers le service principal défini dans `lib/service.js`.

### `lib/service.js`

Service principal qui expose toutes les commandes Elasticsearch via le bus Xcraft. Il gère :

- **Connexion** : Établit la connexion avec le cluster Elasticsearch avec vérification de santé (timeout 30s)
- **Gestion d'index** : Création, suppression et configuration des index avec analyseurs personnalisés
- **Recherche avancée** : Support de multiple modes de recherche (fulltext, mixed) avec highlighting et pagination
- **Indexation** : Opérations d'indexation unitaires et en lot avec rapports détaillés
- **Facettes** : Génération d'agrégations pour les filtres d'interface
- **Scroll API** : Support de la pagination avancée pour de gros volumes de données

#### Méthodes publiques

- **`create(url, index)`** — Initialise le service avec l'URL Elasticsearch et le nom d'index, vérifie la disponibilité du cluster
- **`search(type, value, filters, sort, from, searchAfter, size, mustExist, fuzzy, source, scroll, termQueryFields, dateQueryFields, highlightedFields, searchMode, fullTextFields)`** — Effectue une recherche avec support complet de filtres, tri, pagination et highlighting
- **`index(type, documentId, document)`** — Indexe un document unique avec logging du résultat
- **`unindex(type, documentId)`** — Supprime un document de l'index avec gestion des erreurs
- **`bulk(body, withInfo, byType)`** — Indexe plusieurs documents en une opération avec rapport optionnel et limitation de concurrence (50 appels max)
- **`count(type)`** — Retourne le nombre de documents d'un type donné
- **`match(type, field, value)`** — Recherche exacte sur un champ spécifique avec opérateur AND
- **`multi-match(type, fields, value)`** — Recherche sur plusieurs champs simultanément
- **`scroll(scrollId)`** — Continue une recherche paginée avec l'API scroll
- **`clear-scroll(scrollId)`** — Libère les ressources d'une recherche scroll
- **`ensure-index()`** — Crée l'index s'il n'existe pas avec la configuration d'analyseurs et filtres de stopwords
- **`ensure-type(type, fields)`** — Crée le mapping d'un type avec les champs de recherche standard (searchAutocomplete, searchPhonetic, info)
- **`put-mapping(type, properties)`** — Met à jour le mapping d'un type existant
- **`reset-index()`** — Supprime et recrée l'index complètement
- **`delete-index()`** — Supprime définitivement l'index
- **`reset-all-indices()`** — Supprime tous les index Elasticsearch (opération dangereuse)
- **`generate-facets(type, facets)`** — Génère des agrégations pour les facettes d'interface avec support des types keyword et date

### `lib/builders.js`

Factory pour créer des acteurs "hinter" qui fournissent des interfaces de recherche interactives. Chaque hinter :

- Se connecte automatiquement au service workshop pour l'affichage
- Effectue des recherches en temps réel via Elasticsearch avec auto-fetch initial
- Gère le highlighting des résultats avec préférence phonétique intelligente
- Support des sous-types et jointures pour des recherches complexes
- Gestion des filtres de statut et des payloads personnalisés

#### Configuration du hinter

La factory accepte une configuration complète avec :

- `name` : Nom personnalisé du hinter (optionnel, utilise `${type}-hinter` par défaut)
- `type` : Type de document principal à rechercher
- `detailType` : Type pour l'affichage des détails (optionnel)
- `detailPath` et `detailResolvePath` : Chemins pour la résolution des détails
- `subTypes` : Types additionnels à inclure dans la recherche
- `subJoins` : Champs de jointure pour les sous-types
- `valueField` : Champ à utiliser comme valeur de retour
- `newWorkitem` : Configuration pour créer de nouveaux éléments
- `title` et `newButtonTitle` : Titres pour l'interface

#### Méthodes des hinters générés

- **`create(desktopId, hinterName, workitemId, withDetails, detailWidget, detailWidth, detailKind, statusFilter)`** — Crée une instance de hinter avec configuration complète
- **`search(value, searchMode, size)`** — Effectue une recherche avec highlighting intelligent et gestion des résultats phonétiques/autocomplétion
- **`set-status(status)`** — Applique des filtres de statut dynamiquement

### `lib/indexerReport.js`

Utilitaires pour analyser les résultats d'opérations d'indexation en lot et générer des rapports détaillés avec gestion des erreurs.

#### Fonctions utilitaires

- **`buildBulkReport(indexed)`** — Génère un rapport global avec compteurs de documents créés, mis à jour, supprimés, échoués et détails des erreurs
- **`buildBulkReportByType(indexed)`** — Génère un rapport détaillé par type de document avec la même granularité

Les rapports incluent la structure :

```javascript
{
  created: number,
  updated: number,
  deleted: number,
  failed: number,
  total: number,
  errors: {[documentId]: string}
}
```

---

_Documentation mise à jour_

[goblin-workshop]: https://github.com/Xcraft-Inc/goblin-workshop
[xcraft-core-etc]: https://github.com/Xcraft-Inc/xcraft-core-etc
[xcraft-core-goblin]: https://github.com/Xcraft-Inc/xcraft-core-goblin
[xcraft-core-converters]: https://github.com/Xcraft-Inc/xcraft-core-converters
[xcraft-core-utils]: https://github.com/Xcraft-Inc/xcraft-core-utils