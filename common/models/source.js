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

};
