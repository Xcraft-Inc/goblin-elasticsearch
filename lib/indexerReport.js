const buildBulkReport = (indexed) => {
  return indexed.items.reduce(
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
};

const buildBulkReportByType = (indexed) => {
  const prepareInfo = (info, type) => {
    if (!info[type]) {
      info[type] = {};
      info[type].created = 0;
      info[type].updated = 0;
      info[type].failed = 0;
      info[type].deleted = 0;
      info[type].errors = {};
    }
    return info[type];
  };
  return indexed.items.reduce((byType, item) => {
    const deleted = item.delete;
    const indexed = item.index;
    if (indexed) {
      const type = indexed._type;
      const info = prepareInfo(byType, type);
      if (indexed.created) {
        info.created++;
      } else if (indexed.result === 'updated') {
        info.updated++;
      } else if (indexed.error) {
        info.failed[type]++;
        const cause = indexed.error.caused_by;
        info.errors[indexed._id] = `${indexed.error.reason}: ${
          cause ? cause.reason : ''
        }`;
      }
    }
    if (deleted) {
      const type = deleted._type;
      const info = prepareInfo(byType, type);
      if (deleted.found) {
        info.deleted++;
      }
    }

    return byType;
  }, {});
};

module.exports = {
  buildBulkReport,
  buildBulkReportByType,
};
