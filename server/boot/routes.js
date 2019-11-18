'use strict';

module.exports = function(server) {
  // Install a `/` route that returns server status
  const router = server.loopback.Router();
  router.get('/', server.loopback.status());

  server.use(router);

  // home route which is welcoming the user
  router.get('/home', function(req, res, _next) {
    res.render('home', {
      'title': 'Hallo',
    });
  });

  router.get('/verified', function(req, res, _next) {
    res.render('verified', {
      'title': 'Verifizierung erfolgreich!',
    });
  });

  // show password reset form (loopback-example-user-management-code [MIT])
  router.get('/reset-password', function(req, res, _next) {
    if (!req.accessToken) return res.sendStatus(401);
    res.render('password-reset', {
      accessToken: req.accessToken.id,
      title: 'Password reset',
    });
  });

  // reset the user's pasword (loopback-example-user-management-code [MIT])
  router.post('/reset-password', function(request, response, _next) {
    if (!request.accessToken) return response.sendStatus(401);
    const userId = request.accessToken.userId;

    // verify passwords match
    if (!request.body.password ||
        !request.body.confirmation ||
        request.body.password !== request.body.confirmation) {
      return response.sendStatus(400, new Error('Passwords do not match'));
    }

    server.models.AppUser.findById(userId, function(error, user) {
      if (error) return response.sendStatus(404);
      const newPassword = request.body.password;

      user.updateAttribute('password', newPassword)
        .then(
          () => response.render('response', {
            title: 'Password reset success',
            content: 'Your password has been reset successfully',
            redirectTo: '/',
            redirectToLinkText: 'Log in'
          })
        ).catch(
          () => response.sendStatus(404)
        );
    });
  });
};
