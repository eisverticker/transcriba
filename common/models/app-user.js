'use strict';

const Promise = require('bluebird');

const transcribaConfig = require('../../server/transcriba-config.json');
const Exceptions = require('../exceptions.js');
const path = require('path');

module.exports = function(AppUser) {
  const votingRequirements = transcribaConfig.game.votingRequirements;
  AppUser.minimumRevisionVotingScore = votingRequirements.minimumScore;
  AppUser.maximumRecentRevisionVotes = votingRequirements.maximumVotesPerDay;

  AppUser.afterRemote('confirm', function(context, result, next) {
    const User = AppUser.app.models.AppUser;
    // if the user is confirmed he will get the default role
    var role = transcribaConfig.rbac.defaultRole;

    User.setRole(context.req.query.uid, role, function(err) {
      if (err) return next(err);

      return next();
    });
  });

  // send verification email after registration
  AppUser.afterRemote('create', function(context, createdUser) {
    console.log('> AppUser.afterRemote triggered');

    const options = {
      type: 'email',
      to: createdUser.email,
      from: transcribaConfig.senderMail,
      subject: 'Bestätigung der Registrierung',
      template: path.resolve(__dirname, '../../server/views/verify.ejs'),
      user: createdUser,
      redirect: '/verified',
      appName: transcribaConfig.appName,
    };

    // local host doesn't matter if people don't access the local server directly
    // so we have to take care that the verification link points to the external ip
    if (!transcribaConfig.isLocalServerEnvironment) {
      options.host = transcribaConfig.appUrl;
      options.port = '80';
    }

    return createdUser.verify(options);
  });

  // send password reset link when requested
  AppUser.on('resetPasswordRequest', function(info) {
    const Email = AppUser.app.models.Email;
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

  /**
  * Checks whether the current user has the given role or not
  * @todo: error handling
  * @param {string} roleName;
  * @callback requestCallback
  * @param {string} err;
  * @param {boolean} hasRole;
  */
  AppUser.prototype.hasRole = function(roleName) {
    return AppUser.loadRoles(this.id)
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
  AppUser.prototype.isEligibleVoter = function() {
    var me = this;
    return this.hasRole('trusted')
      .then(
        (isTrusted) =>
          me.score >= AppUser.minimumRevisionVotingScore || isTrusted
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
  AppUser.prototype.numOfRecentVotes = function(objectType) {
    const Voting = AppUser.app.models.Voting;
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
  AppUser.setRole = function(id, rolename) {
    const User = AppUser.app.models.AppUser;
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

  AppUser.remoteMethod(
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
  AppUser.prototype.isAllowedToVoteForRevision = function(revision) {
    var me = this;

    return Promise.join(
      this.isEligibleVoter(),
      this.numOfRecentVotes('Revision'),
      (isEligible, recentVoteCount) => {
        return { // promise returns a complex object consisting of two attributes
          allowVote: // complex boolean expression
            (
              isEligible &&
              recentVoteCount < AppUser.maximumRecentRevisionVotes &&
              revision.ownerId.toJSON() != me.id.toJSON()
            ),
          details: {
            'eligibleVoter': isEligible,
            'maximumVotesReached':
              recentVoteCount >= AppUser.maximumRecentRevisionVotes,
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
  AppUser.addRoles = function(id, rolenames) {
    return Promise.mapSeries(rolenames,
      (nameOfRole) => AppUser.addRole(id, nameOfRole)
    );
  };

  /**
    * Remove roles from a user by role names
    * @param {string} id
    * @param {array} rolenames
    * @return {Promise} void
    */
  AppUser.removeRoles = function(id, rolenames) {
    const User = AppUser.app.models.AppUser;
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
  AppUser.addRole = function(id, rolename) {
    const Role = AppUser.app.models.Role;
    const User = AppUser.app.models.AppUser;
    const RoleMapping = AppUser.app.models.RoleMapping;
    const userId = id;

    return Promise.join(
      User.findById(userId),
      Role.findOne({where: {name: rolename}}),
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
  AppUser.remoteMethod(
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
  AppUser.removeRole = function(id, rolename) {
    const Role = AppUser.app.models.Role;
    const RoleMapping = AppUser.app.models.RoleMapping;
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
  AppUser.remoteMethod(
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

  AppUser.score = function(req) {
    if (!req.accessToken) throw Exceptions.WrongInput;
    const userId = req.accessToken.userId;

    return AppUser.findById(userId).then(
      (resolvedUser) => {
        if (!resolvedUser) throw Exceptions.NotFound.User;
        return resolvedUser.score;
      }
    );
  };

  AppUser.remoteMethod(
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
  AppUser.busy = function(req) {
    const userId = req.accessToken.userId;
    return AppUser.findById(userId)
      .then(
        (currentUser) => currentUser.busy
      );
  };

  AppUser.remoteMethod(
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

  AppUser.leaderboard = function(maxNumOfUsers) {
    if (maxNumOfUsers == undefined) {
      maxNumOfUsers = 10;
    }

    return AppUser.find({
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

  AppUser.remoteMethod(
    'leaderboard',
    {
      description: 'Load the best users',
      accepts: [
        {arg: 'maxNumOfUsers', type: 'number'}
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
  AppUser.completeTutorial = function(request) {
    const userId = request.accessToken.userId;
    return AppUser.findById(userId)
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

  AppUser.remoteMethod(
    'completeTutorial',
    {
      description: 'Set the tutorial flag to true',
      accepts: [
        {arg: 'request', type: 'object', required: true, http: {source: 'req'}},
      ],
      returns: [],
      http: {path: '/tutorial', verb: 'post'},
      isStatic: true,
    }
  );

  // prevent users from logging in as 'bot'
  AppUser.beforeRemote('login', function(context, instance, next) {
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

  AppUser.numOfEligibleVoters = function() {
    return AppUser.count({
      score: {
        gt: AppUser.minimumRevisionVotingScore - 1,
      },
    });
  };

  /**
   * Loads roles of user with the given id
   * NOTE: this is a replacement for the normal
   * user.roles relation (workaround see #19)
   * @todo error handling
   */
  AppUser.loadRoles = function(id) {
    const User = AppUser.app.models.AppUser;
    const RoleMapping = AppUser.app.models.RoleMapping;
    const Role = AppUser.app.models.Role;

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

  AppUser.remoteMethod(
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

  AppUser.disableRemoteMethodByName('__create__roles', false);
  AppUser.disableRemoteMethodByName('__delete__roles', false);
  AppUser.disableRemoteMethodByName('__link__roles', false);
  AppUser.disableRemoteMethodByName('__unlink__roles', false);
  AppUser.disableRemoteMethodByName('__updateById__roles', false);
  AppUser.disableRemoteMethodByName('__findById__roles', false);
  AppUser.disableRemoteMethodByName('__destroyById__roles', false);
  AppUser.disableRemoteMethodByName('__exists__roles', false);
};
