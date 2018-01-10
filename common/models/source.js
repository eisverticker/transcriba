'use strict';

const _ = require('lodash');
const request = require('request-promise');

module.exports = function(Source) {
  Source.afterRemote('replaceOrCreate', function(ctx, source, next) {
    const sourceName = source.title;
    //
    // automatically create a Collection with the same name as the source
    //
    source.collection.create({
      'name': sourceName,
      'description': 'Automatically generated collection \
      of objects which were imported from ' + sourceName,
      'public': true,
      'locked': true,
    }).then(
      (_collection) => {
        source.save();
        next();
      },
      (err) => next(err)
    );
  });

  /**
   * Returns a few details of a given source
   * (because some users don't have rights to access the full dataset)
   * @param {string} id
   * @callback requestCallback
   * @param {string} err
   * @param {object} sourceSummary
   */
  Source.summary = function(id) {
    return Source.findById(id).then(
      (source) => {
        if (!source) throw new Error('source not found');
        return _.pick(source, ['id', 'title', 'info_url', 'logo_url']);
      }
    );
  };

  Source.remoteMethod(
    'summary',
    {
      description: 'Returns some details for a given source, \
      which are not hidden',
      accepts: [
        {arg: 'id', type: 'string', required: true},
      ],
      returns: [
        {arg: 'details', type: 'object', root: true},
      ],
      http: {path: '/:id/summary', verb: 'get'},
      isStatic: true,
    }
  );

  /**
   * Load api meta data from a TranscribaJSON2 compatible server
   * TODO: type checking?
   * @param {string} apiUrl
   */
  Source.metadata = function(url) {
    return request.get({
      'url': url,
      'json': true
    }).then(
      (body) => _.pick(body, [
        'name',
        'apiVersion',
        'description',
        'manuscriptUrl',
        'browseUrl',
        'linkUrl',
        'capabilities'
      ])
    );
  };

  Source.remoteMethod(
    'metadata',
    {
      description: 'Imports TranscribaJSON metadata from url',
      accepts: [
        {arg: 'url', type: 'string', required: true},
      ],
      returns: [
        {arg: 'metadata', type: 'object', root: true},
      ],
      http: {path: '/metadata', verb: 'get'},
      isStatic: true,
    }
  );
};
