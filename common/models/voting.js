'use strict';

module.exports = function(Voting) {
  var supportedModels = ['Comment', 'Revision', 'Proposal'];

  /**
   * This method creates a new vote or updates the old one with a new voteType
   *  it replaces the normal create operation because it didn't fit our needs
   * for a correct vote
   * Notice: there is also a remote hook which works hand in hand with vote()
   */
  Voting.vote = function(data, callback){

    //alter voting if the user already voted in the past
    Voting.findOne({
      "where": {
        objectType: data.objectType,
        objectId: data.objectId,
        userId: data.userId
      }
    }, function(err, voting){
      if(err) return callback(err);

      if(voting){
        voting.vote = data.vote;
        voting.save(callback);
      }else{
        Voting.create(data, callback);
      }

    });
  }

  /**
   * This Method must take care of the following:
   * - Step 1: inject user id of currently logged in user (done)
   * - Step 2: check if voting context is valid:
   *    - objectType must be a valid model (done)
   *    - objectId must be a entity of the objectType model (todo)
   */
  Voting.beforeRemote("vote", function( context, unused ,next) {
    var data = context.args.data;

    //check if required fields were delivered
    if(
      data.objectType === undefined ||
      data.objectId === undefined ||
      data.vote === undefined
    ){
      throw "voting create method is missing some arguments";
    }

    //# Step 1
    //Require user to be authorized
    var userId = context.req.accessToken.userId;
    if (!userId) {
      throw "authorisation required";
    }
    data.userId = userId;//Set the related foreign key (userId)

    //# Step 2
    if(supportedModels.indexOf(data.objectType) === -1){
      throw "objectType is not supported";
    }

    return next();

  });

  Voting.remoteMethod(
    'vote',
    {
      description: 'Vote for something.',
      accepts: [
        { arg: 'data', type: 'object', required: true, http: { source: 'body' }}
      ],
      returns: {
        arg: 'vote', type: 'object', root: true
      },
      http: { verb: 'post' },
    }
  );


  Voting.disableRemoteMethod('create', true);


};
