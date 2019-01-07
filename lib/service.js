'use strict';

const path = require('path');
const es = require('elasticsearch');
const bob = require('elastic-builder');
const goblinName = path.basename(module.parent.filename, '.js');

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
Goblin.registerQuest(goblinName, 'create', function(quest, url, index) {
  quest.do();
  if (!url) {
    throw new Error('Elasticsearch server URL not provided');
  }
  const client = new es.Client({
    host: url,
    //log: 'trace',
  });
  quest.goblin.setX('index', index);
  quest.goblin.setX('client', client);

  quest.goblin.defer(
    quest.sub('*.hard-deleted', function*(err, msg) {
      const document = msg.data.document;
      if (document && document.id && document.meta && document.meta.type) {
        yield quest.me.unindex({
          type: document.meta.type,
          documentId: document.id,
        });
      }
    })
  );
});

Goblin.registerQuest(goblinName, 'search', function*(quest, type, value, next) {
  if (!value) {
    return null;
  }
  const client = quest.goblin.getX('client');
  const index = quest.goblin.getX('index');
  const body = bob
    .requestBodySearch()
    .query(
      bob
        .multiMatchQuery(['searchAutocomplete', 'searchPhonetic'], value)
        .type('most_fields')
        .operator('and')
        .fuzziness('AUTO')
    )
    .highlight(
      bob
        .highlight()
        .numberOfFragments(0)
        .fields(['searchPhonetic', 'searchAutocomplete'])
    );
  const res = yield client.search(
    {
      index,
      type,
      body,
    },
    next
  );
  return res;
});

Goblin.registerQuest(goblinName, 'match', function*(
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

Goblin.registerQuest(goblinName, 'multi-match', function*(
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

Goblin.registerQuest(goblinName, 'index', function*(
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

Goblin.registerQuest(goblinName, 'unindex', function*(
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
    quest.log.warn('not indexed');
  }
});

Goblin.registerQuest(goblinName, 'bulk', function*(quest, body, next) {
  const client = quest.goblin.getX('client');
  const indexed = yield client.bulk({body}, next);
  quest.log.info(indexed);
});

Goblin.registerQuest(goblinName, 'ensure-index', function*(quest, next) {
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

Goblin.registerQuest(goblinName, 'ensure-type', function*(
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

Goblin.registerQuest(goblinName, 'reset-index', function*(quest, next) {
  const client = quest.goblin.getX('client');
  const index = quest.goblin.getX('index');
  const exist = yield client.indices.exists({index}, next);
  if (exist) {
    const done = yield client.indices.delete({index}, next);
    quest.log.info(done);
  }
  yield quest.me.ensureIndex();
});

Goblin.registerQuest(goblinName, 'reset-all-indices', function*(quest, next) {
  const client = quest.goblin.getX('client');
  const done = yield client.indices.delete({index: '_all'}, next);
  quest.log.info(done);
});

Goblin.registerQuest(goblinName, 'delete', function(quest) {});

// Create a Goblin with initial state and handlers
module.exports = Goblin.configure(goblinName, logicState, logicHandlers);
