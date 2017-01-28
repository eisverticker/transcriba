'use strict';

var faker = require('faker');
var config = require('../config.json');

module.exports = function(server) {
  if (!config.custom.seedDatabase) return;
  var User = server.models.AppUser;

  var users = [];

  //fake some user data
  for (var i = 0; i < config.custom.seeding.users; i++) {
    users.push({
      username: faker.internet.userName(),
      email: faker.internet.email(),
      password: faker.internet.password(),
      emailVerified: true,
    });
  }

  //function which persists users to database
  var seedUsers = function(users, callback) {
    if (users.length > 0) {
      var user = users.pop();

      User.create(user, function(err, u) {
        if (err) return callback(err);

        User.setRole(u.id, config.custom.rbac.defaultRole, function(err) {
          if (err) return callback(err);

          seedUsers(users, callback);
        });
      });
    } else {
      callback(null);
    }
  };

  //user seeding
  seedUsers(users, function(err) {
    if (err) throw err;

    console.log('users successfully seeded');
  });
};
