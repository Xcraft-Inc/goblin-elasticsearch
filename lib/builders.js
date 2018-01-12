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
      name: name ? name : null,
      type: type,
      workitemId: workitemId,
      detailWidget: `${type}-workitem`,
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
    const results = yield elastic.search ({
      type: quest.goblin.getX ('type'),
      value,
    });
    if (results) {
      const rows = results.hits.hits.map (hit => {
        if (!hit.highlight) {
          return hit._source.info;
        }

        let phonetic = false;
        let autocomplete = false;

        if (hit.highlight.searchPhonetic) {
          phonetic = true;
        }
        if (hit.highlight.searchAutocomplete) {
          autocomplete = true;
        }

        if (!phonetic && !autocomplete) {
          return hit._source.info;
        }

        // Prefer phonetic result if possible, but use autocomplete result
        // if there are more tags.
        if (phonetic && autocomplete) {
          const countPhonetic = (hit.highlight.searchPhonetic[0].match (
            /<em>/g
          ) || []).length;
          const countAutocomplete = (hit.highlight.searchAutocomplete[0].match (
            /<em>/g
          ) || []).length;
          if (countAutocomplete > countPhonetic) {
            phonetic = false;
          }
        }

        return phonetic
          ? hit.highlight.searchPhonetic[0].replace (/<\/?em>/g, '`')
          : hit.highlight.searchAutocomplete[0].replace (/<\/?em>/g, '`');
      });
      const glyphs = results.hits.hits.map (hit => hit._source.glyph);
      const values = results.hits.hits.map (hit => {
        const value = valueField ? hit._source[valueField] : hit._id;
        return value;
      });
      const payloads = results.hits.hits.map (hit => hit._source);
      hinter.setSelections ({
        rows: rows,
        glyphs: glyphs,
        values: values,
        payloads: payloads,
        usePayload: false,
      });
    } else {
      hinter.setSelections ({
        rows: [],
        glyphs: [],
        values: [],
        payloads: [],
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
