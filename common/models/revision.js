'use strict';

module.exports = function(Revision) {
  Revision.prototype.finish = function() {
    this.approved = true;
    this.save();
    return Promise.resolve(null);
  };
};
