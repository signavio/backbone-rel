var allTestFiles = [];
var TEST_REGEXP = /\.spec\.js$/i;

var pathToModule = function(path) {
  return path.replace(/^\/base\//, '').replace(/\.js$/, '');
};

Object.keys(window.__karma__.files).forEach(function(file) {
  if (TEST_REGEXP.test(file)) {
    // Normalize paths to RequireJS module names.
    allTestFiles.push(pathToModule(file));
  }
});

window.expect = window.chai.expect;

window.FIXTURES_BASE = "/base/test/fixtures/";

require.config({
  // Karma serves files under /base, which is the basePath from your config file
  baseUrl: '/base',

  paths: {
    "underscore" : "node_modules/underscore/underscore",
    "backbone" : "node_modules/backbone/backbone",
    "jquery" : "node_modules/jquery/dist/jquery",
    "react" : "node_modules/react/dist/react-with-addons",
    "backbone-uniquemodel" : "node_modules/backbone.uniquemodel/backbone.uniquemodel"
  },

  shim: {
    "underscore": {
        exports: "_"
    }
  },

  map: {
    "backbone-uniquemodel" : {
      "backbone" : "backbone-rel"
    }
  },

  // dynamically load all test files
  deps: allTestFiles,

  callback: window.__karma__.start
});



