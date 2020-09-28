'use strict';

/**
 * Retrieve the inquirer definition for xcraft-core-etc
 */
module.exports = [
  {
    type: 'checkbox',
    name: 'stopwords',
    message: 'list of languages to use for the stop words',
    default: ['french', 'german'],
  },
];
