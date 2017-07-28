'use strict';

// var faker = require('faker');
var transcribaConfig = require('../transcriba-config.json');

module.exports = function(server) {
  if (!transcribaConfig.createDummyData) return;
  var InfoPage = server.models.InfoPage;

  var createDummyPages = function(pageNames, callback) {
    if (pageNames.length > 0) {
      var pageName = pageNames.pop();

      InfoPage.findOrCreate({
        where: {
          'name': pageName,
        },
      }, {
        'name': pageName,
        'content': 'Empty page',
      }, function(err, page) {
        if (err) return callback(err);

        return createDummyPages(pageNames, callback);
      });
    } else {
      callback(null);
    }
  };

  // info-page dummies
  var pageNames = transcribaConfig.dummies.pages;
  createDummyPages(pageNames, function(err) {
    if (err) throw err;

    // console.log("dummy pages created");
  });
};
