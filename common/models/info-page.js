var toMarkdown = require('marked');

module.exports = function(InfoPage) {

  InfoPage.validatesUniquenessOf('name');

  InfoPage.findByName = function(name, callback){
    console.log("name",name);
    InfoPage.findOne({
      where: {
        "name": name
      }
    }, function(err, page){
      if(err) callback(err);

      page.content = toMarkdown(page.content);
      callback(null, { "page":page });
    });
  };

  InfoPage.remoteMethod(
      'findByName',
      {
        description: 'Find InfoPage by name and return page with parsed content',
        accessType: 'READ',
        accepts: [
          {arg: 'name', type: 'string' }
        ],
        http: {path: '/parsed/:name', verb: 'get'},
        returns: { arg: 'page', type: 'object', root: true }
      }
  );

};
