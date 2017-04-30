// Replace the console with a better console with colors
require('console-ultimate/global').replace();

// Define constants
global.__basedir = __dirname;
global.__tmpdir = __dirname + '/tmp';
global.__cachedir = __dirname + '/cache';
global.__publicdir = __dirname + '/public';

// Read the config and expose as global
global.config = require('./config.json');
global.public_config = require('./public_config.json');

// Const
global.AI_NAME = "Otto";
global.AI_NAME_ACTIVATOR = /(otto|8)\b/gi;

// Define a new require to require files from our path
global.apprequire = ((k) => require(__basedir + '/src/lib/' + k));

// Global packages
global._ = require('underscore');
global.path = require('path');
global.fs = require('fs');
global.request = require('request');
global.async = require('async');
global.moment = require('moment');
moment.locale(config.language);
global.util = require('util');

global.mongoose = require('mongoose');
mongoose.Promise = global.Promise;

// DB Connect
global.db = mongoose.connect('mongodb://' + config.mongo.user + ':' + config.mongo.password + '@' + config.mongo.host + ':' + config.mongo.port + '/' + config.mongo.database);

// Global (App) packages
global.AI = require(__basedir + '/src/ai');
global.Data = require(__basedir + '/src/data');
global.Util = require(__basedir + '/src/util');
global.IOManager = require(__basedir + '/src/iomanager');
global.Actions = require(__basedir + '/src/actions');

console.info('Boot complete');
