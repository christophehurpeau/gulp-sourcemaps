'use strict';
var through = require('through2');
var fs = require('fs');
var path = require('path');
var File = require('vinyl');
var convert = require('convert-source-map');

var PLUGIN_NAME = 'gulp-sourcemap';

/**
 * Initialize source mapping chain
 */
module.exports.init = function init(options) {
  function sourceMapInit(file, encoding, callback) {
    /*jshint validthis:true */

    if (file.isNull()) {
      this.push(file);
      return callback();
    }

    if (file.isStream()) {
      return callback(new Error(PLUGIN_NAME + '-init: Streaming not supported'));
    }

    var fileContent = file.contents.toString();
    var sourceMap;

    if (options && options.loadMaps) {
      var sourcePath = ''; //root path for the sources in the map

      // Try to read inline source map
      sourceMap = convert.fromSource(fileContent);
      if (sourceMap) {
        sourceMap = sourceMap.toObject();
        // sources in map are relative to the source file
        sourcePath = path.dirname(file.path);
      } else {
        // look for source map comment referencing a source map file
        var mapComment = convert.mapFileCommentRegex.exec(fileContent);

        var mapFile;
        if (mapComment)
          mapFile = path.resolve(path.dirname(file.path), mapComment[1]);
        // if no comment try map file with same name as source file
        else
          mapFile = file.path + '.map';

        // sources in external map are relative to map file
        sourcePath = path.dirname(mapFile);

        try {
          sourceMap = JSON.parse(fs.readFileSync(mapFile).toString());
        } catch(e) {}
      }

      // fix source paths and sourceContent for imported source map
      if (sourceMap) {
        sourceMap.sourcesContent = sourceMap.sourcesContent || [];
        sourceMap.sources.forEach(function(source, i) {
          var absPath = path.resolve(sourcePath, source);
          sourceMap.sources[i] = path.relative(file.base, absPath);

          if (!sourceMap.sourcesContent[i]) {
            var sourceContent = null;

            // if current file: use content
            if (absPath === file.path) {
              sourceContent = fileContent;

            // else load content from file
            } else {
              try {
                sourceContent = fs.readFileSync(absPath).toString();
              } catch (e) {
                console.warn(PLUGIN_NAME + '-init: source file not found:' + absPath);
              }
            }

            sourceMap.sourcesContent[i] = sourceContent;
          }
        });

        // remove source map comment from source
        file.contents = new Buffer(convert.removeComments(fileContent), 'utf8');
      }
    }

    if (!sourceMap) {
      // Make an empty source map
      sourceMap = {
        version : 3,
        file: file.relative,
        names: [],
        mappings: '',
        sources: [file.relative],
        sourcesContent: [fileContent]
      };
    }

    file.sourceMap = sourceMap;

    this.push(file);
    callback();
  }

  return through.obj(sourceMapInit);
};

/**
 * Write the source map
 *
 * @param options options to change the way the source map is written
 *
 */
module.exports.write = function write(destPath, options) {
  if (options === undefined && Object.prototype.toString.call(destPath) === '[object Object]') {
    options = destPath;
    destPath = undefined;
  }
  options = options || {};

  // set defaults for options if unset
  if (options.includeContent === undefined)
    options.includeContent = true;
  if (options.addComment === undefined)
    options.addComment = true;

  function sourceMapWrite(file, encoding, callback) {
    /*jshint validthis:true */

    if (file.isNull() || !file.sourceMap) {
      this.push(file);
      return callback();
    }

    if (file.isStream()) {
      return callback(new Error(PLUGIN_NAME + '-write: Streaming not supported'));
    }

    var sourceMap = file.sourceMap;
    sourceMap.file = file.relative;

    if (options.sourceRoot)
      sourceMap.sourceRoot = options.sourceRoot;

    if (options.includeContent) {
      sourceMap.sourceRoot = options.sourceRoot || '/source/';
      sourceMap.sourcesContent = sourceMap.sourcesContent || [];

      // load missing source content
      for (var i = 0; i < file.sourceMap.sources.length; i++) {
        if (!sourceMap.sourcesContent[i]) {
          var sourcePath = path.resolve(file.base, sourceMap.sources[i]);
          try {
            sourceMap.sourcesContent[i] = fs.readFileSync(sourcePath).toString();
          } catch (e) {
            console.warn(PLUGIN_NAME + '-write: source file not found:' + sourcePath);
          }
        }
      }
    } else {
      delete sourceMap.sourcesContent;
    }

    var extension = file.relative.split('.').pop();
    var commentFormatter;

    switch (extension) {
      case 'css':
        commentFormatter = function(url) { return "\n/*# sourceMappingURL=" + url + " */"; };
        break;
      case 'js':
        commentFormatter = function(url) { return "\n//# sourceMappingURL=" + url; };
        break;
      default:
        commentFormatter = function(url) { return ""; };
    }

    var comment;
    if (!destPath) {
      // encode source map into comment
      var base64Map = new Buffer(JSON.stringify(sourceMap)).toString('base64');
      comment = commentFormatter('data:application/json;base64,' + base64Map);
    } else {
      // add new source map file to stream
      var sourceMapFile = new File({
        cwd: file.cwd,
        base: file.base,
        path: path.join(file.base, destPath, file.relative) + '.map',
        contents: new Buffer(JSON.stringify(sourceMap))
      });
      this.push(sourceMapFile);

      comment = commentFormatter(path.join(path.relative(path.dirname(file.path), file.base), destPath, file.relative) + '.map');
    }

    // append source map comment
    if (options.addComment)
      file.contents = Buffer.concat([file.contents, new Buffer(comment)]);

    this.push(file);
    callback();
  }

  return through.obj(sourceMapWrite);
};
