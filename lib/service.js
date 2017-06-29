'use strict';

const path = require ('path');
const es = require ('elasticsearch');
const bob = require ('elastic-builder');
const goblinName = path.basename (module.parent.filename, '.js');

const Goblin = require ('xcraft-core-goblin');

// Define initial logic values
const logicState = {};

// Define logic handlers according rc.json
const logicHandlers = {
  create: state => {
    return state;
  },
};

// Register quest's according rc.json
Goblin.registerQuest (goblinName, 'create', function (quest, uri, index, type) {
  const client = new es.Client ({
    host: uri ? uri : 'localhost:9200',
    //log: 'trace',
  });
  quest.goblin.setX ('index', index);
  quest.goblin.setX ('type', type);
  quest.goblin.setX ('client', client);
});

Goblin.registerQuest (goblinName, 'multi-match', function* (
  quest,
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
    const type = quest.goblin.getX ('type');
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

Goblin.registerQuest (goblinName, 'delete', function (quest) {});

// Create a Goblin with initial state and handlers
module.exports = Goblin.configure (goblinName, logicState, logicHandlers);
