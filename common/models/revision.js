'use strict';

module.exports = function(Revision) {

  Revision.prototype.finish = function(callback){
    this.approved = true;
    this.save();

    return callback(null);
  };

};
