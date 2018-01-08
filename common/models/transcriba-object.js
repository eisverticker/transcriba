'use strict';

const request = require('request-promise');
const download = require('download');
const _ = require('lodash');
const teiBuilder = require('../libs/tei-builder.js');
const Promise = require('bluebird');
const unique = require('array-unique');
const checkTypes = require('check-types');

const fs = require('fs');
const fsExtra = require('fs-extra');
const sharp = require('sharp');
const sizeOf = require('image-size');
const transcribaConfig = require('../../server/transcriba-config.json');
const Exceptions = require('../exceptions.js');

const ImportEntity = require('../interfaces/import-entity.js');
const ObjectMetadata = require('../interfaces/object-metadata.js');

// Promisify by Bluerbird
Promise.promisifyAll(sharp);
Promise.promisifyAll(fsExtra);
Promise.promisifyAll(fs);
Promise.promisify(sizeOf);

module.exports = function(Obj) {
  Obj.tileSize = 256;

  Obj.prototype.publishGeneratedTags = function() {
    this.publicTags = unique(this.publicTags.concat(this.generatedTags));
    this.save();
  };

  Obj.prototype.generateNamedEntityTags = function() {
    // TODO
    Promise.resolve();
  };

  /**
   * Generates all image files like thumbnails, tiles, ... which are
   * being used by the transcriba application
   */
  Obj.prototype.generateImages = function(imageBlob) {
    const scaleData = [
      {
        outputFile: '/overview.jpg',
        width: undefined,
        height: 512,
      },
      {
        outputFile: '/small.jpg',
        width: undefined,
        height: 128,
      },
      {
        outputFile: '/thumbnail.jpg',
        width: 200,
        height: 200,
      }
    ];

    const saveOriginal = sharp(imageBlob)
      .toFile('imports/' + this.id + '/raw.jpg');

    const generateScaledImages = Promise.map(scaleData,
      (item) => {
        return sharp(imageBlob).resize(item.width, item.height)
          .toFile('imports/' + this.id + item.outputFile);
      }
    );

    const generateTiles = sharp(imageBlob)
      .tile({
        size: Obj.tileSize,
        layout: 'google'
      })
      .toFile('imports/' + this.id + '/tiled');

    // Sync all
    return Promise.all([
      saveOriginal,
      generateScaledImages,
      generateTiles
    ]);
  };

  /**
   * Creates the first empty revision made by bot user
   */
  Obj.createFirstRevision = function(obj) {
    const User = Obj.app.models.AppUser;

    return User.findOne({where: {'username': transcribaConfig.bot.usernam}})
      .then(
        (user) => obj.revisions.create({
          createdAt: new Date(),
          ownerId: user.id,
          metadata: {},
          content: {
            'type': 'root',
            'properties': {},
            'children': [],
            'isDirty': false,
          },
          published: true,
          approved: true
        })
      );
  };

  /**
   * Checks if the object from the given source is already in the database
   * @return {Promise}
   */
  Obj.isImported = function(externalId, sourceId) {
    return Obj.findOne({
      where: {
        'externalID': externalId,
        'sourceId': sourceId,
      }
    }).then(
      (trObject) => trObject != null
    );
  };

  Obj.importMetadata = function(source, externalId) {
    return request(source.url.replace('{id}', externalId))
      .then(
        // create object from response body
        (response, body) => JSON.parse(body)
      )
      .then(
        // check format of received metadata object
        (metadata) => {
          if (!checkTypes.like(metadata, ObjectMetadata)) {
            throw Exceptions.WrongFormat;
          }
          return metadata;
        }
      );
  };

  /**
   * Downloads images from remote server, converts them and saves them
   * to our server
   */
  Obj.importImages = function(url, trObject) {
    return Promise.join(
      download(url),
      fsExtra.ensureDir('imports/' + trObject.id)
    ).then(
      (imageBlob) => trObject.generateImages(imageBlob)
    );
  };

  /**
   * Every Source has its own collection where only objects imported from
   * this source should be stored. This function adds an object to the corresponding
   * collection
   */
  Obj.addToSourceCollection = function(trObject) {
    return trObject.source.collection().then(
      (collection) => {
        if (!collection) throw Exceptions.NotFound.Collection;
        // add transcribaObject to that collection
        return collection.transcribaObjects.add(trObject);
      }
    );
  };

  /**
   * Undo changes made during import
   * to recover the previous state
   */
  Obj.abortImport = function(trObject) {
    return trObject.destroy();
  };

  /**
   * Method for the REST import endpoint.
   * It is being used to create TranscribaObjects from
   * external Sources
   * NOTE: This method provides transactional behaviour to some extend
   */
  Obj.import = function(importParameters) {
    if (!checkTypes.like(importParameters, ImportEntity)) {
      throw Exceptions.WrongFormat;
    }
    const Source = Obj.app.models.Source;
    const externalId = importParameters.externalId;
    const sourceId = importParameters.sourceId;

    // these will be loaded in promise chain
    let trObject, trObjectSource, trMetadata;

    return Promise.join(
      Obj.isImported(externalId, sourceId),
      Source.findOne({'where': {id: sourceId}})
    ).then(
      (isImported, source) => {
        if (isImported) throw Exceptions.Duplicate;
        trObjectSource = source;
        return Obj.importMetadata(source, externalId);
      }
    ).then(
      (metadata) => {
        trMetadata = metadata;
        return  Obj.create({
          'title': metadata.title,
          'sourceId': trObjectSource.id,
          'mainAuthor': metadata.mainAuthor,
          'externalID': externalId,
          'createdAt': new Date(),
          'released': true,
        });
      }
    ).then(
      (trObj) => {
        trObject = trObj;
        return Obj.importImages(trMetadata.imageUrl, trObject);
      }
    ).catch(
      // Abort Transaction if critical image import failed
      (error) => Obj.abortImport(trObject).then(
        () => Promise.reject(error)
      )
    ).then(
      // finish import by taking care of related models
      () => Promise.join(
        trObject.discussion.create({title: 'transcriba'}),
        Obj.addToSourceCollection(trObject),
        Obj.createFirstRevision(trObject)
      )
    ).then(
      // finally return id of the successfully imported TranscribaObject
      () => trObject.id
    );
  };

  Obj.remoteMethod(
    'import',
    {
      description:
      'Import an object from a foreign server \
      (typical way to create a transcriba object).',
      accepts: [
        {arg: 'data', type: 'object', required: true, http: {source: 'body'}},
      ],
      returns: {
        arg: 'id', type: 'string', root: true,
      },
      http: {verb: 'post'},
    }
  );

  /**
   * Image Output
   * @private
   */
  Obj.printImage = function(path, file, imageType) {
    return fs.stat(path)
      .then(
        (stats) => {
          if (!stats.isDirectory()) throw Exceptions.NotFound.Directory;
          return fs.readFile(path + file);
        }
      )
      .then(
        (data) => [data, 'image/' + imageType]
      );
  };

  Obj.tiles = function(id, zoom, x, y) {
    const path = 'imports/' + id + '/tiled/';
    const file = zoom + '/' + y + '/' + x + '.jpg';

    return Obj.printImage(path, file, 'jpeg');
  };

  Obj.remoteMethod(
    'tiles',
    {
      description: 'Load a tile of the image from server.',
      accepts: [
        {arg: 'id', type: 'string', required: true},
        {arg: 'zoom', type: 'number', required: true},
        {arg: 'x', type: 'number', required: true},
        {arg: 'y', type: 'number', required: true},
      ],
      returns: [
        {arg: 'body', type: 'file', root: true},
        {arg: 'contentType', type: 'string',
          http: {target: 'header', header: 'Content-Type'}
        }
      ],
      http: {path: '/:id/tiles/:zoom/:x/:y', verb: 'get'},
      isStatic: true,
    }
  );

  Obj.thumbnail = function(id) {
    var path = 'imports/' + id + '/';
    var file = 'thumbnail.jpg';

    return Obj.printImage(path, file, 'jpeg');
  };

  Obj.remoteMethod(
    'thumbnail',
    {
      description: 'Load a thumbnail of the image',
      accepts: [
        {arg: 'id', type: 'string', required: true},
      ],
      returns: [
        {arg: 'body', type: 'file', root: true},
        {arg: 'contentType', type: 'string',
          http: {target: 'header', header: 'Content-Type'}
        }
      ],
      http: {path: '/:id/thumbnail', verb: 'get'},
      isStatic: true,
    }
  );

  Obj.overview = function(id) {
    var path = 'imports/' + id + '/';
    var file = 'overview.jpg';

    return Obj.printImage(path, file, 'jpeg');
  };

  Obj.remoteMethod(
    'overview',
    {
      description: 'Load a bigger sized thumbnail of the image',
      accepts: [
        {arg: 'id', type: 'string', required: true},
      ],
      returns: [
        {arg: 'body', type: 'file', root: true},
        {arg: 'contentType', type: 'string',
          http: {target: 'header', header: 'Content-Type'}
        }
      ],
      http: {path: '/:id/overview', verb: 'get'},
      isStatic: true,
    }
  );

  Obj.dimensions = function(id) {
    const path = 'imports/' + id + '/';
    const file = 'raw.jpg';

    return sizeOf(path + file, 'jpeg')
      .then(
        (dimensions) => [dimensions.width, dimensions.height]
      );
  };

  Obj.remoteMethod(
    'dimensions',
    {
      description: 'Load height and width of the image',
      accepts: [
        {arg: 'id', type: 'string', required: true},
      ],
      returns: [
        {arg: 'width', type: 'number'},
        {arg: 'height', type: 'number'},
      ],
      http: {path: '/:id/dimensions', verb: 'get'},
      isStatic: true,
    }
  );

  /**
   * Returns number of zoomsteps which are possible
   */
  Obj.zoomsteps = function(id) {
    // integer logarithm (base 2)
    function intLog2(value) {
      var max = 1;
      var i = 0;

      while (value > max) {
        max = max * 2;
        i++;
      }
      return i;
    }

    return Obj.dimensions(id).then(
      (dimensions) => {
        const width = dimensions[0];
        const height = dimensions[1];
        let greatestSideLength, numOfTiles;
        // we are only interessted in the greatest of both sides of the image
        greatestSideLength = Math.max(width, height);
        // now we need to know how many tiles are needed to cover the greatest side
        numOfTiles = greatestSideLength / Obj.tileSize;
        // log2 of the previous value + 1 is the number of zoom steps
        return intLog2(numOfTiles) + 1;
      }
    );
  };

  Obj.remoteMethod(
    'zoomsteps',
    {
      description: 'Load num of zoom steps',
      accepts: [
        {arg: 'id', type: 'string', required: true},
      ],
      returns: [
        {arg: 'width', type: 'number', root: true},
      ],
      http: {path: '/:id/zoomsteps', verb: 'get'},
      isStatic: true,
    }
  );

  /**
   * Utility method which always returns the TranscribaObject with the given id
   * if the promise resolves.
   * This avoids null objects
   * @param {string} id
   * @return {Promise}
   * @private
   */
  Obj.findByIdOrFail = function(id) {
    return Obj.findById(id).then(
      (trObject) => {
        if (!trObject) throw Exceptions.NotFound.TranscribaObject;
        return trObject.revisions;
      }
    );
  };

  /**
   * Load object chronic
   */
  Obj.chronic = function(id) {
    Obj.findByIdOrFail(id).then(
      // find object and map to object revisions property
      (trObject) => trObject.revisions
    ).then(
      // load all revisions in descending order
      (revisions) => revisions({
        order: 'createdAt desc',
        include: 'owner'
      })
    ).then(
      // eliminate unnecessary properties
      (revisions) => revisions.map(
        (currentRevision) => _.pick(
          currentRevision,
          ['id', 'createdAt', 'username', 'published', 'approved']
        )
      )
    );
  };

  Obj.remoteMethod(
    'chronic',
    {
      description: 'Load the revision chronic of the object',
      accepts: [
        {arg: 'id', type: 'string', required: true},
      ],
      returns: [
        {arg: 'chronic', type: 'array', root: true},
      ],
      http: {path: '/:id/chronic', verb: 'get'},
      isStatic: true,
    }
  );

  Obj.latest = function(id) {
    return Obj.findByIdOrFail(id).then(
      // load object and return revisions property
      (trObject) => trObject.revisions
    ).then(
      // load latest revision
      (revisions) => revisions({
        order: 'createdAt desc',
        limit: 1
      })
    ).then(
      // reduce
      (revisions) => {
        if (revisions.length === 0) throw Exceptions.NotFound.Revision;
        return revisions[0];
      }
    );
  };

  Obj.remoteMethod(
    'latest',
    {
      description: 'Load latest revision of the chosen object',
      accepts: [
        {arg: 'id', type: 'string', required: true},
      ],
      returns: [
        {arg: 'revision', type: 'object', root: true},
      ],
      http: {path: '/:id/latest', verb: 'get'},
      isStatic: true,
    }
  );

  Obj.stable = function(id) {
    return Obj.findByIdOrFail(id).then(
      // load object and return revisions property
      (trObject) => trObject.revisions
    ).then(
      // load latest stable object revision
      (revisions) => revisions({
        order: 'createdAt desc',
        where: {approved: true},
        limit: 1
      })
    ).then(
      // reduce
      (revisions) => {
        if (revisions.length === 0) throw Exceptions.NotFound.Revision;
        return revisions[0];
      }
    );
  };

  Obj.remoteMethod(
    'stable',
    {
      description: 'Load stable revision of the chosen object',
      accepts: [
        {arg: 'id', type: 'string', required: true},
      ],
      returns: [
        {arg: 'revision', type: 'object', root: true},
      ],
      http: {path: '/:id/stable', verb: 'get'},
      isStatic: true,
    }
  );

  Obj.latestPermissions = function(id, req) {
    const User = Obj.app.models.AppUser;
    const userId = req.accessToken.userId;

    // these lines were added to support requests from guests
    if (req.accessToken == undefined) {
      // guests are not allowed to vote
      return Promise.resolve({
        mayVote: false, // no voting permissions
        permissionDetails: {
          'eligibleVoter': false,
          'maximumVotesReached': false,
          'isOwner': false,
        }
      });
    }

    return Promise.join(
      // load user and TranscribaObject
      Obj.latest(id),
      User.findById(userId)
    ).then(
      // check permissions
      (latest, user) => user.isAllowedToVoteForRevision(latest)
    );
  };

  Obj.remoteMethod(
    'latestPermissions',
    {
      description: 'Collection of permission data regarding \
      the current user and latest revision',
      accepts: [
        {arg: 'id', type: 'string', required: true},
        {arg: 'req', type: 'object', required: true, http: {source: 'req'}},
      ],
      returns: [
        {arg: 'permissions', type: 'object', root: true},
      ],
      http: {path: '/:id/latest/permissions', verb: 'get'},
      isStatic: true,
    }
  );

  /**
   * Method for the REST occupy endpoint.
   * It is being used to set an object to occupied so that
   * a single user (the user who made the request) may
   * work on its own revision without conflicts
   */
  Obj.occupy = function(id, req) {
    const User = Obj.app.models.AppUser;
    const userId = req.accessToken.userId;
    const trObjectId = id;

    return Promise.join(
      User.findById(userId),
      Obj.findByIdOrFail(trObjectId),
      Obj.stable(trObjectId)
    ).then(
      (user, trObject, stableRevision) => {
        // check trObject and user state
        if (!user) throw Exceptions.NotFound.User;
        if (user.busy) throw Exceptions.BusyUser;
        if (trObject.status !== 'free') throw Exceptions.Occupied;

        // create a new unstable revision owned by the user
        return trObject.revisions.create({
          createdAt: new Date(),
          ownerId: user.id,
          metadata: stableRevision.metadata,
          content: Obj.cleanUpContent(stableRevision.content, true),
          published: false,
          approved: false
        });
      }
    );
  };

  Obj.remoteMethod(
    'occupy',
    {
      description: 'Current user wants to work on the transcription.',
      accepts: [
        {arg: 'id', type: 'string', required: true},
        {arg: 'req', type: 'object', required: true, http: {source: 'req'}},
      ],
      returns: {
        arg: 'id', type: 'object', root: true,
      },
      http: {path: '/:id/occupy', verb: 'post'},
    }
  );

  /**
   * Method for the REST occupy endpoint.
   * Aborts the current transcription, frees
   * the object and deletes the revision
   */
  Obj.free = function(req) {
    const User = Obj.app.models.AppUser;
    const userId = req.accessToken.userId;

    return Promise.join(
      User.findById(userId),
      Obj.occupied(req).spread()
    ).then(
      (user, _trObjectData, revision) => {
        if (!user) throw Exceptions.NotFound.User;
        if (!revision) throw Exceptions.NotFound.Revision;

        return revision.transcribaObject.then(
          (trObject) => {
            if (!trObject) throw Exceptions.NotFound.RelatedModel;

            user.busy = true;
            trObject.status = 'free';
            return Promise.all(
              user.save(),
              trObject.save(),
              revision.destroy()
            );
          }
        );
      }
    ).then(
      () => true
    ).catch(
      () => false
    );
  };

  Obj.remoteMethod(
    'free',
    {
      description: 'User wants to abort the transcription',
      accepts: [
        {arg: 'req', type: 'object', required: true, http: {source: 'req'}},
      ],
      returns: {
        arg: 'free', type: 'boolean', root: true,
      },
      http: {path: '/free', verb: 'post'},
    }
  );

  /**
   * Checks whether the content ist valid or not
   */
  Obj.contentValidator = function(content) {
    return (
      content.type !== undefined &&
      content.children !== undefined &&
      content.properties !== undefined &&
      content.isDirty !== undefined
    );
  };

  /**
   * Prepares the passed content so that it is appropriate for saving
   * @param {TeiElement} content
   * @param {boolean} [markUntouched] - if true isDirty is set to false
   */
  Obj.cleanUpContent = function(content, markUntouched) {
    // check for optional param
    if (markUntouched === undefined) {
      markUntouched = false;
    }

    // clean up child elements
    let children = content.children.map(
      childContent => Obj.cleanUpContent(childContent, markUntouched)
    );

    // cleaned structure
    let cleanContent = {
      'type': content.type,
      'properties': content.properties,
      'isDirty': content.isDirty && !markUntouched,
      'children': children,
    };

    return cleanContent;
  };

  /**
   * Updates the latest revision of the object occupied by the current user
   */
  Obj.save = function(id, req, content) {
    const userId = req.accessToken.userId;// (!) this is an object not a string

    return Obj.latest(id).then(
      (revision, trObject) => {
        if (revision.ownerId.toJSON() != userId.toJSON())
          throw Exceptions.Occupied;
        if (!Obj.contentValidator(content))
          throw Exceptions.WrongFormat;
        if (revision.published)
          throw new Exceptions.Replay;

        revision.content = Obj.cleanUpContent(content);
        revision.save();

        return {
          'revision': revision,
          'transcribaObject': trObject
        };
      }
    );
  };

  Obj.remoteMethod(
    'save',
    {
      description: 'Save the content of the revision \
      your are currently working on.',
      accepts: [
        {arg: 'id', type: 'string', required: true},
        {arg: 'req', type: 'object', required: true, http: {source: 'req'}},
        {
          arg: 'content',
          type: 'object',
          required: true,
          http: {source: 'body'},
        },
      ],
      returns: {
        arg: 'revision', type: 'object', root: true,
      },
      http: {path: '/:id/save', verb: 'post'},
    }
  );

  /**
   * Updates the latest revision of the object occupied by the current user
   */
  Obj.publish = function(id, req, content) {
    const User = Obj.app.models.AppUser;
    const userId = req.accessToken.userId;// (!) this is an object not a string
    let isTrusted, user;

    // get user and user role data
    return User.findById(userId)
      .then(
        // check if user has certain permissions (>= trusted)
        (selectedUser) => {
          user = selectedUser;
          return selectedUser.hasRole('trusted');
        }
      ).then(
        // create new object revision
        (trusted) => {
          isTrusted = trusted;
          return Obj.save(id, req, content);
        }
      ).then(
        (revision, trObject) => {
          if (isTrusted) {
            trObject.status = 'free';
            revision.approved = true;
            user.score += 10;
          } else {
            trObject.status = 'voting';
          }

          revision.published = true;
          user.busy = false; // free user

          // make changes persistent
          return Promise.all([
            trObject.save(),
            revision.save(),
            user.save()
          ]);
        }
      ).then(
        () => true
      );
  };

  Obj.remoteMethod(
    'publish',
    {
      description: 'Publish the content of the revision your are \
      currently working on (Finishing the revision)',
      accepts: [
        {arg: 'id', type: 'string', required: true},
        {arg: 'req', type: 'object', required: true, http: {source: 'req'}},
        {
          arg: 'content',
          type: 'object',
          required: true,
          http: {source: 'body'},
        },
      ],
      returns: {
        arg: 'success', type: 'boolean', root: true,
      },
      http: {path: '/:id/publish', verb: 'post'},
    }
  );

  /**
   * Finds the object which is currently occupied by the user who
   * did the request, if there is no such object (user is not busy)
   * then the request fails. It is recommended to check whether
   * the user is busy or not before using this method
   */
  Obj.occupied = function(req) {
    const Revision = Obj.app.models.Revision;
    const userId = req.accessToken.userId;

    return Revision.findOne({
      where: {
        ownerId: userId,
        published: false,
      },
      include: 'transcribaObject',
    }).then(
      (revision) => {
        if (!revision) throw Exceptions.NotFound.Revision;
        return [
          revision.toJSON().transcribaObject,
          revision
        ];
      }
    );
  };

  Obj.remoteMethod(
    'occupied',
    {
      description: 'If the user occupied an transcribaObject, \
      this method will return this object',
      accepts: [
        {arg: 'req', type: 'object', required: true, http: {source: 'req'}},
      ],
      returns: [
        {arg: 'occupiedObject', type: 'object', root: true},
      ],
      http: {path: '/occupied', verb: 'get'},
      isStatic: true,
    }
  );

  /**
   * Export object transcription as TEI-XML using our teiBuilder
   */
  Obj.tei = function(trObjectId) {
    return Promise.join(
      Obj.findById(trObjectId, {
        'include':
        [
          'source',
        ]
      }),
      Obj.stable(trObjectId)
    ).then(
      (trObject, stableRevision) => {
        if (!trObject) throw Exceptions.NotFound.TranscribaObject;
        if (!stableRevision) throw Exceptions.NotFound.Revision;

        const sourceName = trObject.toJSON().source.title;
        const content = stableRevision.content;
        const title = trObject.title;
        // return xml and content type
        return [teiBuilder.objectToXml(content, title, sourceName), 'text/xml'];
      }
    );
  };

  Obj.remoteMethod(
    'tei',
    {
      description: 'Returns TEI xml file representing the content',
      accepts: [
        {arg: 'trObjectId', type: 'string', required: true},
      ],
      returns: [
        {arg: 'body', type: 'file', root: true},
        {arg: 'contentType', type: 'string',
          http: {target: 'header', header: 'Content-Type'}
        }
      ],
      http: {path: '/:id/tei', verb: 'get'},
      isStatic: true,
    }
  );

  Obj.disableRemoteMethodByName('create', true);
};
