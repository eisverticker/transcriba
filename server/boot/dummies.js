'use strict';

var faker = require('faker');
var config = require('../config.json');

module.exports = function(server){
  if(!config.custom.createDummyData) return;
  var InfoPage = server.models.InfoPage;

  var createDummyPages = function(pageNames, callback){
    if(pageNames.length > 0){
      var pageName = pageNames.pop();

      InfoPage.findOrCreate({
        where: {
          "name": pageName
        }
      }, {
        "name": pageName,
        "content": "Empty page"
      }, function(err, page){
        if(err) return callback(err);

        return createDummyPages(pageNames, callback);
      });
    }else{
      callback(null);
    }
  };

  //info-page dummies
  var pageNames = config.custom.dummies.pages;
  createDummyPages(pageNames, function(err){
    if(err) throw err;

    //console.log("dummy pages created");
  });


}
