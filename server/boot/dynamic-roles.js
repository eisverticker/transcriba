'use strict';

module.exports = function(server) {
  var Role = server.models.Role;
  //var creatorModels = ['Comment'];
  //var votingModels = ['Voting'];

  /*Role.registerResolver('$voter', function(role, context, cb) {
    console.log(context.modelName);


    // Q: Is the current request accessing a supported model?
    if (votingModels.indexOf(context.modelName) === -1) {
      // A: No. This model is not supported
      return process.nextTick(() => cb(null, false));
    }

    //Q: Is the user logged in? (there will be an accessToken with an ID if so)
    var userId = context.accessToken.userId;
    if (!userId) {
      //A: No, user is NOT logged in: callback with FALSE
      return process.nextTick(() => cb(null, false));
    }

    //always accept
    return cb(null, true);

  });*/


};
