'use strict';

module.exports = function(Source) {

  Source.afterRemote( 'replaceOrCreate', function( ctx, source, next) {
    var Collection = Source.app.models.Collection;

    var sourceName = source.title;

    //
    // To automatically add a Collection with the same name as the source
    // you can write your lines here
    //
    Collection.create({
      "name": sourceName,
      "description": "Automatically generated collection of objects which were imported from "+sourceName,
      "public": true,
      "locked": true
    }, function(err, collection){
      if(err) return next(err);

      source.collectionId = collection.id;
      source.save();

      next();
    })

  });

  /**
   * Returns a few details of a given source
   * (because some users don't have rights to access the full dataset)
   * @param {string} id
   * @callback requestCallback
   * @param {string} err
   * @param {object} sourceSummary
   */
  Source.summary = function(id, callback){
    Source.findById(id, function(err, source){
      if(err) return callback(err);
      if(!source) return callback('source not found');

      callback(null,
        {
        'id': source.id,
        'title': source.title,
        'info_url': source.info_url,
        'logo_url': source.logo_url
        }
      );
    });
  }

  Source.remoteMethod(
    'summary',
    {
      description: 'Returns some details for a given source, which are not hidden',
      accepts: [
        { arg: 'id', type: 'string', required: true }
      ],
      returns: [
        { arg: 'details', type: 'object', root: true}
      ],
      http: { path: '/:id/summary', verb: 'get' },
      isStatic: true
    }
  );

};
