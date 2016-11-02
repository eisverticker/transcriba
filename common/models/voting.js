'use strict';

module.exports = function(Voting) {

  Voting.revisionRefused = function(instance, callback){
    Voting.app.models.Revision.findById(instance.objectId, function(err, rev){
      if(err) return callback(err);
      if(!rev) return callback("revision not found");

      rev.transcribaObject(function(err, obj){
        if(err) return callback(err);

        Voting.app.models.AppUser.findById(rev.ownerId, function(err, user){
          if(err) return callback(err);

          //delete version
          rev.destroy();

          //update object state
          obj.status = "free";
          obj.save();

        //update score
          user.score = user.score - 2;
          user.save();

          callback(null);
        });
      })
    });
  };

  Voting.revisionAccepted = function(instance, callback){
    Voting.app.models.Revision.findById(instance.objectId, function(err, rev){
      if(err) return callback(err);
      if(!rev) return callback("revision not found");

      rev.transcribaObject(function(err, obj){
        if(err) return callback(err);

        Voting.app.models.AppUser.findById(rev.ownerId, function(err, user){
          if(err) return callback(err);

          //update revision state
          rev.approved = true;
          rev.save();

          //update object state
          obj.status = "free";
          obj.save();

        //update score
          user.score = user.score + 10;
          user.save();

          callback(null);
        });
      })
    });
  };

  var votingModels = {
    'Comment':  {
      'candidates': ['like', 'dislike', 'unwanted'],
       voteValidator: function(context, instance, callback){ callback(null, null) },
       onVote: function(model, context, instance, callback){
         //delete voting target under certain conditions
         /*model.outcome(instance.objectType, instance.objectId, function(err, counts){
           if(err) return callback(err);

           console.log("id",instance.objectId);
           console.log("is destroy function?", typeof instance.destroy);
           if(counts.unwanted > 3){
             instance.destroy(function(err){
               if(err) return callbac(err);

               callback(null);
             });
           }
         });*/
         callback(null);
       }
    },

    'Revision':  {
      'candidates': ['accept', 'refuse'],
       voteValidator: function(context, instance, callback){

         var User = Voting.app.models.AppUser;
         var userId = context.req.accessToken.userId;

         Voting.app.models.Revision.findById(instance.objectId, function(err, rev){
           if(err) return callback(err);

           User.findById(userId, function(err, user){
             if(err) return callback(err);

             user.hasRole('trusted', function(err, isTrusted){
               if(err) return callback(err);

               if(isTrusted){
                  return callback(null, null);
               }else{
                 user.isAllowedToVoteForRevision(rev, function(err, isAllowed){
                   if(err) return callback(err);

                   var invalid = isAllowed == true? null: "user is not permitted to vote";

                   return callback(null, invalid);

                 });
               }

             })

           });

         });

       },
       onVote: function(model, context, instance, callback){
         var User = model.app.models.AppUser;
         var userId = context.req.accessToken.userId;
         model.outcome(instance.objectType, instance.objectId, function(err, counts){
           if(err) return callback(err);

           User.findById(userId, function(err, user){
             if(err) return callback(err);

             user.hasRole('trusted', function(err, isTrusted){
               if(err) return callback(err);

               if(isTrusted){
                 if(instance.vote == "accept"){
                   return Voting.revisionAccepted(instance, callback);
                 }else{
                   return Voting.revisionRefused(instance, callback);
                 }
               }else{
                 Voting.isEnoughRevisionVotes(counts.accept+counts.refuse, function(err, isEnough){
                   if(err) return callback(err);

                   if(isEnough){
                     if(counts.accept >= counts.refuse){
                       return Voting.revisionAccepted(instance, callback);
                     }else{
                       return Voting.revisionRefused(instance, callback);
                     }
                   }else{
                     return callback(null);
                   }

                 });
               }

             });

           });

         });
       }
    },

    'Proposal': []
  };

  Voting.isEnoughRevisionVotes = function(votes, callback){
    Voting.app.models.AppUser.numOfEligibleVoters(function(err, eligibleVoters){
      if(err) return callback(err);

      var votesNeeded;

      if(eligibleVoters < 20){
        votesNeeded = 2;
      }else if(eligibleVoters < 50){
        votesNeeded = 8;
      }else{
        votesNeeded = 12;
      }

      return callback(null, votes >= votesNeeded);
    });


  };

  Voting.outcome = function(objectType, objectId, callback){
    var syncCountdown = votingModels[objectType].candidates.length;
    var result = {};

    var count = function(vote, cb){
      Voting.count({
          "objectType": objectType,
          "objectId": objectId,
          "vote": vote
        }, function(err, count){
        if(err) return cb(err);

        syncCountdown--;
        result[vote] = count;
        if(syncCountdown == 0){
          return callback(null, result);
        }else{
          return cb(null);
        }
      });
    };

    votingModels[objectType].candidates.forEach(function(candidate){
      count(candidate, function(err){
        if(err) return callback(err);
      })
    });

  };

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
        //voting.createdAt = new Date();
        voting.save(callback);
      }else{
        Voting.create(data, callback);
      }

    });
  };

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
      return next(new Error("voting create method is missing some arguments"));
    }

    //# Step 1
    //Require user to be authorized
    var userId = context.req.accessToken.userId;
    if (!userId) {
      return next(new Error("authorisation required"));
    }
    data.userId = userId;//Set the related foreign key (userId)
    data.createdAt = new Date();

    //# Step 2
    //check whether model and voting are supported
    if(
      votingModels[data.objectType] == undefined ||
      votingModels[data.objectType].candidates.indexOf(data.vote) == -1
    ){
      return next('voting context is not supported');
    }

    //some model specific validation
    votingModels[data.objectType].voteValidator(context, data ,function(err, invalid){
      if(err) return next(err);
      if(invalid) return next(new Error('vote is not valid-'+invalid));

      next();
    });

  });

  Voting.afterRemote("vote", function( context, instance ,next) {

    votingModels[instance.objectType].onVote(Voting, context, instance, function(err){
      if(err) return next(err);

      next();
    });
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


  Voting.disableRemoteMethodByName('create', true);


};
