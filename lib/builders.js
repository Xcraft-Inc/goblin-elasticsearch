'use strict';

const Goblin = require('xcraft-core-goblin');

const types = [];

function hinterFactory(config) {
  const {
    name,
    type,
    subTypes,
    subJoins,
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
  types.push(type);

  // Define initial logic values
  const logicState = {};

  // Define logic handlers according rc.json
  const logicHandlers = {
    create: (state, action) => {
      const id = action.get('id');
      return state.set('', {
        id: id,
      });
    },
  };

  Goblin.registerQuest(goblinName, 'create', function*(
    quest,
    desktopId,
    hinterName,
    workitemId,
    withDetails,
    detailWidget,
    detailWidth,
    detailKind,
    statusFilter
  ) {
    if (!desktopId) {
      throw new Error(
        'ElasticSearch Hinter must be created for a desktop, missing desktopId'
      );
    }
    if (!hinterName) {
      throw new Error('hinter name not provided');
    }

    const workshopAPI = quest.getAPI('workshop');
    const hinterId = yield workshopAPI.createHinterFor({
      desktopId,
      name: hinterName,
      type: type,
      workitemId: workitemId,
      detailWidget: detailWidget ? detailWidget : `${type}-workitem`,
      newWorkitem,
      title,
      newButtonTitle,
      withDetails,
      detailKind,
      detailWidth,
    });
    if (statusFilter) {
      const hinterAPI = quest.getAPI(hinterId);
      yield hinterAPI.setFilters({filters: statusFilter});
    }
    quest.goblin.setX('hinterId', hinterId);
    quest.goblin.setX('type', type);
    quest.goblin.setX('subTypes', subTypes);
    quest.goblin.setX('subJoins', subJoins);
    quest.goblin.setX('desktopId', desktopId);

    quest.do({id: quest.goblin.id});
    return quest.goblin.id;
  });

  Goblin.registerQuest(goblinName, 'set-status', function*(quest, status) {
    const hinterAPI = quest.getAPI(quest.goblin.getX('hinterId'));
    yield hinterAPI.setFilters({filters: status});
  });

  Goblin.registerQuest(goblinName, 'search', function*(quest, value) {
    const mandate = quest.getSession();
    const currentLocale = quest.goblin.getX('currentLocale');
    const currentLocaleName = currentLocale
      ? currentLocale
          .get('name')
          .toLowerCase()
          .replace(/\//g, '-')
      : null;

    let elastic = quest.getStorage('elastic');
    if (currentLocaleName) {
      elastic = quest.getStorage('elastic', `${mandate}-${currentLocaleName}`);
    }
    const hinterId = quest.goblin.getX('hinterId');
    const hinter = quest.getAPI(hinterId, 'hinter');

    let type = quest.goblin.getX('type');
    const subTypes = quest.goblin.getX('subTypes');
    if (subTypes) {
      subTypes.forEach(subType => {
        type = `${type},${subType}`;
      });
    }

    const results = yield elastic.search({
      type,
      value,
      size: 20,
    });

    if (results) {
      const rows = results.hits.hits.map(hit => {
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
          const countPhonetic = (
            hit.highlight.searchPhonetic[0].match(/<em>/g) || []
          ).length;
          const countAutocomplete = (
            hit.highlight.searchAutocomplete[0].match(/<em>/g) || []
          ).length;
          if (countAutocomplete > countPhonetic) {
            phonetic = false;
          }
        }

        return phonetic
          ? hit.highlight.searchPhonetic[0].replace(/<\/?em>/g, '`')
          : hit.highlight.searchAutocomplete[0].replace(/<\/?em>/g, '`');
      });
      const glyphs = results.hits.hits.map(hit => hit._source.glyph);
      const status = results.hits.hits.map(hit => hit._source['meta/status']);

      const subJoins = quest.goblin.getX('subJoins');
      const values = results.hits.hits.map(hit => {
        let value = valueField ? hit._source[valueField] : hit._id;
        if (subJoins) {
          subJoins.forEach(subJoin => {
            const join = hit._source[subJoin];
            if (join) {
              value = join;
            }
          });
        }
        return value;
      });
      const payloads = results.hits.hits.map(hit => hit._source);
      hinter.setSelections({
        rows: rows,
        glyphs: glyphs,
        values: values,
        status: status,
        payloads: payloads,
        usePayload: false,
      });
    } else {
      hinter.setSelections({
        rows: [],
        glyphs: [],
        status: [],
        values: [],
        payloads: [],
        usePayload: false,
      });
    }
  });

  Goblin.registerQuest(goblinName, 'delete', function(quest) {});

  // Create a Goblin with initial state and handlers
  return Goblin.configure(goblinName, logicState, logicHandlers);
}

hinterFactory.entities = types;

module.exports = {
  buildHinter: hinterFactory,
};
