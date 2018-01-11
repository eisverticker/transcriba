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
   * Get public properties of a source
   * @param {Function(Error, object)} callback
   */

  Source.prototype.summary = function() {
    const source = this;
    return Promise.resolve(
      _.pick(source, ['id', 'title', 'info_url', 'logo_url'])
    );
  };

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
