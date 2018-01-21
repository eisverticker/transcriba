'use strict';

const request = require('request-promise');
const download = require('download');
const _ = require('lodash');
const teiBuilder = require('../libs/tei-builder.js');
const Promise = require('bluebird');
const unique = require('array-unique');
const checkTypes = require('check-types');

const fs = Promise.promisifyAll(require('fs'));
const fsExtra = Promise.promisifyAll(require('fs-extra'));
const sharp = require('sharp');
const sizeOf = Promise.promisify(require('image-size'));
const transcribaConfig = require('../../server/transcriba-config.json');
const Exceptions = require('../exceptions.js');

const ImportEntity = require('../interfaces/import-entity.js');
const ObjectMetadata = require('../interfaces/object-metadata.js');

module.exports = function(TranscribaObject) {
  TranscribaObject.tileSize = transcribaConfig.viewer.tileSize;
  TranscribaObject.highestStage = 3;
  // TODO: add to transcribaConfig
  TranscribaObject.thumbnailDimensions = {
    width: 200,
    height: 200
  };

  TranscribaObject.prototype.publishGeneratedTags = function() {
    this.publicTags = unique(this.publicTags.concat(this.generatedTags));
    this.save();
  };

  TranscribaObject.prototype.generateNamedEntityTags = function() {
    // TODO
    Promise.resolve();
  };

  /**
   * Generates all image files like thumbnails, tiles, ... which are
   * being used by the transcriba application
   */
  TranscribaObject.prototype.generateImages = function(imageBlob) {
    const scaleData = [
      {
        outputFile: '/overview.jpg',
        width: undefined,
        height: 512
      },
      {
        outputFile: '/thumbnail.jpg',
        width: TranscribaObject.thumbnailDimensions.width,
        height: TranscribaObject.thumbnailDimensions.width
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
        size: TranscribaObject.tileSize,
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
  TranscribaObject.prototype.createFirstRevision = function() {
    const User = TranscribaObject.app.models.AppUser;

    return User.findOne({where: {'username': transcribaConfig.bot.usernam}})
      .then(
        (user) => this.revisions.create({
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
  TranscribaObject.isImported = function(externalId, sourceId) {
    return TranscribaObject.findOne({
      where: {
        'externalID': externalId,
        'sourceId': sourceId,
      }
    }).then(
      (trObject) => trObject != null
    );
  };

  TranscribaObject.importMetadata = function(source, externalId) {
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
  TranscribaObject.importImages = function(url, trObject) {
    return Promise.join(
      download(url),
      fsExtra.ensureDirAsync('imports/' + trObject.id),
      (imageBlob) => trObject.generateImages(imageBlob)
    );
  };

  /**
   * Every Source has its own collection where only objects imported from
   * this source should be stored. This function adds an object to the corresponding
   * collection
   */
  TranscribaObject.prototype.addToSourceCollection = function() {
    return this.source.collection().then(
      (collection) => {
        if (!collection) throw Exceptions.NotFound.Collection;
        // add transcribaObject to that collection
        return collection.transcribaObjects.add(this);
      }
    );
  };

  /**
   * Undo changes made during import
   * to recover the previous state
   */
  TranscribaObject.abortImport = function(trObject) {
    return trObject.destroy();
  };

  /**
   * Method for the REST import endpoint.
   * It is being used to create TranscribaObjects from
   * external Sources
   * NOTE: This method provides transactional behaviour to some extend
   */
  TranscribaObject.import = function(importParameters) {
    if (!checkTypes.like(importParameters, ImportEntity)) {
      throw Exceptions.WrongFormat;
    }
    const Source = TranscribaObject.app.models.Source;
    const externalId = importParameters.externalId;
    const sourceId = importParameters.sourceId;

    // these will be loaded in promise chain
    let trObject, trObjectSource, trMetadata;

    return Promise.join(
      TranscribaObject.isImported(externalId, sourceId),
      Source.findOne({'where': {id: sourceId}}),
      (isImported, source) => {
        if (isImported) throw Exceptions.Duplicate;
        trObjectSource = source;
        return TranscribaObject.importMetadata(source, externalId);
      }
    ).then(
      (metadata) => {
        trMetadata = metadata;
        return  TranscribaObject.create({
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
        return TranscribaObject.importImages(trMetadata.imageUrl, trObject);
      }
    ).catch(
      // Abort Transaction if critical image import failed
      (error) => TranscribaObject.abortImport(trObject).then(
        () => Promise.reject(error)
      )
    ).then(
      // finish import by taking care of related models
      () => Promise.join(
        trObject.discussion.create({title: 'transcriba'}),
        trObject.addToSourceCollection(),
        trObject.createFirstRevision(),
        () => trObject.id
      )
    );
  };

  TranscribaObject.remoteMethod(
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
  TranscribaObject.printImage = function(path, file, imageType) {
    return fs.statAsync(path)
      .then(
        (stats) => {
          if (!stats.isDirectory()) throw Exceptions.NotFound.Directory;
          return fs.readFileAsync(path + file).catch(
            (_err) => {
              // convert error type
              throw Exceptions.NotFound.Image;
            }
          );
        }
      )
      .then(
        (data) => [data, 'image/' + imageType]
      );
  };

  /**
   * Print a single tile of the image (tiled rendering)
   * @param {number} zoom desired zoom step of the image
   * @param {number} x tile coordinate on x-axis
   * @param {number} y tile coordinate on y-axis
   * @param {Function(Error, )} callback
   */

  TranscribaObject.prototype.tiles = function(zoom, x, y) {
    const path = 'imports/' + this.id + '/tiled/';
    const file = zoom + '/' + y + '/' + x + '.jpg';
    const imageType = 'png';

    return TranscribaObject.printImage(path, file, 'jpeg')
      // catch errors and return a blank image as correction
      .catch(
        (_error) => sharp({
          create: {
            width: transcribaConfig.viewer.tileSize,
            height: transcribaConfig.viewer.tileSize,
            channels: 4,
            background: {r: 255, g: 255, b: 255, alpha: 128}
          }
        })
          .png()
          .toBuffer()
          .then(
            (data) => [data, 'image/' + imageType]
          )
      );
  };

  /**
   * Print thumbnail image
   * @return {Promise}
   */
  TranscribaObject.prototype.thumbnail = function() {
    const path = 'imports/' + this.id + '/';
    const file = 'thumbnail.jpg';

    return TranscribaObject.printImage(path, file, 'jpeg');
  };

  /**
   * Print thumbnail image
   * @param {Function(Error, )} callback
   */
  TranscribaObject.prototype.overview = function() {
    const path = 'imports/' + this.id + '/';
    const file = 'overview.jpg';

    return TranscribaObject.printImage(path, file, 'jpeg');
  };

  /**
   * Load dimensions of the original manuscript image
   * @param {Function(Error, number, number)} callback
   */

  TranscribaObject.prototype.dimensions = function() {
    const path = 'imports/' + this.id + '/';
    const file = 'raw.jpg';

    return sizeOf(path + file)
      .then(
        (dimensions) => [dimensions.width, dimensions.height]
      );
  };

  /**
   * Number of zoomsteps for tiled rendering
   * @param {Function(Error, number)} callback
   */

  TranscribaObject.prototype.zoomsteps = function() {
    // integer logarithm (base 2)
    function intLog2(value) {
      let max = 1;
      let i = 0;

      while (value > max) {
        max = max * 2;
        i++;
      }
      return i;
    }

    return this.dimensions().then(
      (dimensions) => {
        const width = dimensions[0];
        const height = dimensions[1];
        let greatestSideLength, numOfTiles;
        // we are only interessted in the greatest of both sides of the image
        greatestSideLength = Math.max(width, height);
        // now we need to know how many tiles are needed to cover the greatest side
        numOfTiles = greatestSideLength / TranscribaObject.tileSize;
        // log2 of the previous value + 1 is the number of zoom steps
        return intLog2(numOfTiles) + 1;
      }
    );
  };

  /**
   * Get TranscribaObject revision chronic
   * @return {Promise<array>}
   */
  TranscribaObject.prototype.chronic = function() {
    return this.revisions({
      order: 'createdAt desc',
      include: 'owner'
    }).then(
      // eliminate unnecessary properties
      (revisions) => revisions.map(
        (currentRevision) => {
          // load owner to get username
          const owner = currentRevision.owner();
          let chronicItem = _.pick(
            currentRevision,
            ['id', 'createdAt', 'username', 'published', 'approved']
          );
          chronicItem.username = owner.username;
          return chronicItem;
        }
      )
    );
  };

  /**
   * Get latest revision of the TranscribaObject
   * @returns {Promise<Revision>}
   */
  TranscribaObject.prototype.latest = function() {
    // find the latest revision which is approved (stable)
    return this.revisions(
      {
        order: 'createdAt desc',
        limit: 1
      }
    ).then(
      // reduce to exact one revision
      (revisions) => {
        if (revisions.length === 0) throw Exceptions.NotFound.Revision;
        return revisions[0];
      }
    );
  };

  /**
   * Get latest stable revision of the TranscribaObject
   * @returns {Promise<Revision>}
   */
  TranscribaObject.prototype.stable = function() {
    // find the latest revision which is approved (stable)
    return this.revisions(
      {
        order: 'createdAt desc',
        where: {approved: true},
        limit: 1
      }
    ).then(
      // reduce to exact one revision
      (revisions) => {
        if (revisions.length === 0) throw Exceptions.NotFound.Revision;
        return revisions[0];
      }
    );
  };

  /**
   * Get user permissions for the TranscribaObject
   * @param {object} request Express request object
   * @param {Function(Error, object)} callback
   */

  TranscribaObject.prototype.latestPermissions = function(request) {
    const User = TranscribaObject.app.models.AppUser;
    const userId = request.accessToken.userId;

    // these lines were added to support requests from guests
    if (request.accessToken == undefined) {
      // guests are not allowed to vote
      return Promise.resolve({
        allowVote: false, // no voting permissions
        details: {
          'eligibleVoter': false,
          'maximumVotesReached': false,
          'isOwner': false,
        }
      });
    }

    return Promise.join(
      // load user and TranscribaObject
      this.latest(),
      User.findById(userId),
      // check permissions
      (latest, user) => user.isAllowedToVoteForRevision(latest)
    );
  };

  /**
   * Assign the current user to this TranscribaObject
   * @param {object} request Express request object
   * @return {Promise<Revision>} new revision
   */
  TranscribaObject.prototype.occupy = function(request) {
    const User = TranscribaObject.app.models.AppUser;
    const userId = request.accessToken.userId;

    return Promise.join(
      User.findById(userId),
      this.stable(),
      (user, stableRevision) => {
        // check trObject and user state
        if (!user) throw Exceptions.NotFound.User;
        if (user.busy) throw Exceptions.BusyUser;
        if (this.status !== 'free') throw Exceptions.Occupied;

        // create a new unstable revision owned by the user
        return this.revisions.create({
          createdAt: new Date(),
          ownerId: user.id,
          metadata: stableRevision.metadata,
          content: TranscribaObject.cleanUpContent(
            stableRevision.content,
            true
          ),
          published: false,
          approved: false
        }).then(
          (latestRevision) => {
            // update user and trObject state
            user.busy = true;
            this.status = 'occupied';
            this.occupiedAt = new Date();
            return Promise.all([
              user.save(),
              this.save()
            ]).then(
              () => latestRevision
            );
          }
        );
      }
    );
  };

  /**
   * Method for the REST occupy endpoint.
   * Aborts the current transcription, frees
   * the object and deletes the revision
   */
  TranscribaObject.free = function(request) {
    const User = TranscribaObject.app.models.AppUser;
    const userId = request.accessToken.userId;
    let trObject;

    return Promise.join(
      User.findById(userId),
      TranscribaObject.occupied(request).then(
        (trObj) => {
          trObject = trObj;
          return trObject.latest();
        }
      ),
      (user, revision) => {
        if (!user) throw Exceptions.NotFound.User;
        trObject.status = 'free';
        user.busy = false;
        return Promise.all([
          user.save(),
          trObject.save(),
          revision.destroy()
        ]);
      }
    ).then(
      () => true
    ).catch(
      (_err) => false
    );
  };

  TranscribaObject.remoteMethod(
    'free',
    {
      description: 'User wants to abort the transcription',
      accepts: [
        {arg: 'request', type: 'object', required: true, http: {source: 'req'}}
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
  TranscribaObject.contentValidator = function(content) {
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
  TranscribaObject.cleanUpContent = function(content, markUntouched) {
    // check for optional param
    if (markUntouched === undefined) {
      markUntouched = false;
    }

    // clean up child elements
    let children = content.children.map(
      childContent =>
        TranscribaObject.cleanUpContent(childContent, markUntouched)
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
   * Save content to the current revision
   * @param {object} request Express request object
   * @param {object} content manuscript content
   * @param {Promise<Revision>}
   */
  TranscribaObject.prototype.saveContent = function(request, content) {
    const userId = request.accessToken.userId;// (!) this is an object not a string

    return this.latest().then(
      (revision) => {
        if (revision.ownerId.toJSON() != userId.toJSON())
          throw Exceptions.Occupied;
        if (!TranscribaObject.contentValidator(content))
          throw Exceptions.WrongFormat;
        if (revision.published)
          throw Exceptions.Replay;

        revision.content = TranscribaObject.cleanUpContent(content);
        revision.save();

        return revision;
      }
    );
  };

  /**
   * Save and finish the work on the current revision
   * @param {object} request Express request object
   * @param {object} content manuscript content
   * @return {Promise<boolean>}
   */
  TranscribaObject.prototype.publish = function(request, content) {
    const User = TranscribaObject.app.models.AppUser;
    const userId = request.accessToken.userId;// (!) this is an object not a string
    let user;

    // get user and user role data
    return User.findById(userId)
      .then(
        // check if user has certain permissions (>= trusted)
        (selectedUser) => {
          if (!selectedUser) throw Exceptions.NotFound.User;
          user = selectedUser;
          return selectedUser.hasRole('trusted');
        }
      ).then(
        // create new object revision
        (isTrusted) => this.saveContent(request, content).then(
          (revision) => {
            if (isTrusted) {
              this.status = 'free';
              revision.approved = true;
              user.score += 10;
            } else {
              this.status = 'voting';
            }

            revision.published = true;
            user.busy = false; // free user

            // make changes persistent
            return Promise.all([
              this.save(),
              revision.save(),
              user.save()
            ]);
          }
        )
      ).then(
        () => true
      ).catch(
        () => false
      );
  };

  /**
   * Finds the object which is currently occupied by the user who
   * did the request, if there is no such object (user is not busy)
   * then the request fails. It is recommended to check whether
   * the user is busy or not before using this method
   */
  TranscribaObject.occupied = function(request) {
    const Revision = TranscribaObject.app.models.Revision;
    const userId = request.accessToken.userId;

    return Revision.findOne({
      where: {
        ownerId: userId,
        published: false
      },
      include: 'transcribaObject',
    }).then(
      (revision) => {
        if (!revision) throw Exceptions.NotFound.Revision;
        return revision.transcribaObject();
      }
    );
  };

  TranscribaObject.remoteMethod(
    'occupied',
    {
      description: 'If the user occupied an transcribaObject, \
      this method will return this object',
      accepts: [
        {arg: 'request', type: 'object', required: true, http: {source: 'req'}},
      ],
      returns: [
        {arg: 'occupiedObject', type: 'object', root: true},
      ],
      http: {path: '/occupied', verb: 'get'},
      isStatic: true,
    }
  );

  /**
   * Exports TranscribaObject data as TEI-XML
   * @return {Promise<string>}
   */
  TranscribaObject.prototype.tei = function() {
    return Promise.join(
      this.stable(),
      this.source.get(),
      (stableRevision, source) => {
        const content = stableRevision.content;
        const title = this.title;
        // return xml and content type
        return [
          teiBuilder.objectToXml(content, title, source.title),
          'text/xml'
        ];
      }
    );
  };

  TranscribaObject.disableRemoteMethodByName('create', true);
};
