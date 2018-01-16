'use strict';

const transcribaConfig = require('../transcriba-config.json');

module.exports = function(server) {
  if (!transcribaConfig.createDummyData) return; // no dummy data available
  const InfoPage = server.models.InfoPage;

  let createDummyPages = function(pageNames) {
    if (pageNames.length === 0) return Promise.resolve(null);
    const pageName = pageNames.pop();
    return InfoPage.findOrCreate(
      {where: {'name': pageName}}, // try to find this
      {'name': pageName, 'content': 'Empty page'}
    ).then(
      () => createDummyPages(pageNames)
    );
  };

  // info-page dummies
  const pageNames = transcribaConfig.dummies.pages;
  createDummyPages(pageNames);
};
