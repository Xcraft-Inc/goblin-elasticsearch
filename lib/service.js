'use strict';

const path = require('path');
const es = require('elasticsearch');
const bob = require('elastic-builder');
const locks = require('xcraft-core-utils/lib/locks');
const {buildBulkReportByType, buildBulkReport} = require('./indexerReport.js');
const goblinName = path.basename(module.parent.filename, '.js');
const {
  converters: {date},
} = require('goblin-workshop');
const DateConverters = date;

const Goblin = require('xcraft-core-goblin');

const indexSettings = {
  settings: {
    analysis: {
      analyzer: {
        autocomplete: {
          tokenizer: 'autocomplete',
          filter: ['asciifolding', 'lowercase'],
        },
        autocomplete_search: {
          tokenizer: 'standard',
          filter: ['asciifolding', 'lowercase'],
        },
        phonetic: {
          tokenizer: 'phonetic',
          filter: ['metaphone'],
        },
        phonetic_search: {
          tokenizer: 'standard',
          filter: ['metaphone'],
        },
      },
      tokenizer: {
        autocomplete: {
          type: 'ngram',
          min_gram: 1,
          max_gram: 20,
          token_chars: ['letter', 'digit'],
        },
        phonetic: {
          type: 'edge_ngram',
          min_gram: 2,
          max_gram: 20,
          token_chars: ['letter', 'digit'],
        },
      },
      filter: {
        metaphone: {
          type: 'phonetic',
          encoder: 'beidermorse',
          languageset: ['any'],
          replace: false,
        },
      },
    },
  },
};
// Define initial logic values
const logicState = {};

// Define logic handlers according rc.json
const logicHandlers = {
  create: (state, action) => {
    return state.set('id', action.get('id'));
  },
};

// Register quest's according rc.json
Goblin.registerQuest(goblinName, 'create', function (quest, url, index) {
  quest.do();
  if (!url) {
    throw new Error('Elasticsearch server URL not provided');
  }
  const client = new es.Client({
    host: url,
    requestTimeout: 600000,
    //log: 'trace',
  });
  quest.goblin.setX('index', index);
  quest.goblin.setX('client', client);

  return quest.goblin.id;
});

Goblin.registerQuest(goblinName, 'search', function* (
  quest,
  type,
  value,
  filters,
  sort,
  from,
  searchAfter,
  size,
  mustExist,
  fuzzy,
  source,
  scroll,
  termQueryFields,
  dateQueryFields,
  highlightedFields,
  next
) {
  const client = quest.goblin.getX('client');
  const index = quest.goblin.getX('index');
  const fullTextFields = ['searchPhonetic', 'searchAutocomplete'];
  let body = bob.requestBodySearch();

  if (!termQueryFields) {
    termQueryFields = [];
  }

  if (!dateQueryFields) {
    dateQueryFields = [];
  }

  if (!highlightedFields) {
    highlightedFields = fullTextFields;
  }

  body = body
    .highlight(bob.highlight().numberOfFragments(0).fields(highlightedFields))
    .from(from || 0)
    .size(size || 10);

  let fuzzValue = 'AUTO';
  if (fuzzy !== undefined) {
    fuzzValue = fuzzy;
  }

  let queries = null;
  if (filters) {
    queries = filters.reduce((queries, filter) => {
      if (!Array.isArray(filter.value)) {
        queries.push(
          bob
            .boolQuery()
            .must(
              bob
                .rangeQuery(filter.name)
                .gte(filter.value.from)
                .lte(filter.value.to)
            )
        );
      } else {
        queries.push(
          bob.boolQuery().mustNot(bob.termsQuery(filter.name, filter.value))
        );
      }

      return queries;
    }, []);
  }

  if (value && value.length > 0) {
    let boolQuery = bob.boolQuery();

    //try to always work on array
    if (!Array.isArray(value)) {
      value = [value];
    }

    value.forEach((v) => {
      const shouldQuery = [];

      //use wildcard query when needed
      let termQ = bob.termsQuery;
      if (v.indexOf('*') > -1) {
        termQ = bob.wildcardQuery;
      }

      //should search in fulltext in dedicated field
      shouldQuery.push(
        bob
          .multiMatchQuery(fullTextFields, v)
          .type('most_fields')
          .operator('and')
          .fuzziness(fuzzValue)
      );

      //should match keyword terms
      termQueryFields.forEach((field) => shouldQuery.push(termQ(field, v)));

      //should match date terms
      const tryDate = DateConverters.parseEdited(v);
      if (!tryDate.error) {
        dateQueryFields.forEach((field) =>
          shouldQuery.push(bob.termsQuery(field, tryDate.value))
        );
      }

      //by default each value is in AND mode
      boolQuery = boolQuery.must(bob.boolQuery().should(shouldQuery));
    });

    body = body.query(boolQuery);

    if (filters) {
      body = body.postFilter(bob.boolQuery().must(queries));
    }
  } else if (filters) {
    body = body.query(bob.boolQuery().must(queries));
    if (sort) {
      body = body.sort(bob.sort(sort.key, sort.dir).unmappedType('string'));
    }
  } else if (mustExist && sort) {
    body = body.query(bob.existsQuery(sort.key));
    body = body.sort(bob.sort(sort.key, sort.dir).unmappedType('string'));
  }

  if (source) {
    body = body.source(source);
  }

  if (searchAfter) {
    body = body.searchAfter(searchAfter);
  }

  const res = yield client.search(
    {
      index,
      type,
      body,
      scroll,
    },
    next
  );
  return res;
});

