'use strict';

var request = require('request');
var download = require('download');

var pd = require('pretty-data2').pd;

var fs = require('fs');
var fsExtra = require('fs-extra');
var sharp = require('sharp');
var sizeOf = require('image-size');
var config = require('../../server/config.json');

//var ejs = require('ejs'),

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

  /**
   * Creates the first empty revision made by bot user
   */
  Obj.createFirstRevision = function(obj, callback){
    var User = Obj.app.models.AppUser;

    User.findOne({
      where: {
        'username': config.custom.bot.username
      }
    }, function(err, user) {
      if (err) return callback(err);

      obj.revisions.create({
        createdAt: new Date(),
        ownerId: user.id,
        metadata: {},
        content: { 'type': 'root', 'properties': {}, 'children': [], 'isDirty': false },
        published: true,
        approved: true
      }, function(err, revision){
        if(err) return callback(err);

        return callback(null, revision);
      });
    });
  }

  /**
   * Method for the REST import endpoint.
   * It is being used to create TranscribaObjects from
   * external Sources
   */
  Obj.import = function(data, callback){
    var Discussion = Obj.app.models.Discussion;
    var Source = Obj.app.models.Source;

    //ensure that (externalID, sourceId) is unique
    Obj.findOne({
      where: {
        externalID: data.externalId,
        sourceId: data.sourceId
      }
    }, function(err, object){
      if(err) return callback(err);
      if(object) return callback("object was already imported");

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
                "createdAt": new Date(),
                "released": true
              }, function(error, obj){
                if(error) return callback(error);
                if(obj == null) return callback("couldn't create object");

                download(objectMetadata.file_url.replace('{file}',objectMetadata.resolutions.max)).then(
                  data => {
                    //ensure that all needed directories do exist
                    fsExtra.ensureDir('imports/'+obj.id, function(err){
                      if(err) return callback(err);

                      //create thumbnails, tiles and more
                      Obj.generateImages(data, obj.id, function(err){
                        if(err) return callback(err);

                        //create inital revision (user = bot)
                        Obj.createFirstRevision(obj, function(err){
                          if(err) return callback(err);

                          //automatically add to source related collection
                          source.collection(function(err, collection){
                            if(err) return callback(err);

                            /**
                             * currently not available because of relation problem
                             * see https://github.com/eisverticker/transcriba-backend/issues/1
                             */
                            //add transcribaObject to that collection
                            /*collection.transcribaObjects.add(obj, function(err){
                              if(err) return callback(err);
                              callback(null, obj.id );
                            })*/
                            callback(null, obj.id);
                          });

                        });
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


  Obj.disableRemoteMethodByName('create', true);


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


  Obj.chronic = function(id, callback){
    Obj.findById(id, function(err, obj){
      if(err) return callback(err);
      if(obj == null) return callback("cannot find object");

      obj.revisions({
        order: 'createdAt desc',
        include: 'owner'
      }, function(err, rev){
        if(err) return callback(err);
        if(!rev || rev.length == 0) return callback("no revision found");

        return callback(null, rev.map( function(revision){
            var owner = revision.owner();
            return {
              "id": revision.id,
              "createdAt": revision.createdAt,
              "username": owner.username,
              "published": revision.published,
              "approved": revision.approved
            }
        }));
      })
    })
  }

  Obj.remoteMethod(
    'chronic',
    {
      description: 'Load the revision chronic of the object',
      accepts: [
        { arg: 'id', type: 'string', required: true }
      ],
      returns: [
        { arg: 'chronic', type: 'array', root: true},
      ],
      http: { path: '/:id/chronic', verb: 'get' },
      isStatic: true
    }
  );

  Obj.latest = function(id, callback){
    Obj.findById(id, function(err, obj){
      if(err) return callback(err);
      if(obj == null) return callback("cannot find object");

      obj.revisions({
        order: 'createdAt desc',
        limit: 1
      }, function(err, rev){
        if(err) return callback(err);
        if(!rev || rev.length == 0) return callback("no revision found");

        return callback(null, rev[0]);
      })
    })
  }

  Obj.remoteMethod(
    'latest',
    {
      description: 'Load latest revision of the chosen object',
      accepts: [
        { arg: 'id', type: 'string', required: true }
      ],
      returns: [
        { arg: 'revision', type: 'object', root: true},
      ],
      http: { path: '/:id/latest', verb: 'get' },
      isStatic: true
    }
  );

  Obj.latestPermissions = function(id, req , callback){
    var User = Obj.app.models.AppUser;
    var userId = req.accessToken.userId;

    Obj.latest(id, function(err, revision){
      if(err) return callback(err);
      User.findById(userId, function(err, user){
        if(err) return callback(err);

        user.isAllowedToVoteForRevision(revision, callback);
      });

    });

  }

  Obj.remoteMethod(
    'latestPermissions',
    {
      description: 'Collection of permission data regarding the current user and latest revision',
      accepts: [
        { arg: 'id', type: 'string', required: true },
        { arg: 'req', type: "object", required: true, http: { source: 'req' } }
      ],
      returns: [
        { arg: 'allowVote', type: 'boolean'},
        { arg: 'details', type: 'object'}
      ],
      http: { path: '/:id/latest/permissions', verb: 'get' },
      isStatic: true
    }
  );


  Obj.stable = function(id, callback){
    Obj.findById(id, function(err, obj){
      if(err) return callback(err);
      if(obj == null) return callback("cannot find object");

      obj.revisions({
        order: 'createdAt desc',
        where: { approved: true },
        limit: 1
      }, function(err, rev){
        if(err) return callback(err);
        if(!rev || rev.length == 0) return callback("no revision found");

        return callback(null, rev[0]);
      })
    })
  }

  Obj.remoteMethod(
    'stable',
    {
      description: 'Load stable revision of the chosen object',
      accepts: [
        { arg: 'id', type: 'string', required: true }
      ],
      returns: [
        { arg: 'revision', type: 'object', root: true},
      ],
      http: { path: '/:id/stable', verb: 'get' },
      isStatic: true
    }
  );

  /**
   * Method for the REST occupy endpoint.
   * It is being used to set an object to occupied so that
   * a single user (the user who made the request) is able to
   * start working on it
   */
  Obj.occupy = function(id, req, callback){
    var User = Obj.app.models.AppUser;

    var userId = req.accessToken.userId;

    User.findById(userId, function(err, user){
      if(err) return callback(err);
      if(user.busy) return callback('user is already occupied');

      Obj.findById(id, function(err, obj){
        if(err) return callback(err);
        if(obj.status != "free") return callback("object isn't free");

        Obj.stable(id, function(err, rev){

          if(err) return callback(err)

          obj.revisions.create({
            createdAt: new Date(),
            ownerId: user.id,
            metadata: rev.metadata,
            content: rev.content,
            published: false,
            approved: false
          }, function(err, revision){
            if(err) return callback(err);

            //set user to busy so that he has to finish the transcription on this
            // object before he starts the next one
            user.busy = true;
            user.save();

            //set object status to occupied so that there are no edit conflicts
            // between users
            obj.status = "occupied";
            obj.occupiedAt = new Date();
            obj.save();

            return callback(null, revision);
          });


        });


      })
    });
  }

  Obj.remoteMethod(
    'occupy',
    {
      description: 'Current user wants to work on the transcription.',
      accepts: [
        { arg: 'id', type: 'string', required: true },
        { arg: 'req', type: "object", required: true, http: { source: 'req' } }
      ],
      returns: {
        arg: 'id', type: 'object', root: true
      },
      http: { path: '/:id/occupy', verb: 'post' },
    }
  );

  /**
   * Checks whether the content ist valid or not
   */
  Obj.contentValidator = function(content){
    return (
      content.type !== undefined &&
      content.children !== undefined &&
      content.properties !== undefined &&
      content.isDirty !== undefined
    );
  };

  /**
   * Prepares the passed content so that it is appropriate for saving
   */
  Obj.cleanUpContent = function(content){
    //clean up child elements
    let children = content.children.map(
      childContent => Obj.cleanUpContent(childContent)
    );

    //cleaned structure
    let cleanContent = {
      "type": content.type,
      "properties": content.properties,
      "isDirty": content.isDirty,
      "children": children
    };

    return cleanContent;
  };

  /**
   * Updates the latest revision of the object occupied by the current user
   */
  Obj.save = function(id, req, content, callback){
    var userId = req.accessToken.userId;//(!) this is an object not a string

    Obj.latest(id, function(err, revision){
      if(err) return callback(err);
      if(revision.ownerId.toJSON() != userId.toJSON()) return callback("it is not your turn!");
      if(!Obj.contentValidator(content)) return callback("content has an inappropriate format");
      if(revision.published) return callback('revision is already published and cannot be changed');

      revision.content = Obj.cleanUpContent(content);
      revision.save();
      callback(null, revision);
    });

  };

  Obj.remoteMethod(
    'save',
    {
      description: 'Save the content of the revision your are currently working on.',
      accepts: [
        { arg: 'id', type: 'string', required: true },
        { arg: 'req', type: "object", required: true, http: { source: 'req' } },
        { arg: 'content', type: 'object', required: true, http: { source: 'body' }}
      ],
      returns: {
        arg: 'revision', type: 'object', root: true
      },
      http: { path: '/:id/save', verb: 'post' }
    }
  );

  /**
   * Updates the latest revision of the object occupied by the current user
   */
  Obj.publish = function(id, req, content, callback){
    var User = Obj.app.models.AppUser;

    var userId = req.accessToken.userId;//(!) this is an object not a string

    User.findById( userId, function(err, user) {
      if(err) return callback(err);

      Obj.save(id, req, content, function(err, revision){
        if(err) return callback(err);

        // first get the related object
        revision.transcribaObject(function(err, obj){
          if(err) return callback(err);

          user.roles(function(err, roles){
            if(err) return callback(err);

            var roleNames = roles.map(function(role){
              return role.name;
            });

            //update object status
            // - if the user is truste, employee or administrator
            //   there is no need vor crowd voting
            if(roleNames.indexOf('trusted') !== -1 ){
              obj.status = "free";
              revision.approved = true;
              user.score = user.score + 10;
            }else{
              obj.status = "voting";
            }
            obj.save();

            //set revision state to published
            revision.published = true;
            revision.save();

            //free user
            user.busy = false;
            user.save();

          });


          callback(null, true);
        })
      });

    });

  };


  Obj.remoteMethod(
    'publish',
    {
      description: 'Publish the content of the revision your are currently working on (Finishing the revision)',
      accepts: [
        { arg: 'id', type: 'string', required: true },
        { arg: 'req', type: "object", required: true, http: { source: 'req' } },
        { arg: 'content', type: 'object', required: true, http: { source: 'body' }}
      ],
      returns: {
        arg: 'success', type: 'boolean', root: true
      },
      http: { path: '/:id/publish', verb: 'post' }
    }
  );

  Obj.tei = function(id, callback){

    Obj.findById(id, {
      "include":
        [
          "source"
        ]
    } ,function(err, obj){
      if(err) return callback(err);
      var sourceName = obj.toJSON().source.title;

      Obj.stable(id, function(err, revision){
        if(err) return callback(err);

        Obj.app.render('tei', {
          'title': obj.title,
          'sourceName': sourceName,
          'content': revision.content
        }, function(err, xml){
          if(err) return callback(err);

          callback(null, pd.xmlmin(xml),"text/xml");
        });

      });

    });

  };

  Obj.remoteMethod(
    'tei',
    {
      description: 'Returns TEI xml file representing the content',
      accepts: [
        { arg: 'id', type: 'string', required: true}
      ],
      returns: [
        { arg: 'body', type: 'file', root: true },
        { arg: 'Content-Type', type: 'string', http: { target: 'header' } }
      ],
      http: { path: '/:id/tei', verb: 'get' },
      isStatic: true
    }
  );

};
