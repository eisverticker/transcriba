'use strict';

module.exports = function(Collection) {
  /**
   * Current completion status of this collection
   * TODO: make this recursive
   * @param {Function(Error, number)} callback
   */
  Collection.prototype.progress = function() {
    const TranscribaObject = Collection.app.models.TranscribaObject;
    let upperLimit;

    return this.transcribaObjects.find().then(
      (trObjects) => {
        // if no objects are in this collection
        // this means the progress is 100%
        if (trObjects.length === 0) return 1.0;

        // calculate the highest possible amount of accumulated stages
        upperLimit = trObjects.length * TranscribaObject.highestStage;

        return trObjects.reduce(
          (sum, trObject) => sum + trObject.stage
          , 0
        );
      }
    ).then(
      (sum) => sum / upperLimit
    );
  };
};