Goblin.registerQuest(goblinName, 'generate-facets', function* (
  quest,
  type,
  facets,
  next
) {
  const client = quest.goblin.getX('client');
  const index = quest.goblin.getX('index');
  let body = bob.requestBodySearch();

  for (const facet of facets) {
    switch (facet.type) {
      default:
      case 'keyword':
        body = body.agg(
          bob
            .termsAggregation(facet.name, facet.field)
            .size(1000)
            .order('_term', 'asc')
        );
        break;
      case 'date':
        body = body.agg(
          bob
            .termsAggregation(facet.name, facet.field)
            .size(1000)
            .order('_term', 'asc')
        );
        body = body.agg(bob.minAggregation(`${facet.name}_min`, facet.field));
        body = body.agg(bob.maxAggregation(`${facet.name}_max`, facet.field));

        break;
    }
  }
  body = body.size(0);

  const res = yield client.search(
    {
      index,
      type,
      body,
    },
    next
  );
  return res.aggregations;
});

Goblin.registerQuest(goblinName, 'scroll', function* (quest, scrollId, next) {
  const client = quest.goblin.getX('client');
  return yield client.scroll({scrollId, scroll: '1m'}, next);
});

Goblin.registerQuest(goblinName, 'clear-scroll', function* (
  quest,
  scrollId,
  next
) {
  const client = quest.goblin.getX('client');
  yield client.clearScroll({scrollId}, next);
});

Goblin.registerQuest(goblinName, 'count', function* (quest, type, next) {
  const client = quest.goblin.getX('client');
  const index = quest.goblin.getX('index');
  const res = yield client.count({index, type}, next);
  return res.count;
});

Goblin.registerQuest(goblinName, 'match', function* (
  quest,
  type,
  field,
  value,
  next
) {
  if (!value) {
    return null;
  }
  const client = quest.goblin.getX('client');
  const index = quest.goblin.getX('index');
  const body = bob
    .requestBodySearch()
    .query(bob.matchQuery(field, value).operator('and'));
  return yield client.search(
    {
      index,
      type,
      body,
    },
    next
  );
});

Goblin.registerQuest(goblinName, 'multi-match', function* (
  quest,
  type,
  fields,
  value,
  next
) {
  if (!value) {
    return null;
  }
  const client = quest.goblin.getX('client');
  const index = quest.goblin.getX('index');
  const body = bob
    .requestBodySearch()
    .query(bob.multiMatchQuery(fields, value).operator('and'));
  return yield client.search(
    {
      index,
      type,
      body,
    },
    next
  );
});

Goblin.registerQuest(goblinName, 'index', function* (
  quest,
  type,
  documentId,
  document,
  next
) {
  const client = quest.goblin.getX('client');
  const index = quest.goblin.getX('index');
  const indexed = yield client.index(
    {index, type, id: documentId, body: document},
    next
  );
  quest.log.info(indexed);
});

