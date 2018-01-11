'use strict';

module.exports = function(Collection) {
  /**
   * Current completion status of this collection
   * @param {Function(Error, number)} callback
   */

  Collection.prototype.progress = function() {
    let progressPercentage = 5;
    // TODO
    return Promise.resolve(progressPercentage);
  };
};
