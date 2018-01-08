'use strict';

const Promise = require('bluebird');

const transcribaConfig = require('../../server/transcriba-config.json');
const Exceptions = require('../exceptions.js');
const path = require('path');

module.exports = function(user) {
  const votingRequirements = transcribaConfig.game.votingRequirements;
  user.minimumRevisionVotingScore = votingRequirements.minimumScore;
  user.maximumRecentRevisionVotes = votingRequirements.maximumVotesPerDay;

  user.afterRemote('confirm', function(context, result, next) {
    const User = user.app.models.AppUser;
    // if the user is confirmed he will get the default role
    var role = transcribaConfig.rbac.defaultRole;

    User.setRole(context.req.query.uid, role, function(err) {
      if (err) return next(err);

      return next();
    });
  });

  // send verification email after registration
  user.afterRemote('create', function(context, user, next) {
    console.log('> user.afterRemote triggered');

    var options = {
      type: 'email',
      to: user.email,
      from: transcribaConfig.senderMail,
      subject: 'Bestätigung der Registrierung',
      template: path.resolve(__dirname, '../../server/views/verify.ejs'),
      user: user,
      redirect: '/verified',
      appName: transcribaConfig.appName,
    };

    // local host doesn't matter if people don't access the local server directly
    // so we have to take care that the verification link points to the external ip
    if (!transcribaConfig.isLocalServerEnvironment) {
      options.host = transcribaConfig.appUrl;
      options.port = '80';
    }

    user.verify(options, function(err, response) {
      if (err) return next(err);
      // console.log('> verification email sent:', response);
      return next();
    });
  });

  // send password reset link when requested
  user.on('resetPasswordRequest', function(info) {
    const Email = user.app.models.Email;
    const url = 'http://' + transcribaConfig.appUrl + '/reset-password';
    const html = 'Click <a href="' + url + '?access_token=' +
        info.accessToken.id + '">here</a> to reset your password';

    Email.send({
      to: info.email,
      from: transcribaConfig.senderMail,
      subject: 'Password reset',
      html: html,
    }, function(err) {
      if (err) return console.log('> error sending password reset email');
      console.log('> sending password reset email to:', info.email);
    });
  });

  // TODO: error handling
  /**
  * Checks whether the current user has the given role or not
  * @param {string} roleName;
  * @callback requestCallback
  * @param {string} err;
  * @param {boolean} hasRole;
  */
  user.prototype.hasRole = function(roleName) {
    return user.loadRoles(this.id)
      .then(
        (roles) => roles.map(role => role.name)
      ).then(
        (roleNames) =>  roleNames.indexOf(roleName) !== -1
      );
  };

  /**
  * Checks whether the user is mature enough for voting or not
  * @callback requestCallback
  * @param {string} err;
  * @param {boolean} isEligible;
  */
  user.prototype.isEligibleVoter = function() {
    var me = this;
    return this.hasRole('trusted')
      .then(
        (isTrusted) => me.score >= user.minimumRevisionVotingScore || isTrusted
      );
  };

  /**
  * Returns the number of recent votes from the current user
  * regarding a certain objectType
  * @param {string} votingModel;
  * @callback requestCallback
  * @param {string} err;
  * @param {number} numOfVotes;
  */
  user.prototype.numOfRecentVotes = function(objectType) {
    const Voting = user.app.models.Voting;
    const dateDistance = 1000 * 60 * 60 * 24; // 24 hours (represented in milliseconds)

    return Voting.count({
      'userId': this.id,
      'objectType': objectType,
      'createdAt': {
        'between': [
          new Date(Date.now() - dateDistance),
          new Date(),
        ],
      }
    });
  };

  /**
  * The effect of this method depends on the server settings, but
  * it should give the user the specified role plus all roles below in the
  * hierachy (if rbac is hierachical) and delete all above
  * @param {string} id;
  * @param {string} rolename
  * @callback requestCallback
  * @param {string} err
  */
  user.setRole = function(id, rolename) {
    const User = user.app.models.AppUser;
    var roles = transcribaConfig.rbac.roles;
    var rolePosition = roles.indexOf(rolename);

    if (rolePosition == -1) throw Exceptions.NotFound.Role;

    if (transcribaConfig.rbac.hierachical) {
      // delete all roles which are higher than the given role
      // and add all role which are lower than the given role
      //
      return User.addRoles(id, roles.slice(0, rolePosition + 1)).then(
        () => User.removeRoles(
          id, roles.slice(rolePosition + 1)
        )
      );
    } else {
      return User.addRole(id, rolename);
    }
  };

  user.remoteMethod(
    'setRole',
    {
      description: 'Give the user this role',
      accessType: 'WRITE',
      accepts: [
        {arg: 'id', type: 'string'},
        {arg: 'rolename', type: 'string'},
      ],
      http: {path: '/roles', verb: 'post'},
    }
  );

  /**
   * Checks if the user is permitted to vote for the given revision
   * @param {Revision} revision
   * @callback requestCallback
   * @param {string} err
   * @param {boolean} isAllowed
   * @param {object} permissionDetails
   */
  user.prototype.isAllowedToVoteForRevision = function(revision) {
    var me = this;

    return Promise.join(
      this.isEligibleVoter(),
      this.numOfRecentVotes('Revision')
    ).then(
      (isEligible, recentVoteCount) => {
        return { // promise returns a complex object consisting of two attributes
          mayVote: // complex boolean expression
            (
              isEligible &&
              recentVoteCount < user.maximumRecentRevisionVotes &&
              revision.ownerId.toJSON() != me.id.toJSON()
            ),
          permissionDetails: {
            'eligibleVoter': isEligible,
            'maximumVotesReached':
              recentVoteCount >= user.maximumRecentRevisionVotes,
            'isOwner': revision.ownerId.toJSON() == me.id.toJSON(),
          }
        };
      }
    );
  };

  /**
    * Adds roles to a user by role names
    * @param {string} id
    * @param {array} rolenames
    * @return {Promise} void
    */
  user.addRoles = function(id, rolenames) {
    const User = user.app.models.AppUser;
    return Promise.mapSeries(rolenames,
      (nameOfRole) => User.addRole(id, nameOfRole)
    );
  };

  /**
    * Remove roles from a user by role names
    * @param {string} id
    * @param {array} rolenames
    * @return {Promise} void
    */
  user.removeRoles = function(id, rolenames) {
    const User = user.app.models.AppUser;
    return Promise.mapSeries(rolenames,
      (nameOfRole) => User.removeRole(id, nameOfRole)
    );
  };

  /**
   * Add the user to the given role by name.
   * (original src: https://gist.github.com/leftclickben/aa3cf418312c0ffcc547)
   * @param {string} roleName
   * @param {Function} callback
   */
  user.addRole = function(id, rolename) {
    const Role = user.app.models.Role;
    const User = user.app.models.AppUser;
    const RoleMapping = user.app.models.RoleMapping;
    const userId = id;

    return Promise.join(
      User.findById(userId),
      Role.findOne({where: {name: rolename}})
    ).then(
      (user, role) => {
        if (!user || !role) throw Exceptions.NotFound.Default;
        return RoleMapping.findOne({
          where: {
            principalType: RoleMapping.USER,
            principalId: userId,
            roleId: role.id,
          }
        }).then(
          (roleMapping) => {
            if (roleMapping) {
              // role is already associated to the user
              return;
            } else {
              // assign role to user
              return role.principals.create({
                principalType: RoleMapping.USER,
                principalId: userId
              });
            }
          }
        );
      }
    );
  };
  user.remoteMethod(
    'addRole',
    {
      accepts: [
        {arg: 'id', type: 'string'},
        {arg: 'rolename', type: 'string'},
      ],
      http: {path: '/:id/roles', verb: 'put'},
    }
  );

  /**
   * Remove the user from the given role by name.
   * (original src: https://gist.github.com/leftclickben/aa3cf418312c0ffcc547)
   *
   * @param {string} roleName
   * @param {Function} callback
   */
  user.removeRole = function(id, rolename) {
    const Role = user.app.models.Role;
    const RoleMapping = user.app.models.RoleMapping;
    const userId = id;

    return Role.findOne({where: {name: rolename}})
      .then(
        (role) => {
          // FIXME: previously here was no error thrown
          //  so this breaking change should be documented
          if (!role) throw Exceptions.NotFound.Role;

          return RoleMapping.findOne(
            {
              where: {
                principalType: RoleMapping.USER,
                principalId: userId,
                roleId: role.id
              }
            }
          );
        }
      )
      .then(
        (roleMapping) => {
          // can't remove role from user because
          // role is not assigned to him
          // NOTE: we ignore this and just return
          if (!roleMapping) return;

          return roleMapping.destroy();
        }
      );
  };
  user.remoteMethod(
    'removeRole',
    {
      description: 'Remove User to the named role',
      accessType: 'WRITE',
      accepts: [
        {arg: 'id', type: 'string'},
        {arg: 'rolename', type: 'string'},
      ],
      http: {path: '/:id/roles/:rolename', verb: 'delete'},
    }
  );

  user.score = function(req) {
    if (!req.accessToken) throw Exceptions.WrongInput;
    const userId = req.accessToken.userId;

    return user.findById(userId).then(
      (resolvedUser) => {
        if (!resolvedUser) throw Exceptions.NotFound.User;
        return resolvedUser.score;
      }
    );
  };

  user.remoteMethod(
    'score',
    {
      description: 'Load the number of score points of the given user',
      accepts: [
        {arg: 'req', type: 'object', required: true, http: {source: 'req'}},
      ],
      returns: [
        {arg: 'score', type: 'number', root: true},
      ],
      http: {path: '/score', verb: 'get'},
      isStatic: true,
    }
  );

  /**
   * This method returns whether the current user is currently blocking
   * a manuscript (busy) or not
   */
  user.busy = function(req) {
    const userId = req.accessToken.userId;
    return user.findById(userId)
      .then(
        (currentUser) => currentUser.busy
      );
  };

  user.remoteMethod(
    'busy',
    {
      description: 'Load busy state of the given user',
      accepts: [
        {arg: 'req', type: 'object', required: true, http: {source: 'req'}},
      ],
      returns: [
        {arg: 'busy', type: 'number', root: true},
      ],
      http: {path: '/busy', verb: 'get'},
      isStatic: true,
    }
  );

  user.leaderboard = function(maxNumOfUsers) {
    if (maxNumOfUsers == undefined) {
      maxNumOfUsers = 10;
    }

    return user.find({
      limit: maxNumOfUsers,
      order: 'score desc'
    }).then(
      (users) => users.map(
        (user) => {
          return {
            'username': user.username,
            'score': user.score
          };
        }
      )
    );
  };

  user.remoteMethod(
    'leaderboard',
    {
      description: 'Load the best users',
      accepts: [
        {arg: 'maxNumOfUsers', type: 'number'},
      ],
      returns: [
        {arg: 'scores', type: 'array', root: true},
      ],
      http: {path: '/leaderboard', verb: 'get'},
      isStatic: true,
    }
  );

  /**
   * Sets the tutorial flag to true this indicates but does not imply
   * that the user completed the getting started tutorial
   * NOTE: users receive a onetime reward for this
   */
  user.completeTutorial = function(req) {
    const userId = req.accessToken.userId;
    return user.findById(userId)
      .then(
        (currentUser) => {
          // ensure that users only receive the reward once
          if (currentUser.completeTutorial) return;
          // give reward and save flag
          currentUser.score += 15;
          currentUser.completedTutorial = true;
          return currentUser.save();
        }
      );
  };

  user.remoteMethod(
    'completeTutorial',
    {
      description: 'Set the tutorial flag to true',
      accepts: [
        {arg: 'req', type: 'object', required: true, http: {source: 'req'}},
      ],
      returns: [],
      http: {path: '/tutorial', verb: 'post'},
      isStatic: true,
    }
  );

  // prevent users from logging in as 'bot'
  user.beforeRemote('login', function(context, instance, next) {
    const reqBody = context.req.body;

    if (
      (
        reqBody.username !== undefined &&
        reqBody.username == transcribaConfig.bot.username
      ) ||
      (
        reqBody.email !== undefined &&
        reqBody.email == transcribaConfig.bot.email
      )
    ) {
      next(Exceptions.Forbidden);
    } else {
      next();
    }
  });

  user.numOfEligibleVoters = function() {
    return user.count({
      score: {
        gt: user.minimumRevisionVotingScore - 1,
      },
    });
  };

  // TODO: error handling
  /**
   * Loads roles of user with the given id
   * NOTE: this is a replacement for the normal
   * user.roles relation (workaround see #19)
   */
  user.loadRoles = function(id) {
    const User = user.app.models.AppUser;
    const RoleMapping = user.app.models.RoleMapping;
    const Role = user.app.models.Role;

    // first make sure the user with userId id exists
    return User.findById(id).then(
      (selectedUser) =>
        // second find mappings user => roleId (array)
        RoleMapping.find({
          where: {
            principalType: RoleMapping.USER,
            principalId: selectedUser.id
          }
        })
    ).then(
      // third get role names to role ids
      (roleMappings) =>
        Promise.all(roleMappings.map(
          (item) => Role.findById(item.roleId)
        ))
    );
  };

  user.remoteMethod(
    'loadRoles',
    {
      accepts: [
        {arg: 'id', type: 'string'}
      ],
      returns: [
        {arg: 'roles', type: 'array', root: true},
      ],
      http: {path: '/:id/roles', verb: 'get'},
    }
  );

  user.disableRemoteMethodByName('__create__roles', false);
  user.disableRemoteMethodByName('__delete__roles', false);
  user.disableRemoteMethodByName('__link__roles', false);
  user.disableRemoteMethodByName('__unlink__roles', false);
  user.disableRemoteMethodByName('__updateById__roles', false);
  user.disableRemoteMethodByName('__findById__roles', false);
  user.disableRemoteMethodByName('__destroyById__roles', false);
  user.disableRemoteMethodByName('__exists__roles', false);
};