Goblin.registerQuest(goblinName, 'unindex', function* (
  quest,
  type,
  documentId,
  next
) {
  const client = quest.goblin.getX('client');
  const index = quest.goblin.getX('index');
  try {
    yield client.delete({index, type, id: documentId}, next);
  } catch (e) {
    quest.log.warn(`${documentId} is not indexed`);
  }
});

//Limit bulk quest to 50 concurrent call
//Avoid exploding elasticsearch worker queue
const sem = new locks.Semaphore(50);
Goblin.registerQuest(goblinName, 'bulk', function* (
  quest,
  body,
  withInfo,
  next
) {
  yield sem.wait();
  let indexed;
  try {
    const client = quest.goblin.getX('client');
    indexed = yield client.bulk({body, refresh: 'true'}, next);
  } finally {
    sem.signal();
  }
  if (withInfo) {
    const report = indexed.items.reduce(
      (info, item) => {
        const deleted = item.delete;
        const indexed = item.index;
        if (indexed) {
          if (indexed.created) {
            info.created++;
          } else if (indexed.result === 'updated') {
            info.updated++;
          } else if (indexed.error) {
            info.failed++;
            const cause = indexed.error.caused_by;
            info.errors[indexed._id] = `${indexed.error.reason}: ${
              cause ? cause.reason : ''
            }`;
          }
        }
        if (deleted) {
          if (deleted.found) {
            info.deleted++;
          }
        }

        return info;
      },
      {
        created: 0,
        deleted: 0,
        updated: 0,
        failed: 0,
        errors: {},
        total: indexed.items.length,
      }
    );

    return report;
  } else {
    return null;
  }
});

Goblin.registerQuest(goblinName, 'ensure-index', function* (quest, next) {
  const client = quest.goblin.getX('client');
  const index = quest.goblin.getX('index');
  const exist = yield client.indices.exists({index}, next);
  if (!exist) {
    const created = yield client.indices.create(
      {index, body: indexSettings},
      next
    );
    quest.log.info(created);
  }
});

Goblin.registerQuest(goblinName, 'ensure-type', function* (
  quest,
  type,
  fields,
  next
) {
  const client = quest.goblin.getX('client');
  const index = quest.goblin.getX('index');
  const exist = yield client.indices.existsType({index, type}, next);
  if (!exist) {
    const properties = {
      searchAutocomplete: {
        type: 'text',
        analyzer: 'autocomplete',
        search_analyzer: 'autocomplete_search',
      },
      searchPhonetic: {
        type: 'text',
        analyzer: 'phonetic',
        search_analyzer: 'phonetic_search',
      },
    };
    const mapping = {[type]: {properties}};
    const mapped = yield client.indices.putMapping(
      {index, type, body: mapping},
      next
    );
    quest.log.info(mapped);
  }
});

Goblin.registerQuest(goblinName, 'put-mapping', function* (
  quest,
  type,
  properties,
  next
) {
  const client = quest.goblin.getX('client');
  const index = quest.goblin.getX('index');
  const mapping = {[type]: {properties}};
  const mapped = yield client.indices.putMapping(
    {index, type, body: mapping},
    next
  );
  quest.log.info(mapped);
});

Goblin.registerQuest(goblinName, 'reset-index', function* (quest, next) {
  const client = quest.goblin.getX('client');
  const index = quest.goblin.getX('index');
  const exist = yield client.indices.exists({index}, next);
  if (exist) {
    const done = yield client.indices.delete({index}, next);
    quest.log.info(done);
  }
  yield quest.me.ensureIndex();
});

Goblin.registerQuest(goblinName, 'reset-all-indices', function* (quest, next) {
  const client = quest.goblin.getX('client');
  const done = yield client.indices.delete({index: '_all'}, next);
  quest.log.info(done);
});

Goblin.registerQuest(goblinName, 'delete', function (quest) {});

// Create a Goblin with initial state and handlers
module.exports = Goblin.configure(goblinName, logicState, logicHandlers);
