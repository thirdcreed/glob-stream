'use strict';
var through2 = require('through2');
var Combine = require('ordered-read-streams');
var unique = require('unique-stream');

var glob = require('glob');
var resolveGlob = require('to-absolute-glob');
var globParent = require('glob-parent');
var extend = require('extend');

var gs = {
  // Creates a stream for a single glob or filter
  createStream: function(ourGlob, negatives, opt) {
    function resolveNegatives(negative) {
      return resolveGlob(negative,opt);
    }

    // Remove path relativity to make globs make sense
    ourGlob = resolveGlob(ourGlob, opt);
    var ourNegatives = negatives.map(resolveNegatives);
    var ourOpt = extend({}, opt);
    delete ourOpt.root;

    ourOpt.ignore = ourNegatives;
    // Create globbing stuff
    var globber = new glob.Glob(ourGlob, ourOpt);

    // Extract base path from glob
    var basePath = opt.base || globParent(ourGlob) + '/';

    // Create stream and map events from globber to it
    var stream = through2.obj(ourOpt);

    var found = false;

    globber.on('error', stream.emit.bind(stream, 'error'));

    globber.once('end', function() {
      if (opt.allowEmpty !== true && !found && globIsSingular(globber)) {
        stream.emit('error',
          new Error('File not found with singular glob: ' + ourGlob));
      }

      stream.end();
    });

    globber.on('match', function(filename) {
      found = true;

      stream.write({
        cwd: opt.cwd,
        base: basePath,
        path: filename,
      });
    });
    return stream;
  },

  // Creates a stream for multiple globs or filters
  create: function(globs, opt) {
    if (!opt) {
      opt = {};
    }
    if (typeof opt.cwd !== 'string') {
      opt.cwd = process.cwd();
    }
    if (typeof opt.dot !== 'boolean') {
      opt.dot = false;
    }
    if (typeof opt.silent !== 'boolean') {
      opt.silent = true;
    }
    if (typeof opt.nonull !== 'boolean') {
      opt.nonull = false;
    }
    if (typeof opt.cwdbase !== 'boolean') {
      opt.cwdbase = false;
    }
    if (opt.cwdbase) {
      opt.base = opt.cwd;
    }

    // Only one glob no need to aggregate
    if (!Array.isArray(globs)) {
      globs = [globs];
    }

    var positives = [];
    var negatives = [];

    var ourOpt = extend({}, opt);
    delete ourOpt.root;

    globs.forEach(function(glob, index) {
      if (typeof glob !== 'string') {
        throw new Error('Invalid glob at index ' + index);
      }

      var globArray = isNegative(glob) ? negatives : positives;

      globArray.push({
        index: index,
        glob: glob,
      });
    });

    if (positives.length === 0) {
      throw new Error('Missing positive glob');
    }

    // Only one positive glob no need to aggregate
    if (positives.length === 1) {
      return streamFromPositive(positives[0]);
    }

    // Create all individual streams
    var streams = positives.map(streamFromPositive);

    // Then just pipe them to a single unique stream and return it
    var aggregate = new Combine(streams);
    var uniqueStream = unique('path');
    var returnStream = aggregate.pipe(uniqueStream);

    aggregate.on('error', function(err) {
      returnStream.emit('error', err);
    });

    return returnStream;

    function streamFromPositive(positive) {
      var negativeGlobs = negatives.filter(indexGreaterThan(positive.index))
        .map(toGlob)
        .map(stripExclamationMark);
      return gs.createStream(positive.glob, negativeGlobs, opt);
    }
  },
};


function isNegative(pattern) {
  if (typeof pattern === 'string') {
    return pattern[0] === '!';
  }
}

function indexGreaterThan(index) {
  return function(obj) {
    return obj.index > index;
  };
}

function toGlob(obj) {
  return obj.glob;
}

function globIsSingular(glob) {
  var globSet = glob.minimatch.set;
  if (globSet.length !== 1) {
    return false;
  }

  return globSet[0].every(function isString(value) {
    return typeof value === 'string';
  });
}

function stripExclamationMark(glob) {
  return glob.slice(1);
}

module.exports = gs;
