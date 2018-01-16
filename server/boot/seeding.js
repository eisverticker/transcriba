'use strict';

const Promise = require('bluebird');
const faker = require('faker');
const transcribaConfig = require('../transcriba-config.json');

module.exports = function(server) {
  if (!transcribaConfig.seedDatabase) return;
  const AppUser = server.models.AppUser;

  let users = [];

  // fake some user data
  for (let i = 0; i < transcribaConfig.seeding.users; i++) {
    users.push({
      username: faker.internet.userName(),
      email: faker.internet.email(),
      password: faker.internet.password(),
      emailVerified: true,
    });
  }

  const seedUsers = function(users) {
    return Promise.map(
      users,
      (userData) => AppUser.create(userData)
        .then(
          (user) => user.setRole(transcribaConfig.rbac.defaultRole)
        )
    );
  };

  // user seeding
  seedUsers(users);
};
