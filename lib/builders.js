'use strict';

const Goblin = require ('xcraft-core-goblin');

const hinterFactory = config => {
  const {
    name,
    type,
    fields,
    valueField,
    newWorkitem,
    title,
    newButtonTitle,
  } = config;

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
    if (!desktopId) {
      throw new Error (
        'ElasticSearch Hinter must be created for a desktop, missing desktopId param ?'
      );
    }
    const desk = quest.getGoblinAPI ('desktop', desktopId);
    const hinterId = yield desk.createHinterFor ({
      type: name ? name : type,
      workitemId: workitemId,
      detailWidget: name ? `${name}-workitem` : `${type}-workitem`,
      newWorkitem,
      title,
      newButtonTitle,
    });
    quest.goblin.setX ('hinterId', hinterId);
    quest.goblin.setX ('type', type);
    quest.goblin.setX ('desktopId', desktopId);

    quest.do ({id: quest.goblin.id});
    return quest.goblin.id;
  });

  Goblin.registerQuest (goblinName, 'search', function* (quest, value) {
    const i = quest.openInventory ();
    const desktopId = quest.goblin.getX ('desktopId');
    const elastic = i.getAPI (`elastic@${desktopId}`);
    const hinterId = quest.goblin.getX ('hinterId');
    const hinter = quest.getGoblinAPI ('hinter', hinterId);
    const results = yield elastic.multiMatch ({
      type: quest.goblin.getX ('type'),
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
