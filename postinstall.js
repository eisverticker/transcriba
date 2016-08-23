#! /usr/bin/env node  --harmony

var c7 = require('configurator7');
var configJson = require('./install_files/server/config.json');
var datasourcesJson = require('./install_files/server/datasources.json');

var configFiles = {

	"config": {
	  data: configJson,
	  targetFile: "./server/config.json",
	},

	"datasources": {
	  data: datasourcesJson,
	  targetFile: "./server/datasources.json",
	}

};

var questions = [
	{
		title: "How is your app called?",
		type: "default",
		required: true,
		target: {
			file: "config",
			position: 'custom.appName'
		},
		default: 'myApp',
	},
	{
		title: "Please provide the sender email address for verification mails among others",
		type: "email",
		required: true,
		target: {
			file: "config",
			position: 'custom.senderMail'
		}
	},
	{
		title: "Please provide your email host for sending mails.",
		type: "default",
		required: true,
		target: {
			file: "datasources",
			position: "mailer.transports.0.host"
		}
	},
	{
		title: "Please provide your email host port for sending mails.",
		type: "number",
		required: true,
		default: 587,
		target: {
			file: "datasources",
			position: "mailer.transports.0.port"
		}
	},
	{
		title: "Now the username for this email-account:",
		type: "default",
		required: true,
		target: {
			file: "datasources",
			position: "mailer.transports.0.auth.user"
		}
	},
	{
		title: "password:",
		type: "password",
		required: true,
		target: {
			file: "datasources",
			position: "mailer.transports.0.auth.pass"
		}
	},
	{
		title: "mongo database name:",
		type: "default",
		required: true,
		target: {
			file: "datasources",
			position: "mongo.database"
		}
	},
	{
		title: "Now let's create a administrator account. Start with the username:",
		type: "default",
		required: true,
		target: {
			file: "config",
			position: "custom.admin.username"
		}
	},
	{
		title: "Administrator email:",
		type: "email",
		required: true,
		target: {
			file: "config",
			position: "custom.admin.email"
		}
	},
	{
		title: "Administrator password:",
		type: "password",
		required: true,
		target: {
			file: "config",
			position: "custom.admin.password"
		}
	},
	{
		title: "Do you want to create a hierachical user role system?",
		type: "boolean",
		required: true,
		target: {
			file: "config",
			position: "custom.rbac.hierachical"
		}
	},
	{
		title: "Choose your roles (the first is the one with the fewest rights)",
		type: "array",
		required: true,
		target: {
			file: "config",
			position: "custom.rbac.roles"
		}
	},
	{
		title: "Which role should be assigned to a recently registered user?",
		type: "default",
		required: true,
		target: {
			file: "config",
			position: "custom.rbac.defaultRole"
		}
	}
];

var configurator = new c7.configurator(configFiles, questions);

configurator.run(function(err){
	if(err) throw err;

	console.log("done!");
});
