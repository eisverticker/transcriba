'use strict';

const Promise = require('bluebird');
const transcribaConfig = require('../transcriba-config.json');
const Exceptions = require('../../common/exceptions.js');

/**
 * This script has several things to do:
 * -----------------------------------------
 *
 * First create all roles from server/transcriba-config.json (rbac.roles)
 *  with the given options
 * Then create a new user and add administrator the last given role to him
 * (it's recommended to call the last role administrator because acls are
 * usually refer to this role name)
 *
 */
module.exports = function(server) {
  const AppUser = server.models.AppUser;
  const roleNames = transcribaConfig.rbac.roles.slice(); // copy roles

  // ensure that administrator is the last role
  if (roleNames.indexOf('administrator') === -1) {
    roleNames.push('administrator');
  }

  if (roleNames.indexOf('administrator') !== roleNames.length - 1) {
    throw Exceptions.WrongRoleOrder;
  }

  // Create roles, bot and admin
  // FIXME: this is being executed on every server access
  //  and thus creates great overhead
  Promise.join(
    AppUser.createRoles(roleNames), // returns last role (admin role)
    AppUser.findOne(
      {where: {'username': transcribaConfig.admin.username}}
    ),
    AppUser.findOne(
      {where: {'username': transcribaConfig.bot.username}}
    ),
    (adminRole, adminUser, botUser) => {
      if (adminUser || botUser) { // installation was already run
        return null;
      }
      // create admin and bot and assign roles
      return Promise.join(
        AppUser.create({
          username: transcribaConfig.admin.username,
          email: transcribaConfig.admin.email,
          password: transcribaConfig.admin.password,
          emailVerified: true,
        }),
        AppUser.create({
          username: transcribaConfig.bot.username,
          email: transcribaConfig.bot.email,
          password: transcribaConfig.bot.password,
          emailVerified: true,
        }),
        (admin, bot) => Promise.all([
          admin.setRole(adminRole.name),
          bot.setRole(transcribaConfig.rbac.defaultRole)
        ])
      );
    }
  ); // end join
};
