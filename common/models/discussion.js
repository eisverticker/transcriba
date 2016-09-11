module.exports = function(Discussion) {

  /**
   * Adding a comment: Set related user to the userId of the currently logged in user
   * and set createdAt property
   */
  Discussion.beforeRemote("prototype.__create__comments", function( context, comment ,next) {

    //Require user to be authorized
    var userId = context.req.accessToken.userId;
    if (!userId) {
      throw "authorisation required";
    }

    //Set the related foreign key (userId)
    context.args.data.appUserId = userId;
    context.args.data.createdAt = new Date();

    next();
  });

};
