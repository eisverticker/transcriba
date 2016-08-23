# Basic Server-Application
This application extends the sample Loopback application (with mongodb) and its main purpose is to
support front-end applications with RESTful services which expose data from a database.
It also offers user, authentication and authorisation services to prevent
unwanted access.
Some basic templating with ejs and ejs-mate is also integrated so that it is
possible to implement some basic web pages for server configuration or similar.

## Prerequisits
* node.js must be installed
* email provider/account for sending registration mails among others.

## Installation
### First step
Install mongodb.

### Second step
Run `npm install` to download all the required packages.
Then the preinstallation-script should be automatically run so follow the instructions.

### Third step
Your basic application should be ready, you may read the loopback documentation now
or install a client angular2 application like my angular2-loopback-boilerplate.
Also you can remove config.json and datasources.json from .gitignore and customize the postinstall.js script if you want so.
