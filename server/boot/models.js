'use strict';

var transcribaConfig = require('../transcriba-config.json');

/**
 * This script has several things to do:
 * -----------------------------------------
 * First create all roles from server/transcriba-config.json (rbac.roles)
 *  with the given options
 * Then create a new user and add administrator the last given role to him
 * (it's recommended to call the last role administrator because acls are
 * usually refer to this role name)
 */
module.exports = function(server) {
  var User = server.models.AppUser;
  var Role = server.models.Role;
  var RoleMapping = server.models.RoleMapping;

  var roles = transcribaConfig.rbac.roles.slice();

  // ensure that administrator is the last role
  if (roles.indexOf('administrator') === -1) {
    roles.push('administrator');
  }

  if (roles.indexOf('administrator') !== roles.length - 1) {
    throw 'administrator role is not the last role';
  }
  //

  var options = {
    isHierachical: transcribaConfig.rbac.hierachical,
  };

  /**
   * Create the models for the given roleNames
   */
  var createRoles = function(roles, options, previousRoleObj, callback) {
    if (roles.length > 0) {
      var roleName = roles.shift();
      // console.log(roleName);

      Role.findOrCreate({
        where: {
          'name': roleName,
        },
      }, {
        'name': roleName,
      }, function(err, roleObj) {
        if (err) callback(err);

        if (previousRoleObj !== null && options.isHierachical) {
          // console.log(previousRoleObj.principals);
          var  principal = {
            principalType: RoleMapping.ROLE,
            principalId: roleObj.id,
          };

          previousRoleObj.principals.findOne(principal,
            function(err, mapping) {
              if (err) return callback(err);

              if (!mapping) {
                previousRoleObj.principals.create(principal, function(err) {
                  if (err) return callback(err);

                  return createRoles(roles, options, roleObj, callback);
                });
              } else {
                return createRoles(roles, options, roleObj, callback);
              }
            }
          );
        } else {
          createRoles(roles, options, roleObj, callback);
        }
      });
    } else {
      callback(null, previousRoleObj);
    }
  };

  createRoles(roles, options, null, function(err, adminRole) {
    if (err) throw err;

    User.findOne({
      where: {
        'username': transcribaConfig.admin.username,
      },
    }, function(err, user) {
      if (err) throw err;

      if (!user) {
        /*
         * Create Administrator
         */
        User.create({
          username: transcribaConfig.admin.username,
          email: transcribaConfig.admin.email,
          password: transcribaConfig.admin.password,
          emailVerified: true,
        }, function(err, user) {
          if (err) throw err;

          User.setRole(user.id, adminRole.name, function(err) {
            if (err) throw err;

            console.log(
              'Administrator ' + user.username + ' was successfully created'
            );
          });
        });

        /*
         * Create Bot user
         */
        User.create({
          username: transcribaConfig.bot.username,
          email: transcribaConfig.bot.email,
          password: transcribaConfig.bot.password,
          emailVerified: true,
        }, function(err, user) {
          if (err) throw err;

          User.setRole(
            user.id,
            transcribaConfig.rbac.defaultRole,
            function(err) {
              if (err) throw err;

              console.log('Bot ' + user.username + ' was successfully created');
            }
          );
        });
      }
    });
  });// end of create roles call
};
