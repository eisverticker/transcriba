var config = require('../../server/config.json');
var path = require('path');

module.exports = function(user) {

  user.afterRemote('confirm', function(context, result, next){

    //if the user is confirmed he will get the default role
    var role = config.custom.rbac.defaultRole;

    user.app.models.AppUser.setRole(context.req.query.uid, role, function(err){
      if(err) throw err;

      return next();
    });
  });

  //send verification email after registration
  user.afterRemote('create', function(context, user, next) {
    console.log('> user.afterRemote triggered');

    var options = {
      type: 'email',
      to: user.email,
      from: config.custom.senderMail,
      subject: 'Bestätigung der Registrierung',
      template: path.resolve(__dirname, '../../server/views/verify.ejs'),
      user: user,
      redirect: '/verified',
      appName: config.custom.appName
    };

    user.verify(options, function(err, response) {
      if (err) return next(err);

      console.log('> verification email sent:', response);
      return next();
    });
  });


  //send password reset link when requested
  user.on('resetPasswordRequest', function(info) {
    var url = 'http://' + config.host + ':' + config.port + '/reset-password';
    var html = 'Click <a href="' + url + '?access_token=' +
        info.accessToken.id + '">here</a> to reset your password';

    user.app.models.Email.send({
      to: info.email,
      from: config.custom.senderMail,
      subject: 'Password reset',
      html: html
    }, function(err) {
      if (err) return console.log('> error sending password reset email');
      console.log('> sending password reset email to:', info.email);
    });
  });

 /**
  * The effect of this method depends on the server settings, but
  * it should give the user the specified role plus all roles below in the
  * hierachy (if rbac is hierachical) and delete all above
  */
  user.setRole = function(id, rolename, callback){
    var roles = config.custom.rbac.roles;
    var rolePosition = roles.indexOf(rolename);

    if(rolePosition == -1) throw "role not found";

    if(config.custom.rbac.hierachical){
      //delete all roles which are higher than the given role
      // and add all role which are lower than the given role
      //
      user.app.models.AppUser.addRoles(id, roles.slice(0,rolePosition+1), function(err){
        if(err) throw err;
        //hier weiter
        user.app.models.AppUser.removeRoles(id,roles.slice(rolePosition+1), callback);
      });
    }else{
      user.app.models.AppUser.addRole(id,rolename, callback);
    }

  };

  user.remoteMethod(
      'setRole',
      {
          description: 'Give the user this role',
          accessType: 'WRITE',
          accepts: [
            {arg: 'id', type: 'string' },
            {arg: 'rolename', type: 'string' }
          ],
          http: {path: '/roles', verb: 'post'}
      }
  );

  user.addRoles = function(id, rolenames, callback){
    if(rolenames.length > 0){
      var role = rolenames.pop();
      user.app.models.AppUser.addRole(id,role, function(err){
        if(err) return callback(err);

        user.app.models.AppUser.addRoles(id, rolenames, callback);
      })
    }else{
      callback(null);
    }
  };

  user.removeRoles = function(id, rolenames, callback){
    if(rolenames.length > 0){
      var role = rolenames.pop();

      user.app.models.AppUser.removeRole(id,role, function(err){
        if(err) return callback(err);

        user.app.models.AppUser.removeRoles(id, rolenames, callback);
      })
    }else{
      callback(null);
    }
  };

  /**
   * Add the user to the given role by name.
   * (original source: https://gist.github.com/leftclickben/aa3cf418312c0ffcc547)
   * @param {string} roleName
   * @param {Function} callback
   */
  user.addRole = function(id, rolename, callback) {
      var Role = user.app.models.Role;
      var RoleMapping = user.app.models.RoleMapping;

      var error, userId = id;
      Role.findOne(
          {
              where: { name: rolename }
          },
          function(err, role) {
              if (err) {
                  return callback(err);
              }

              if (!role) {
                  error = new Error('Role ' + rolename + ' not found.');
                  error['http_code'] = 404;
                  return callback(error);
              }

              RoleMapping.findOne(
                  {
                      where: {
                          principalType: RoleMapping.USER,
                          principalId: userId,
                          roleId: role.id
                      }
                  },
                  function(err, roleMapping) {
                      if (err) {
                          return callback(err);
                      }

                      if (roleMapping) {
                          return callback();
                      }
                      role.principals.create(
                          {
                              principalType: RoleMapping.USER,
                              principalId: userId
                          },
                          callback
                      );
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
          {arg: 'rolename', type: 'string' }
        ],
        http: {path: '/:id/roles', verb: 'put'}
      }
  );

  /**
   * Remove the user from the given role by name.
   * (original source: https://gist.github.com/leftclickben/aa3cf418312c0ffcc547)
   *
   * @param {string} roleName
   * @param {Function} callback
   */
  user.removeRole = function(id, rolename, callback) {
    var Role = user.app.models.Role;
    var RoleMapping = user.app.models.RoleMapping;

      var error, userId = id;

      Role.findOne(
          {
              where: { name: rolename }
          },
          function(err, roleObj) {
              if (err) {
                  return callback(err);
              }

              if (!roleObj) {
                  //error = new Error('Role ' + rolename + ' not found.');
                  //error['http_code'] = 404;
                  //return callback(error);
                  return callback(null);
              }
              RoleMapping.findOne(
                  {
                      where: {
                          principalType: RoleMapping.USER,
                          principalId: userId,
                          roleId: roleObj.id
                      }
                  },
                  function(err, roleMapping) {
                      if (err) {
                          return callback(err);
                      }

                      if (!roleMapping) {
                          return callback();
                      }

                      roleMapping.destroy(callback);
                  }
              );
          }
      );
  };
  user.remoteMethod(
      'removeRole',
      {
          description: 'Remove User to the named role',
          accessType: 'WRITE',
          accepts: [
            {arg: 'id', type: 'string' },
            {arg: 'rolename', type: 'string' }
          ],
          http: {path: '/:id/roles/:rolename', verb: 'delete'}
      }
  );

  user.disableRemoteMethod('__create__roles', false);
  user.disableRemoteMethod('__delete__roles', false);
  user.disableRemoteMethod('__link__roles', false);
  user.disableRemoteMethod('__unlink__roles', false);
  user.disableRemoteMethod('__findById__roles', false);
  user.disableRemoteMethod('__updateById__roles', false);
  user.disableRemoteMethod('__destroyById__roles', false);
  user.disableRemoteMethod('__exists__roles', false);

};
