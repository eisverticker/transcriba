'use strict';

/**
 * This script does some extra configuration on model relations
 *  and attributes which may not available in the json files
 */
module.exports = function(server) {
  var User = server.models.AppUser;
  var Role = server.models.Role;
  var RoleMapping = server.models.RoleMapping;

  //
  // Problem: mongodb-connectors >= 1.8 are roughly changing the way
  // how ObjectIds and strings are mapped and thus loading roles
  // does not work anymore, not even manually implemented in remote method
  // The following is a workaround and probably causes the 1.7 mechanism
  // to work again. See #3
  //
  RoleMapping.settings.strictObjectIDCoercion = true;
  //

  //
  // Connecting AppUser to the Role model
  // probably not necessary at the moment
  //
  // Role.hasMany(User,
  //   {
  //     as: 'users',
  //     through: RoleMapping,
  //     polymorphic: 'principal',
  //     invert: true,
  //   }
  // );

  // Set the default principal type from USER to the custom type AppUser
  // RoleMapping.USER = 'AppUser';
};
