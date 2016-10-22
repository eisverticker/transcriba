'use strict';

var request = require('request');
var download = require('download');
var fs = require('fs');
var fsExtra = require('fs-extra');
var sharp = require('sharp');
var sizeOf = require('image-size');

module.exports = function(Obj) {

  Obj.tileSize = 256;

  /**
   * Generates all image files like thumbnails, tiles, ... which are
   * being used by the transcriba application
   */
  Obj.generateImages = function(data, id, callback){
    var completedTaskCounter = 0;
    var numOfTasks = 4;

    var completeTask = function(){
      completedTaskCounter++;

      if(completedTaskCounter == numOfTasks){
        callback(null);
      }
    };

    sharp(data).toFile('imports/'+id+'/raw.jpg', function(err){
      if(err) return callback(err);
      completeTask();
    });

    sharp(data).resize(undefined,512).toFile('imports/'+id+'/overview.jpg', function(err){
      if(err) return callback(err);
      completeTask();
    });

    sharp(data).resize(undefined, 128).toFile('imports/'+id+'/thumbnail.jpg', function(err){
      if(err) return callback(err);
      completeTask();
    });

    sharp(data)
    .tile({
      size: Obj.tileSize,
      layout: 'google'
    })
    .toFile('imports/'+id+'/tiled.dzi', function(err){
      if(err) return callback(err);
      completeTask();
    });
  }

  /*Obj.createObjectDependencies = function(callback){
    var Discussion = Obj.app.models.Discussion;

    Discussion.create({
      title: "transcriba"
    }, function(err, discussion){
      if(err) return callback(err);

    });
  };*/

  /**
   * Method for the REST import endpoint.
   * It is being used to create TranscribaObjects from
   * external Sources
   */
  Obj.import = function(data, callback){
    var Discussion = Obj.app.models.Discussion;
    var Source = Obj.app.models.Source;

    //alter voting if the user already voted in the past
    Source.findOne({
      "where": {
        id: data.sourceId
      }
    }, function(err, source){
      if(err) return callback(err);
      if(!source) return callback('source does not exist');

      request(source.url.replace('{id}',data.externalId), function (err, response, body) {
        if(err) return callback(err);
        if(response.statusCode !== 200) return callback('wrong status code')

        try{
          var objectMetadata = JSON.parse(body);

          Discussion.create({
            title: "transcriba"
          }, function(err, discussion){
            if(err) return callback(err);

            //create object to get a new id
            Obj.create({
              "title": objectMetadata.title,
              "sourceId": source.id,
              "discussionId": discussion.id,
              "externalID": data.externalId,
              "status": 0,
              "createdAt": new Date(),
              "released": true
            }, function(error, obj){
              if(error) return callback(error);
              if(obj == null) return callback("couldn't create object");

              download(objectMetadata.file_url.replace('{file}',objectMetadata.resolutions.max)).then(
                data => {
                  fsExtra.ensureDir('imports/'+obj.id, function(err){
                    if(err) return callback(err);

                    Obj.generateImages(data, obj.id, function(err){
                      if(err) return callback(err);

                      callback(null, obj.id );
                    });


                  });
                }
              );//end download


            });

          });

        }catch(error){
          callback("external ressource not found");
        }
      });

    });
  }

  Obj.remoteMethod(
    'import',
    {
      description: 'Import an object from a foreign server (typical way to create a transcriba object).',
      accepts: [
        { arg: 'data', type: 'object', required: true, http: { source: 'body' }}
      ],
      returns: {
        arg: 'id', type: 'string', root: true
      },
      http: { verb: 'post' },
    }
  );


  Obj.disableRemoteMethod('create', true);


  var printImage = function(path, file, imageType, callback){

    fs.stat(path, function(err, stats){
      if(err) return callback(err);
      if(!stats.isDirectory()) return callback("dir does not exist");

      fs.readFile(path+file, (err, data) => {
        if (err) return callback(err);

        return callback(null, data, 'image/'+imageType)
      });
    });
  };

  Obj.tiles = function(id, zoom, x, y, callback){
    var path = 'imports/'+id+'/tiled/';
    var file = zoom+'/'+y+'/'+x+'.jpg';

    printImage(path, file, 'jpeg', callback);
  };

  Obj.remoteMethod(
    'tiles',
    {
      description: 'Load a tile of the image from server.',
      accepts: [
        { arg: 'id', type: 'string', required: true },
        { arg: 'zoom', type: 'number', required: true },
        { arg: 'x', type: 'number', required: true },
        { arg: 'y', type: 'number', required: true }
      ],
      returns: [
        { arg: 'body', type: 'file', root: true },
        { arg: 'Content-Type', type: 'string', http: { target: 'header' } }
      ],
      http: { path: '/:id/tiles/:zoom/:x/:y', verb: 'get' },
      isStatic: true
    }
  );

  var printImage = function(path, file, imageType, callback){

    fs.stat(path, function(err, stats){
      if(err) return callback(err);
      if(!stats.isDirectory()) return callback("dir does not exist");

      fs.readFile(path+file, (err, data) => {
        if (err) return callback(err);

        return callback(null, data, 'image/'+imageType)
      });
    });
  };

  Obj.thumbnail = function(id, callback){
    var path = 'imports/'+id+'/';
    var file = 'thumbnail.jpg';

    printImage(path, file, 'jpeg', callback);

  };

  Obj.remoteMethod(
    'thumbnail',
    {
      description: 'Load a thumbnail of the image',
      accepts: [
        { arg: 'id', type: 'string', required: true}
      ],
      returns: [
        { arg: 'body', type: 'file', root: true },
        { arg: 'Content-Type', type: 'string', http: { target: 'header' } }
      ],
      http: { path: '/:id/thumbnail', verb: 'get' },
      isStatic: true
    }
  );

  Obj.overview = function(id, callback){
    var path = 'imports/'+id+'/';
    var file = 'overview.jpg';

    printImage(path, file, 'jpeg', callback);

  };

  Obj.remoteMethod(
    'overview',
    {
      description: 'Load a bigger sized thumbnail of the image',
      accepts: [
        { arg: 'id', type: 'string', required: true }
      ],
      returns: [
        { arg: 'body', type: 'file', root: true },
        { arg: 'Content-Type', type: 'string', http: { target: 'header' } }
      ],
      http: { path: '/:id/overview', verb: 'get' },
      isStatic: true
    }
  );

  Obj.dimensions = function(id, callback){
    var path = 'imports/'+id+'/';
    var file = 'raw.jpg';

    var dimensions = sizeOf(path+file, 'jpeg', callback);

    callback(null, dimensions.width, dimensions.height);
  };

  Obj.remoteMethod(
    'dimensions',
    {
      description: 'Load height and width of the image',
      accepts: [
        { arg: 'id', type: 'string', required: true }
      ],
      returns: [
        { arg: 'width', type: 'number'},
        { arg: 'height', type: 'number'}
      ],
      http: { path: '/:id/dimensions', verb: 'get' },
      isStatic: true
    }
  );


  /**
   * Returns number of zoomsteps which are possible
   */
  Obj.zoomsteps = function(id, callback){

    //integer logarithm (base 2)
     function intLog2(value){
      var max = 1;
      var i = 0;

      while(value > max){
        max = max*2;
        i++;
      }
      return i;
    }

    Obj.dimensions(id, function(err, width, height){
      if(err) return callback(err);

      var greatestSideLength, numOfTiles;

      //we are only interessted in the greatest of both sides of the image
      greatestSideLength = Math.max(width, height);
      //now we need to know how many tiles are needed to cover the greatest side
      numOfTiles = greatestSideLength/Obj.tileSize;
      //log2 of the previous value +1 is the number of zoom steps
      callback(null, intLog2(numOfTiles)+1 );

    });
  };

  Obj.remoteMethod(
    'zoomsteps',
    {
      description: 'Load num of zoom steps',
      accepts: [
        { arg: 'id', type: 'string', required: true }
      ],
      returns: [
        { arg: 'width', type: 'number', root: true},
      ],
      http: { path: '/:id/zoomsteps', verb: 'get' },
      isStatic: true
    }
  );

};
