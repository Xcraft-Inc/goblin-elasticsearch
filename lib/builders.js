'use strict';

const Goblin = require ('xcraft-core-goblin');

const hinterFactory = config => {
  const {name, type, fields, valueField, newWorkitem, newButtonTitle} = config;

  let goblinName = `${type}-hinter`;
  if (name) {
    goblinName = `${name}-hinter`;
  }

  // Define initial logic values
  const logicState = {};

  // Define logic handlers according rc.json
  const logicHandlers = {
    create: (state, action) => {
      const id = action.get ('id');
      return state.set ('', {
        id: id,
      });
    },
  };

  Goblin.registerQuest (goblinName, 'create', function* (
    quest,
    desktopId,
    workitemId
  ) {
    const desk = quest.useAs ('desktop', desktopId);
    const config = yield desk.getConfiguration ();
    // Create a hinter for contacts
    const hinterId = yield desk.createHinterFor ({
      type: name ? name : type,
      workitemId: workitemId,
      detailWidget: name ? `${name}-detail` : `${type}-detail`,
      newWorkitem,
      newButtonTitle,
    });
    quest.goblin.setX ('hinterId', hinterId);
    quest.goblin.setX ('type', type);

    quest.do ({id: quest.goblin.id});
    return quest.goblin.id;
  });

  Goblin.registerQuest (goblinName, 'search', function* (quest, value) {
    const i = quest.openInventory ();
    const elastic = i.use ('elastic');
    const hinterId = quest.goblin.getX ('hinterId');
    const hinter = quest.useAs ('hinter', hinterId);
    const results = yield elastic.multiMatch ({
      type: quest.getX ('type'),
      fields,
      value,
    });
    if (results) {
      const rows = results.hits.hits.map (hit => hit._source.info);
      const values = results.hits.hits.map (hit => {
        const value = valueField ? hit._source[valueField] : hit._id;
        return value;
      });
      const payloads = results.hits.hits.map (hit => hit._source);
      hinter.setSelections ({
        rows: rows,
        values: values,
        payloads: payloads,
        usePayload: false,
      });
    }
  });

  Goblin.registerQuest (goblinName, 'delete', function (quest) {});

  // Create a Goblin with initial state and handlers
  return Goblin.configure (goblinName, logicState, logicHandlers);
};

module.exports = {
  buildHinter: hinterFactory,
};
