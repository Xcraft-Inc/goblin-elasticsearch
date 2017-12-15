'use strict';

const path = require ('path');
const es = require ('elasticsearch');
const bob = require ('elastic-builder');
const goblinName = path.basename (module.parent.filename, '.js');

const Goblin = require ('xcraft-core-goblin');

const indexSettings = {
  settings: {
    analysis: {
      filter: {
        autocomplete_filter: {
          type: 'edge_ngram',
          min_gram: 1,
          max_gram: 20,
        },
      },
      analyzer: {
        autocomplete: {
          type: 'custom',
          tokenizer: 'standard',
          filter: ['lowercase', 'autocomplete_filter'],
        },
      },
    },
  },
};
// Define initial logic values
const logicState = {};

// Define logic handlers according rc.json
const logicHandlers = {
  create: state => {
    return state;
  },
};

// Register quest's according rc.json
Goblin.registerQuest (goblinName, 'create', function (quest, url, index) {
  if (!url) {
    throw new Error ('Elasticsearch server URL not provided');
  }
  const client = new es.Client ({
    host: url,
    //log: 'trace',
  });
  quest.goblin.setX ('index', index);
  quest.goblin.setX ('client', client);
});

Goblin.registerQuest (goblinName, 'match', function* (
  quest,
  type,
  value,
  next
) {
  try {
    if (!value) {
      return null;
    }
    const client = quest.goblin.getX ('client');
    const index = quest.goblin.getX ('index');
    const body = bob
      .requestBodySearch ()
      .query (bob.matchQuery ('fullText', value));
    return yield client.search (
      {
        index,
        type,
        body,
      },
      next
    );
  } catch (err) {
    quest.log.err (err);
    throw err;
  }
});

Goblin.registerQuest (goblinName, 'multi-match', function* (
  quest,
  type,
  fields,
  value,
  next
) {
  try {
    if (!value) {
      return null;
    }
    const client = quest.goblin.getX ('client');
    const index = quest.goblin.getX ('index');
    const body = bob
      .requestBodySearch ()
      .query (bob.multiMatchQuery (fields, value));
    return yield client.search (
      {
        index,
        type,
        body,
      },
      next
    );
  } catch (err) {
    quest.log.err (err);
    throw err;
  }
});

Goblin.registerQuest (goblinName, 'index', function* (
  quest,
  type,
  documentId,
  document,
  next
) {
  const client = quest.goblin.getX ('client');
  const index = quest.goblin.getX ('index');
  const indexed = yield client.index (
    {index, type, id: documentId, body: document},
    next
  );
  quest.log.info (indexed);
});

Goblin.registerQuest (goblinName, 'unindex', function* (
  quest,
  type,
  documentId,
  next
) {
  const client = quest.goblin.getX ('client');
  const index = quest.goblin.getX ('index');
  const deleted = yield client.delete ({index, type, id: documentId}, next);
  quest.log.info (deleted);
});

Goblin.registerQuest (goblinName, 'ensure-index', function* (quest, next) {
  const client = quest.goblin.getX ('client');
  const index = quest.goblin.getX ('index');
  const exist = yield client.indices.exists ({index}, next);
  if (!exist) {
    const created = yield client.indices.create (
      {index, body: indexSettings},
      next
    );
    quest.log.info (created);
  }
});

Goblin.registerQuest (goblinName, 'ensure-type', function* (
  quest,
  type,
  fields,
  next
) {
  const client = quest.goblin.getX ('client');
  const index = quest.goblin.getX ('index');
  const exist = yield client.indices.existsType ({index, type}, next);
  if (!exist) {
    const mapType = {type: 'string', analyzer: 'autocomplete'};
    const properties = {};
    for (const field of fields) {
      properties[field] = mapType;
    }
    const mapping = {[type]: {properties}};
    const mapped = yield client.indices.putMapping (
      {index, type, body: mapping},
      next
    );
    quest.log.info (mapped);
  }
});

Goblin.registerQuest (goblinName, 'reset-index', function* (quest, next) {
  const client = quest.goblin.getX ('client');
  const index = quest.goblin.getX ('index');
  const exist = yield client.indices.exists ({index}, next);
  if (exist) {
    const done = yield client.indices.delete ({index}, next);
    quest.log.info (done);
  }
  yield quest.me.ensureIndex ();
});

Goblin.registerQuest (goblinName, 'reset-all-indices', function* (quest, next) {
  const client = quest.goblin.getX ('client');
  const done = yield client.indices.delete ({index: '_all'}, next);
  quest.log.info (done);
});

Goblin.registerQuest (goblinName, 'delete', function (quest) {});

// Create a Goblin with initial state and handlers
module.exports = Goblin.configure (goblinName, logicState, logicHandlers);
